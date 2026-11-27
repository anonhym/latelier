import { randomUUID } from 'node:crypto';
import type { MongoClient } from 'mongodb';
import type {
  AgentProposal,
  AgentProposalCheck,
  AgentProposalEvent,
  AgentProposalSavedFor,
  AgentProposalStatus,
  AgentProposalsQuery,
  ConnectionRuntime,
  EffectiveReferenceRule,
  ReferenceRule,
  ReferenceRuleCreateInput,
} from '@shared/types';
import { readNeverList, withNeverPair } from '../../src/utils/referenceDiscovery.ts';
import type { AgentSessionIdentity } from '../agent/AgentGate.ts';
import { AgentToolError, defaultAgentMessage } from '../agent/errorMap.ts';
import { proposalPairKey, type ProposeInput } from '../agent/proposalInput.ts';
import {
  coversSourceField,
  expiresAt,
  isOpen,
  nextStatus,
  OPEN_STATUSES,
  proposeAction,
  sweepEvent,
  type ProposalEvent,
} from '../agent/proposalLifecycle.ts';
import type { AgentProposalRepo, StoredProposal } from '../db/repositories/AgentProposalRepo.ts';
import { ConflictError, NotFoundError, ValidationError } from '../errors.ts';
import type { Logger } from '../log.ts';
import { classifyMongoOpError } from '../mongo/errors.ts';
import { EXACT_BSON } from '../mongo/undo.ts';
import { valuesAtPath } from './referencePairing.ts';
import type { AppStateService } from './AppStateService.ts';

/** X26's Never list; main appends a declined Proposal's pair to it. */
export const NEVER_PAIRS_KEY = 'refs.discovery.never';

/** The check reads at most this many source documents, and looks each up once (X28 §5). */
export const CHECK_SAMPLE = 3;
export const CHECK_MAX_TIME_MS = 2000;

const DECIDE_VERB = { later: 'set aside', reopen: 'reopened', decline: 'declined' } as const;

/** Who is proposing: the session's identity as the runner hands it to a tool. */
export type ProposalAuthor = Pick<AgentSessionIdentity, 'sessionId' | 'tokenId' | 'tokenName' | 'clientName'>;

export interface AgentProposalDeps {
  repo: AgentProposalRepo;
  /** The rules a Proposal is checked against, and where an accepted one is created. */
  refs: {
    effective(connectionId: string, dbName?: string, collection?: string): EffectiveReferenceRule[];
    create(input: ReferenceRuleCreateInput): ReferenceRule;
  };
  rulesRepo: { familyIdOfConnection(connectionId: string): string | null };
  connections: { findById(id: string): { id: string; name: string } | null };
  /**
   * The user's own pool, for the check only. `readClient` connects a closed
   * Connection, so it is called only right after `status` says `connected`.
   */
  pool: {
    status(id: string): Pick<ConnectionRuntime, 'status'>;
    readClient(id: string): Promise<MongoClient>;
  };
  appState: Pick<AppStateService, 'get' | 'set'>;
  log: Pick<Logger, 'warn'>;
  /** Pushes that a Proposal was added or changed status. */
  emit: (event: AgentProposalEvent) => void;
  now?: () => number;
}

/**
 * Agent Proposals (X28): an Agent files a Reference Rule it found, the user
 * adds it, sets it aside or declines it. Nothing here creates a rule except
 * `accept`, which the user's click reaches through IPC. Every step from the
 * checks to the write is synchronous, so two sessions proposing the same pair
 * at once cannot both create one.
 */
export class AgentProposalService {
  private deps: AgentProposalDeps;

  constructor(deps: AgentProposalDeps) {
    this.deps = deps;
  }

  private nowMs(): number {
    return (this.deps.now ?? Date.now)();
  }

  private nowIso(): string {
    return new Date(this.nowMs()).toISOString();
  }

  /**
   * Checks 4–8 of X28 §4.1; the tool has run 1–3. Returns the Proposal's id,
   * the same whether it was created, joined or already backed by this token.
   */
  propose(author: ProposalAuthor, input: ProposeInput): { id: string } {
    // Expiry is lazy: a Proposal past its 30 days must not count toward the cap, take a joiner, or hold the pair.
    this.sweep();
    const key = proposalPairKey(input.connectionId, input);
    if (readNeverList(this.deps.appState.get<unknown>(NEVER_PAIRS_KEY)).includes(key)) throw new AgentToolError('PROPOSAL_DECLINED');
    if (coversSourceField(this.deps.refs.effective(input.connectionId, input.sourceDb, input.sourceCollection), input)) {
      throw new AgentToolError('ALREADY_CONFIGURED');
    }
    const connection = this.deps.connections.findById(input.connectionId);
    // The gate passed it a moment ago; a Connection deleted since then reads as not shared, as the gate would say.
    if (connection === null) throw new AgentToolError('NOT_SHARED');
    const open = this.deps.repo.findOpenByPair(key);
    const action = proposeAction({
      openExists: open !== null,
      tokenBacksOpen: open !== null && this.deps.repo.backs(open.id, author.tokenId),
      tokenOpenCount: this.deps.repo.countOpenBackedBy(author.tokenId),
    });
    const createdAt = this.nowIso();
    const backer = {
      tokenId: author.tokenId,
      tokenName: author.tokenName,
      sessionId: author.sessionId,
      clientName: author.clientName,
      reason: input.reason,
      createdAt,
    };
    switch (action) {
      case 'repeat':
        return { id: open!.id };
      case 'limit':
        throw new AgentToolError('PROPOSAL_LIMIT');
      case 'join':
        this.deps.repo.addBacker({ ...backer, proposalId: open!.id });
        this.deps.emit({ id: open!.id, status: open!.status });
        return { id: open!.id };
      case 'create': {
        const id = randomUUID();
        this.deps.repo.create(
          {
            id,
            connectionId: input.connectionId,
            connectionName: connection.name,
            sourceDb: input.sourceDb,
            sourceCollection: input.sourceCollection,
            sourceField: input.sourceField,
            targetDb: input.targetDb,
            targetCollection: input.targetCollection,
            targetField: input.targetField,
            pairKey: key,
            createdAt,
            expiresAt: expiresAt(createdAt),
          },
          backer,
        );
        this.deps.emit({ id, status: 'pending' });
        return { id };
      }
    }
  }

  /**
   * What `get_proposal` tells a backer: the status and, once accepted, who the
   * rule was saved for. A Proposal the token does not back reads exactly like
   * one that does not exist.
   */
  statusFor(tokenId: string, proposalId: string): { status: AgentProposalStatus; savedFor: AgentProposalSavedFor | null } {
    const row = this.deps.repo.findById(proposalId);
    if (row === null || !this.deps.repo.backs(proposalId, tokenId)) {
      throw new AgentToolError('INVALID_INPUT', `${defaultAgentMessage('INVALID_INPUT')} proposalId: unknown`);
    }
    const shown = this.refresh(row);
    return { status: shown.status, savedFor: shown.savedFor };
  }

  /** Proposals with their backers, after expiry and the obsolete rule are applied. */
  list(query: AgentProposalsQuery): AgentProposal[] {
    this.sweep();
    return this.deps.repo.list(query);
  }

  /**
   * X28 §5: does the relation hold on a few documents? Reads on the user's own
   * client and only while the Connection is open; a closed one is never
   * connected. Read-only: the Proposal does not change.
   */
  async check(id: string): Promise<AgentProposalCheck> {
    const row = this.found(id);
    const connectionId = row.connectionId;
    const connectionName = this.deps.connections.findById(connectionId)?.name ?? row.connectionName;
    const notOpen: AgentProposalCheck = { kind: 'not-open', connectionName };
    const stillOpen = () => this.deps.pool.status(connectionId).status === 'connected';
    if (!stillOpen()) return notOpen;
    // Asked in the same tick as the status: an open Connection hands back its client without connecting.
    const pending = this.deps.pool.readClient(connectionId);
    try {
      const client = await pending;
      // The driver reconnects a closed client on its next operation, so each read is asked for only while the Connection is still open.
      if (!stillOpen()) return notOpen;
      const docs = await client
        .db(row.sourceDb)
        .collection(row.sourceCollection)
        .find(
          { [row.sourceField]: { $exists: true } },
          { ...EXACT_BSON, projection: { [row.sourceField]: 1 }, limit: CHECK_SAMPLE, maxTimeMS: CHECK_MAX_TIME_MS },
        )
        .toArray();
      const target = client.db(row.targetDb).collection(row.targetCollection);
      let resolved = 0;
      for (const doc of docs) {
        // A leaf array stands for each of its elements, as a reference over it does; null and missing resolve nothing.
        const values = valuesAtPath(doc, row.sourceField).filter((v) => v !== undefined && v !== null && !Array.isArray(v));
        if (values.length === 0) continue;
        if (!stillOpen()) return notOpen;
        const hit = await target.findOne(
          { [row.targetField]: { $in: values } },
          { ...EXACT_BSON, projection: { _id: 1 }, maxTimeMS: CHECK_MAX_TIME_MS },
        );
        if (hit !== null) resolved += 1;
      }
      return {
        kind: 'sampled',
        sampled: docs.length,
        resolved,
        sourceCollection: row.sourceCollection,
        sourceField: row.sourceField,
        targetCollection: row.targetCollection,
        targetField: row.targetField,
      };
    } catch (err) {
      throw classifyMongoOpError(err);
    }
  }

  /**
   * Add Reference Rule (X28 §6): the stored pair, never one the renderer sends.
   * Refused for a Proposal that is no longer open, whose Connection is gone,
   * or whose source field gained a rule since (that one becomes obsolete).
   */
  accept(id: string, savedFor: AgentProposalSavedFor): { ruleId: string; savedFor: AgentProposalSavedFor } {
    const row = this.found(id);
    if (!isOpen(row.status)) throw new ConflictError(`Proposal ${id} is ${row.status}, not open`);
    if (this.deps.connections.findById(row.connectionId) === null) {
      this.move(row, 'expire');
      throw new NotFoundError(`connection ${row.connectionId} not found`);
    }
    if (coversSourceField(this.deps.refs.effective(row.connectionId, row.sourceDb, row.sourceCollection), row)) {
      this.move(row, 'obsolete');
      throw new ConflictError(`a Reference Rule already covers the source field of Proposal ${id}`);
    }
    let owner: ReferenceRuleCreateInput['owner'] = { connectionId: row.connectionId };
    if (savedFor === 'family') {
      const familyId = this.deps.rulesRepo.familyIdOfConnection(row.connectionId);
      if (familyId === null) throw new ValidationError(`connection ${row.connectionId} is in no Family`);
      owner = { familyId };
    }
    const decidedAt = this.nowIso();
    // The rule and the decision land together: no rule without an accepted Proposal, and no accepted Proposal without its rule.
    const rule = this.deps.repo.transaction(() => {
      const created = this.deps.refs.create({
        owner,
        sourceDb: row.sourceDb,
        sourceCollection: row.sourceCollection,
        sourceField: row.sourceField,
        targetDb: row.targetDb,
        targetCollection: row.targetCollection,
        targetField: row.targetField,
      });
      if (!this.deps.repo.markAccepted(id, created.id, savedFor, decidedAt)) throw new ConflictError(`Proposal ${id} is no longer open`);
      return created;
    });
    this.deps.emit({ id, status: 'accepted' });
    return { ruleId: rule.id, savedFor };
  }

  /** Not now: a pending Proposal is set aside. */
  later(id: string): { ok: true } {
    this.decide(id, 'later');
    return { ok: true };
  }

  /** A Proposal set aside comes back to pending. */
  reopen(id: string): { ok: true } {
    this.decide(id, 'reopen');
    return { ok: true };
  }

  /** Never for this pair: declined, and the pair joins X26's Never list so no Agent or discovery offers it again. */
  decline(id: string): { ok: true } {
    const row = this.decide(id, 'decline');
    const never = readNeverList(this.deps.appState.get<unknown>(NEVER_PAIRS_KEY));
    this.deps.appState.set(NEVER_PAIRS_KEY, withNeverPair(never, row.pairKey));
    return { ok: true };
  }

  private found(id: string): StoredProposal {
    const row = this.deps.repo.findById(id);
    if (row === null) throw new NotFoundError(`Proposal ${id} not found`);
    return row;
  }

  /** A user's choice: refused when the Proposal's status does not allow it. */
  private decide(id: string, event: 'later' | 'reopen' | 'decline'): StoredProposal {
    const row = this.refresh(this.found(id));
    if (nextStatus(row.status, event) === null || !this.move(row, event)) {
      throw new ConflictError(`Proposal ${id} is ${row.status}; it cannot be ${DECIDE_VERB[event]}`);
    }
    return row;
  }

  /** Applies `event` to an open Proposal and announces it. False when the status does not allow it. */
  private move(row: StoredProposal, event: ProposalEvent): boolean {
    const to = nextStatus(row.status, event);
    if (to === null) return false;
    const decidedAt = isOpen(to) ? null : this.nowIso();
    if (!this.deps.repo.setStatus(row.id, OPEN_STATUSES, to, decidedAt)) return false;
    this.deps.emit({ id: row.id, status: to });
    return true;
  }

  /** The row as it reads once expiry and the obsolete rule are applied to it. */
  private refresh(row: StoredProposal): StoredProposal {
    const event = sweepEvent(row, {
      nowMs: this.nowMs(),
      connectionExists: this.deps.connections.findById(row.connectionId) !== null,
      rules: this.deps.refs.effective(row.connectionId, row.sourceDb, row.sourceCollection),
    });
    if (event === null || !this.move(row, event)) return row;
    return this.deps.repo.findById(row.id) ?? row;
  }

  /** Expires and obsoletes every open Proposal that should be (X28 §3). */
  sweep(): void {
    for (const row of this.deps.repo.listOpen()) this.refresh(row);
  }
}
