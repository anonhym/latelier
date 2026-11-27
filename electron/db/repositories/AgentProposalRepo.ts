import { randomUUID } from 'node:crypto';
import type { Database, Statement } from 'better-sqlite3';
import type {
  AgentProposal,
  AgentProposalBacker,
  AgentProposalSavedFor,
  AgentProposalStatus,
  AgentProposalsQuery,
} from '@shared/types';
import type { Logger } from '../../log.ts';
import type { ColumnCipher } from '../columnCipher.ts';
import { openListedCell } from './listedCell.ts';

/** A Proposal as stored, without its backers. */
export type StoredProposal = Omit<AgentProposal, 'backers'>;

export interface NewProposal {
  id: string;
  connectionId: string;
  connectionName: string;
  sourceDb: string;
  sourceCollection: string;
  sourceField: string;
  targetDb: string;
  targetCollection: string;
  targetField: string;
  pairKey: string;
  createdAt: string;
  expiresAt: string;
}

export interface NewBacker {
  proposalId: string;
  tokenId: string;
  tokenName: string | null;
  sessionId: string | null;
  clientName: string | null;
  reason: string;
  createdAt: string;
}

interface ProposalDbRow {
  id: string;
  kind: 'reference_rule';
  status: AgentProposalStatus;
  connection_id: string;
  connection_name: string;
  source_db: string;
  source_collection: string;
  source_field: string;
  target_db: string;
  target_collection: string;
  target_field: string;
  pair_key: string;
  created_at: string;
  decided_at: string | null;
  expires_at: string;
  rule_id: string | null;
  saved_for: AgentProposalSavedFor | null;
}

interface BackerDbRow {
  id: string;
  proposal_id: string;
  token_id: string;
  token_name: string | null;
  session_id: string | null;
  client_name: string | null;
  reason: Buffer;
  created_at: string;
}

const OPEN_SQL = "status IN ('pending', 'later')";

/**
 * Agent Proposals (X28 §2). Only a backer's `reason` is sealed, against the
 * backer row's own id: it is the Agent's text and can quote document values.
 * Names stay plaintext, as in the Agent Read Log.
 */
export class AgentProposalRepo {
  private db: Database;
  private cipher: ColumnCipher;
  private log: Pick<Logger, 'warn'> | undefined;
  private insertStmt: Statement;
  private insertBackerStmt: Statement;
  private findStmt: Statement<[string]>;
  private findOpenByPairStmt: Statement<[string]>;
  private backsStmt: Statement<[string, string]>;
  private countOpenBackedStmt: Statement<[string]>;
  private listOpenStmt: Statement<[]>;
  private acceptStmt: Statement<[string, AgentProposalSavedFor, string, string]>;
  private expireDueStmt: Statement<[string, string]>;
  private deleteDecidedBackersStmt: Statement<[number]>;
  private deleteDecidedStmt: Statement<[number]>;
  private listStmts = new Map<string, Statement>();

  constructor(db: Database, cipher: ColumnCipher, log?: Pick<Logger, 'warn'>) {
    this.db = db;
    this.cipher = cipher;
    this.log = log;
    this.insertStmt = db.prepare(`
      INSERT INTO agent_proposals (id, kind, status, connection_id, connection_name, source_db, source_collection, source_field,
        target_db, target_collection, target_field, pair_key, created_at, expires_at)
      VALUES (@id, 'reference_rule', 'pending', @connection_id, @connection_name, @source_db, @source_collection, @source_field,
        @target_db, @target_collection, @target_field, @pair_key, @created_at, @expires_at)
    `);
    this.insertBackerStmt = db.prepare(`
      INSERT INTO agent_proposal_backers (id, proposal_id, token_id, token_name, session_id, client_name, reason, created_at)
      VALUES (@id, @proposal_id, @token_id, @token_name, @session_id, @client_name, @reason, @created_at)
    `);
    this.findStmt = db.prepare('SELECT * FROM agent_proposals WHERE id = ?');
    this.findOpenByPairStmt = db.prepare(`SELECT * FROM agent_proposals WHERE pair_key = ? AND ${OPEN_SQL}`);
    this.backsStmt = db.prepare('SELECT 1 FROM agent_proposal_backers WHERE proposal_id = ? AND token_id = ?');
    this.countOpenBackedStmt = db.prepare(`
      SELECT COUNT(*) AS n FROM agent_proposal_backers b JOIN agent_proposals p ON p.id = b.proposal_id
      WHERE b.token_id = ? AND p.${OPEN_SQL}
    `);
    this.listOpenStmt = db.prepare(`SELECT * FROM agent_proposals WHERE ${OPEN_SQL} ORDER BY created_at, id`);
    this.acceptStmt = db.prepare(
      `UPDATE agent_proposals SET status = 'accepted', rule_id = ?, saved_for = ?, decided_at = ? WHERE id = ? AND ${OPEN_SQL}`,
    );
    this.expireDueStmt = db.prepare(`UPDATE agent_proposals SET status = 'expired', decided_at = ? WHERE ${OPEN_SQL} AND expires_at <= ?`);
    // julianday rather than a text comparison, as in AgentReadLogRepo. An open Proposal has no decided_at and is never matched.
    const decidedOld = `status NOT IN ('pending', 'later') AND decided_at IS NOT NULL AND julianday(decided_at) < julianday('now', '-' || ? || ' days')`;
    this.deleteDecidedBackersStmt = db.prepare(
      `DELETE FROM agent_proposal_backers WHERE proposal_id IN (SELECT id FROM agent_proposals WHERE ${decidedOld})`,
    );
    this.deleteDecidedStmt = db.prepare(`DELETE FROM agent_proposals WHERE ${decidedOld}`);
  }

  /** Runs `fn` in one SQLite transaction: everything it writes lands together or not at all. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /** A new pending Proposal with its first backer. */
  create(proposal: NewProposal, backer: Omit<NewBacker, 'proposalId'>): void {
    this.transaction(() => {
      this.insertStmt.run({
        id: proposal.id,
        connection_id: proposal.connectionId,
        connection_name: proposal.connectionName,
        source_db: proposal.sourceDb,
        source_collection: proposal.sourceCollection,
        source_field: proposal.sourceField,
        target_db: proposal.targetDb,
        target_collection: proposal.targetCollection,
        target_field: proposal.targetField,
        pair_key: proposal.pairKey,
        created_at: proposal.createdAt,
        expires_at: proposal.expiresAt,
      });
      this.addBacker({ ...backer, proposalId: proposal.id });
    });
  }

  addBacker(backer: NewBacker): void {
    const id = randomUUID();
    this.insertBackerStmt.run({
      id,
      proposal_id: backer.proposalId,
      token_id: backer.tokenId,
      token_name: backer.tokenName,
      session_id: backer.sessionId,
      client_name: backer.clientName,
      reason: this.cipher.seal('agent_proposal_backers', 'reason', id, backer.reason),
      created_at: backer.createdAt,
    });
  }

  findById(id: string): StoredProposal | null {
    const row = this.findStmt.get(id) as ProposalDbRow | undefined;
    return row ? toStored(row) : null;
  }

  /** The open Proposal for a pair; there is at most one. */
  findOpenByPair(pairKey: string): StoredProposal | null {
    const row = this.findOpenByPairStmt.get(pairKey) as ProposalDbRow | undefined;
    return row ? toStored(row) : null;
  }

  /** Whether `tokenId` backs the Proposal. */
  backs(proposalId: string, tokenId: string): boolean {
    return this.backsStmt.get(proposalId, tokenId) !== undefined;
  }

  /** How many open Proposals `tokenId` backs, created or joined. */
  countOpenBackedBy(tokenId: string): number {
    return (this.countOpenBackedStmt.get(tokenId) as { n: number }).n;
  }

  /** Every open Proposal, oldest first. */
  listOpen(): StoredProposal[] {
    return (this.listOpenStmt.all() as ProposalDbRow[]).map(toStored);
  }

  /**
   * Moves a Proposal to `to` when its status is one of `from`. `decidedAt` is
   * the decision time, or null for a move between the open statuses. True
   * when the row moved.
   */
  setStatus(id: string, from: readonly AgentProposalStatus[], to: AgentProposalStatus, decidedAt: string | null): boolean {
    const placeholders = from.map(() => '?').join(', ');
    const stmt = this.db.prepare(`UPDATE agent_proposals SET status = ?, decided_at = ? WHERE id = ? AND status IN (${placeholders})`);
    return stmt.run(to, decidedAt, id, ...from).changes > 0;
  }

  /** Accepts an open Proposal with the rule it created. True when it was open. */
  markAccepted(id: string, ruleId: string, savedFor: AgentProposalSavedFor, decidedAt: string): boolean {
    return this.acceptStmt.run(ruleId, savedFor, decidedAt, id).changes > 0;
  }

  /** Expires every open Proposal whose time is up at `now`. Returns how many. */
  expireDue(now: string): number {
    return this.expireDueStmt.run(now, now).changes;
  }

  /** Deletes Proposals decided more than `days` days ago, with their backers. Open ones are never deleted. */
  deleteDecidedOlderThan(days: number): number {
    return this.transaction(() => {
      this.deleteDecidedBackersStmt.run(days);
      return this.deleteDecidedStmt.run(days).changes;
    });
  }

  /** Newest first on `(created_at, id)`, keyset-paged, each with its backers, first backer first. */
  list(query: AgentProposalsQuery): AgentProposal[] {
    const clauses: string[] = [];
    const params: Record<string, string | number> = { limit: query.limit };
    if (query.status === 'open') clauses.push(`p.${OPEN_SQL}`);
    else if (query.status === 'decided') clauses.push(`p.status NOT IN ('pending', 'later')`);
    if (query.connectionId !== undefined) {
      clauses.push('p.connection_id = @connectionId');
      params.connectionId = query.connectionId;
    }
    if (query.sessionId !== undefined) {
      clauses.push('EXISTS (SELECT 1 FROM agent_proposal_backers b WHERE b.proposal_id = p.id AND b.session_id = @sessionId)');
      params.sessionId = query.sessionId;
    }
    if (query.before) {
      clauses.push('(p.created_at < @beforeCreatedAt OR (p.created_at = @beforeCreatedAt AND p.id < @beforeId))');
      params.beforeCreatedAt = query.before.createdAt;
      params.beforeId = query.before.id;
    }
    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
    let stmt = this.listStmts.get(where);
    if (!stmt) {
      stmt = this.db.prepare(`SELECT p.* FROM agent_proposals p ${where} ORDER BY p.created_at DESC, p.id DESC LIMIT @limit`);
      this.listStmts.set(where, stmt);
    }
    const rows = (stmt.all(params) as ProposalDbRow[]).map(toStored);
    const backers = this.backersOf(rows.map((r) => r.id));
    return rows.map((row) => ({ ...row, backers: backers.get(row.id) ?? [] }));
  }

  /** The backers of each Proposal, first backer first. A reason that cannot be opened reads as none. */
  backersOf(proposalIds: readonly string[]): Map<string, AgentProposalBacker[]> {
    const out = new Map<string, AgentProposalBacker[]>();
    if (proposalIds.length === 0) return out;
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_proposal_backers WHERE proposal_id IN (${proposalIds.map(() => '?').join(', ')}) ORDER BY created_at, rowid`,
      )
      .all(...proposalIds) as BackerDbRow[];
    for (const row of rows) {
      const backer: AgentProposalBacker = {
        tokenId: row.token_id,
        tokenName: row.token_name,
        sessionId: row.session_id,
        clientName: row.client_name,
        reason: openListedCell(this.cipher, this.log, 'agent_proposal_backers', 'reason', row.id, row.reason),
        createdAt: row.created_at,
      };
      const list = out.get(row.proposal_id);
      if (list) list.push(backer);
      else out.set(row.proposal_id, [backer]);
    }
    return out;
  }
}

function toStored(row: ProposalDbRow): StoredProposal {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    connectionId: row.connection_id,
    connectionName: row.connection_name,
    sourceDb: row.source_db,
    sourceCollection: row.source_collection,
    sourceField: row.source_field,
    targetDb: row.target_db,
    targetCollection: row.target_collection,
    targetField: row.target_field,
    pairKey: row.pair_key,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    expiresAt: row.expires_at,
    ruleId: row.rule_id,
    savedFor: row.saved_for,
  };
}
