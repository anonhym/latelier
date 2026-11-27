import type { AgentConnectionRequest } from '@shared/types';

/** A request no new refusal has touched for this long is dropped (X27 §16.6). */
export const REQUEST_QUIET_MS = 30 * 60 * 1000;

/** The part of an Agent Read Log row a request is built from. */
export interface RequestSourceRow {
  sessionId: string | null;
  tokenName: string | null;
  clientName: string | null;
  connectionId: string | null;
  connectionName: string | null;
  database: string | null;
  collection: string | null;
  tool: string;
  outcome: string;
}

export type ObserveResult = 'added' | 'updated' | 'ignored';

interface Entry {
  request: AgentConnectionRequest;
  lastAtMs: number;
}

const key = (sessionId: string, connectionId: string): string => `${sessionId}\u0000${connectionId}`;

/**
 * Connection requests (X27 §16.6), in memory only: one per (session,
 * Connection), raised by a call refused `NOT_OPEN` or paused `INPUT_REQUIRED`.
 * Pure bookkeeping with an injected clock; the service decides when a
 * Connection opened, was unshared or a session ended, and tells this class.
 */
export class ConnectionRequests {
  private entries = new Map<string, Entry>();
  /** Pairs the user dismissed, per session: they make no new request until the session ends. */
  private dismissed = new Map<string, Set<string>>();
  private now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /**
   * One Agent Read Log row. Only `NOT_OPEN` and `INPUT_REQUIRED` count, and
   * only with a session, a Connection id and the name the runner read from
   * the repository. `NOT_SHARED` never does: an unknown id reads as not
   * shared, so a request built on it would let an Agent point the user at any
   * id it guessed.
   *
   * A paused call writes two rows, its asking round (`INPUT_REQUIRED`) and
   * its retry; the retry's `NOT_OPEN` concludes that same call, so it moves
   * the request to refused without counting a second call.
   */
  observe(row: RequestSourceRow, folder: string | null): ObserveResult {
    const waiting = row.outcome === 'INPUT_REQUIRED';
    if (!waiting && row.outcome !== 'NOT_OPEN') return 'ignored';
    const { sessionId, connectionId, connectionName } = row;
    if (sessionId === null || connectionId === null || connectionName === null) return 'ignored';
    if (this.dismissed.get(sessionId)?.has(connectionId)) return 'ignored';
    const nowMs = this.now();
    const at = new Date(nowMs).toISOString();
    const lastOutcome = waiting ? 'waiting' : 'refused';
    const existing = this.entries.get(key(sessionId, connectionId));
    if (existing) {
      const concludesPause = !waiting && existing.request.lastOutcome === 'waiting';
      existing.request = {
        ...existing.request,
        connectionName,
        lastAt: at,
        count: existing.request.count + (concludesPause ? 0 : 1),
        lastTool: row.tool,
        database: row.database,
        collection: row.collection,
        lastOutcome,
      };
      existing.lastAtMs = nowMs;
      return 'updated';
    }
    this.entries.set(key(sessionId, connectionId), {
      lastAtMs: nowMs,
      request: {
        sessionId,
        tokenName: row.tokenName,
        clientName: row.clientName,
        folder,
        connectionId,
        connectionName,
        firstAt: at,
        lastAt: at,
        count: 1,
        lastTool: row.tool,
        database: row.database,
        collection: row.collection,
        lastOutcome,
      },
    });
    return 'added';
  }

  /** The user dismissed the pair: its request goes, and the pair makes none for the rest of the session. Returns whether a request went. */
  dismiss(sessionId: string, connectionId: string): boolean {
    let pairs = this.dismissed.get(sessionId);
    if (!pairs) {
      pairs = new Set();
      this.dismissed.set(sessionId, pairs);
    }
    pairs.add(connectionId);
    return this.entries.delete(key(sessionId, connectionId));
  }

  /** The session ended: its requests go, and so do its dismissals. Returns whether a request went. */
  endSession(sessionId: string): boolean {
    this.dismissed.delete(sessionId);
    return this.removeWhere((r) => r.sessionId === sessionId);
  }

  /** The Connection opened, was unshared or deleted. Returns whether a request went. */
  endConnection(connectionId: string): boolean {
    return this.removeWhere((r) => r.connectionId === connectionId);
  }

  /** Drops the requests quiet for `REQUEST_QUIET_MS` or more. Returns whether one went. */
  expire(): boolean {
    const nowMs = this.now();
    let removed = false;
    for (const [k, entry] of this.entries) {
      if (nowMs - entry.lastAtMs >= REQUEST_QUIET_MS) {
        this.entries.delete(k);
        removed = true;
      }
    }
    return removed;
  }

  /** Newest `lastAt` first. Copies: a caller cannot change what is held here. */
  list(): AgentConnectionRequest[] {
    return [...this.entries.values()]
      .sort(
        (a, b) =>
          b.lastAtMs - a.lastAtMs ||
          a.request.sessionId.localeCompare(b.request.sessionId) ||
          a.request.connectionId.localeCompare(b.request.connectionId),
      )
      .map((e) => ({ ...e.request }));
  }

  get size(): number {
    return this.entries.size;
  }

  private removeWhere(test: (r: AgentConnectionRequest) => boolean): boolean {
    let removed = false;
    for (const [k, entry] of this.entries) {
      if (test(entry.request)) {
        this.entries.delete(k);
        removed = true;
      }
    }
    return removed;
  }
}
