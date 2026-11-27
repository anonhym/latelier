import type { AgentAccessState, AgentConnectionRequest } from '@shared/types';
import { ago } from './agentsTime';

/**
 * One open request in Needs you (X30 §8). Only Connection requests exist so
 * far; Proposals join this union as another kind, and `needsYouCount` is the
 * one place that counts them for the badge.
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

export type NeedsYouItem = ConnectionRequestItem;

/** The badge's count: open Connection requests. */
export function needsYouCount(state: Pick<AgentAccessState, 'connectionRequests'> | null): number {
  return state?.connectionRequests.length ?? 0;
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

/** Every open request, newest first. */
export function needsYouItems(state: Pick<AgentAccessState, 'connectionRequests'> | null, now: number): NeedsYouItem[] {
  if (!state) return [];
  return [...state.connectionRequests]
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
    .map((req) => ({
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

/** Open requests per session, for the sidebar's session badge. */
export function requestsBySession(state: Pick<AgentAccessState, 'connectionRequests'> | null): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of state?.connectionRequests ?? []) out.set(r.sessionId, (out.get(r.sessionId) ?? 0) + 1);
  return out;
}
