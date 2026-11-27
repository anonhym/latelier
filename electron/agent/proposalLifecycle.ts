import type { AgentProposalStatus } from '@shared/types';

/**
 * The life of an Agent Proposal (X28 §3) and the decision a new proposal call
 * makes (X28 §4.1 steps 6–8), kept free of SQLite and the clock so every rule
 * is tested on its own.
 */

/** A Proposal stays open this long after it was filed. */
export const PROPOSAL_TTL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** How many open Proposals one Agent Token may back at once. */
export const MAX_OPEN_PER_TOKEN = 20;

export const OPEN_STATUSES = ['pending', 'later'] as const satisfies readonly AgentProposalStatus[];
export const DECIDED_STATUSES = ['accepted', 'declined', 'expired', 'obsolete'] as const satisfies readonly AgentProposalStatus[];

/** What moves a Proposal: the user's three choices, reopening, and the two the app applies on its own. */
export type ProposalEvent = 'later' | 'reopen' | 'accept' | 'decline' | 'expire' | 'obsolete';

export function isOpen(status: AgentProposalStatus): boolean {
  return status === 'pending' || status === 'later';
}

/**
 * The status `event` moves `current` to, or null when it may not: a decided
 * Proposal never moves again, Not now applies only to a pending one, and only
 * a later one can be reopened.
 */
export function nextStatus(current: AgentProposalStatus, event: ProposalEvent): AgentProposalStatus | null {
  if (!isOpen(current)) return null;
  switch (event) {
    case 'later':
      return current === 'pending' ? 'later' : null;
    case 'reopen':
      return current === 'later' ? 'pending' : null;
    case 'accept':
      return 'accepted';
    case 'decline':
      return 'declined';
    case 'expire':
      return 'expired';
    case 'obsolete':
      return 'obsolete';
  }
}

/** When a Proposal filed at `createdAt` expires: 30 days later, as ISO-8601. */
export function expiresAt(createdAt: string): string {
  return new Date(Date.parse(createdAt) + PROPOSAL_TTL_DAYS * DAY_MS).toISOString();
}

/** Whether a Proposal that expires at `expires` has expired at `nowMs`. The instant itself counts as expired. */
export function isExpired(nowMs: number, expires: string): boolean {
  return nowMs >= Date.parse(expires);
}

export interface SourceFieldRef {
  sourceDb: string;
  sourceCollection: string;
  sourceField: string;
}

/**
 * Whether `rules` already hold one for the source field, from any source and
 * whether or not it is switched on: X26's suppression rule. Check 5 of a new
 * proposal, the obsolete rule and accept's re-check all ask this one question.
 */
export function coversSourceField(rules: readonly SourceFieldRef[], source: SourceFieldRef): boolean {
  return rules.some(
    (r) => r.sourceDb === source.sourceDb && r.sourceCollection === source.sourceCollection && r.sourceField === source.sourceField,
  );
}

export interface SweepRow extends SourceFieldRef {
  status: AgentProposalStatus;
  expiresAt: string;
}

export interface SweepContext {
  nowMs: number;
  /** Whether the Proposal's Connection still exists. */
  connectionExists: boolean;
  /** The Connection's effective rules on the source collection. */
  rules: readonly SourceFieldRef[];
}

/**
 * The event the app applies to an open Proposal when it is listed or shown:
 * `expire` once its Connection is gone or its 30 days are up, `obsolete` once
 * a rule covers its source field, otherwise none. A decided one is left alone.
 */
export function sweepEvent(row: SweepRow, ctx: SweepContext): 'expire' | 'obsolete' | null {
  if (!isOpen(row.status)) return null;
  if (!ctx.connectionExists || isExpired(ctx.nowMs, row.expiresAt)) return 'expire';
  if (coversSourceField(ctx.rules, row)) return 'obsolete';
  return null;
}

/**
 * What a proposal call does once checks 1–5 passed (X28 §4.1):
 * - `repeat`: this token already backs the open Proposal for the pair; nothing is written. Before the cap, so a lost response can always be recovered.
 * - `limit`: the token backs the maximum of open Proposals; refused.
 * - `join`: another token's open Proposal exists; this token becomes a backer.
 * - `create`: a new pending Proposal.
 */
export type ProposeAction = 'repeat' | 'limit' | 'join' | 'create';

export interface ProposeFacts {
  /** An open Proposal exists for the pair. */
  openExists: boolean;
  /** This token backs that open Proposal. */
  tokenBacksOpen: boolean;
  /** How many open Proposals this token backs. */
  tokenOpenCount: number;
}

export function proposeAction(facts: ProposeFacts): ProposeAction {
  if (facts.openExists && facts.tokenBacksOpen) return 'repeat';
  if (facts.tokenOpenCount >= MAX_OPEN_PER_TOKEN) return 'limit';
  return facts.openExists ? 'join' : 'create';
}
