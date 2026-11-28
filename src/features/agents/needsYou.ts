import type { AgentAccessState, AgentConnectionRequest, AgentProposal, AgentSessionInfo } from '@shared/types';
import { ago } from './agentsTime';
import { proposalPairText, proposalWho, reviewSessionId } from './proposalView';

/**
 * One open request in Needs you (X30 §8): a Connection request or a Proposal.
 * `needsYouCount` is the one count behind the switch's badge (requests and
 * `pending` Proposals; a `later` one is listed apart and not counted),
 * `needsYouItems` merges them newest first, and `NeedsYouList` draws each by
 * its `kind`.
 */
export interface ConnectionRequestItem {
  kind: 'connection-request';
  key: string;
  sessionId: string;
  connectionId: string;
  /** Who asked: the Agent's name, never empty. Text only. */
  agent: string;
  connectionName: string;
  /** `waiting`: the call is paused in the Agent's host; `refused`: it came back refused. */
  outcome: AgentConnectionRequest['lastOutcome'];
  client: string | null;
  /** When the request last changed, for ordering. */
  at: string;
  /** "claude-code · ~/Projects/shop-api · 2m ago · find on shop.orders". Text only. */
  meta: string;
}

/** An open Proposal (X28): `pending` in the list, `later` under Later. */
export interface ProposalItem {
  kind: 'proposal';
  /** `proposal:{id}`: never a request's key, whose session id is a UUID. */
  key: string;
  proposal: AgentProposal;
  status: 'pending' | 'later';
  /** The first backer's name. Text only. */
  agent: string;
  /** " proposes", or " and 1 other Agent propose". */
  rest: string;
  /** `orders.customerId → customers._id`. Text only. */
  pair: string;
  /** The first backer's session: where Review opens it; null when it was not kept. */
  sessionId: string | null;
  at: string;
  /** "claude-code · ~/Projects/shop-api · 2m ago". Text only. */
  meta: string;
}

export type NeedsYouItem = ConnectionRequestItem | ProposalItem;

type Requests = Pick<AgentAccessState, 'connectionRequests'> | null;
type Sessions = ReadonlyArray<Pick<AgentSessionInfo, 'id' | 'folder'>>;

/** The badge's count: open Connection requests and `pending` Proposals. */
export function needsYouCount(state: Requests, proposals: readonly AgentProposal[]): number {
  return (state?.connectionRequests.length ?? 0) + proposals.filter((p) => p.status === 'pending').length;
}

/** The badge's accessible text. */
export function needsYouLabel(n: number): string {
  return `${n} Agent ${n === 1 ? 'request' : 'requests'}`;
}

function target(req: AgentConnectionRequest): string | null {
  if (req.database && req.collection) return `${req.database}.${req.collection}`;
  return req.database ?? req.collection ?? null;
}

/** Client · folder · time · `{tool} on {db.collection}`, skipping what was not reported. */
export function requestMeta(req: AgentConnectionRequest, now: number): string {
  const on = target(req);
  return [req.clientName, req.folder, ago(req.lastAt, now), on ? `${req.lastTool} on ${on}` : req.lastTool]
    .filter((p): p is string => !!p)
    .join(' · ');
}

function requestItems(state: Requests, now: number): ConnectionRequestItem[] {
  if (!state) return [];
  return state.connectionRequests.map((req) => ({
    kind: 'connection-request' as const,
    key: `${req.sessionId}\u0000${req.connectionId}`,
    sessionId: req.sessionId,
    connectionId: req.connectionId,
    agent: req.tokenName ?? 'An Agent',
    connectionName: req.connectionName,
    outcome: req.lastOutcome,
    client: req.clientName,
    at: req.lastAt,
    meta: requestMeta(req, now),
  }));
}

type OpenProposal = AgentProposal & { status: 'pending' | 'later' };

function isOpen(p: AgentProposal): p is OpenProposal {
  return p.status === 'pending' || p.status === 'later';
}

function toItem(p: OpenProposal, now: number, sessions: Sessions): ProposalItem {
  const sessionId = reviewSessionId(p);
  // Only a live session's folder is known here.
  const folder = sessions.find((s) => s.id === sessionId)?.folder ?? null;
  const who = proposalWho(p);
  return {
    kind: 'proposal',
    key: `proposal:${p.id}`,
    proposal: p,
    status: p.status,
    agent: who.agent,
    rest: who.rest,
    pair: proposalPairText(p),
    sessionId,
    at: p.createdAt,
    meta: [p.backers[0]?.clientName, folder, ago(p.createdAt, now)].filter((x): x is string => !!x).join(' · '),
  };
}

/** One open Proposal as a Needs you item, or null for one that is not open. */
export function proposalItem(p: AgentProposal, now: number, sessions: Sessions): ProposalItem | null {
  return isOpen(p) ? toItem(p, now, sessions) : null;
}

function withStatus(proposals: readonly AgentProposal[], status: OpenProposal['status'], now: number, sessions: Sessions): ProposalItem[] {
  return proposals.filter((p): p is OpenProposal => p.status === status).map((p) => toItem(p, now, sessions));
}

function newestFirst<T extends { at: string; key: string }>(items: T[]): T[] {
  return items.sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
}

/** Every open request and `pending` Proposal, newest first. */
export function needsYouItems(state: Requests, now: number, proposals: readonly AgentProposal[], sessions: Sessions): NeedsYouItem[] {
  return newestFirst<NeedsYouItem>([...requestItems(state, now), ...withStatus(proposals, 'pending', now, sessions)]);
}

/** The `later` Proposals, under Later, newest first. */
export function laterItems(proposals: readonly AgentProposal[], now: number, sessions: Sessions): ProposalItem[] {
  return newestFirst(withStatus(proposals, 'later', now, sessions));
}

/** The items of one session: its Connection requests, and the Proposals any of its backers filed in it. */
export function forSession<T extends NeedsYouItem>(items: readonly T[], sessionId: string): T[] {
  return items.filter((item) =>
    item.kind === 'connection-request' ? item.sessionId === sessionId : item.proposal.backers.some((b) => b.sessionId === sessionId),
  );
}

/**
 * What Needs you holds per session, for the sidebar's session badge: its open
 * requests and the `pending` Proposals it backs, as a session page lists them.
 */
export function needsYouBySession(
  state: Pick<AgentAccessState, 'connectionRequests'> | null,
  proposals: readonly AgentProposal[],
): Map<string, number> {
  const out = new Map<string, number>();
  const add = (sessionId: string) => out.set(sessionId, (out.get(sessionId) ?? 0) + 1);
  for (const r of state?.connectionRequests ?? []) add(r.sessionId);
  for (const p of proposals) {
    if (p.status !== 'pending') continue;
    // Backers are one per Agent, so a session backs a Proposal once.
    for (const b of p.backers) if (b.sessionId) add(b.sessionId);
  }
  return out;
}
