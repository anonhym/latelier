import type { MongoClient } from 'mongodb';
import type { ConnectionRuntime } from '@shared/types';
import type { Logger } from '../log.ts';
import { Semaphore } from './concurrency.ts';
import { AgentToolError } from './errorMap.ts';
import { evaluateGates, type GateVerdict } from './gate.ts';
import { matchHash } from './token.ts';

/** Who is on the other end of one socket. Set once, at the handshake. */
export interface AgentSessionIdentity {
  sessionId: string;
  tokenId: string;
  /** The hash the session authenticated with; the session ends when the stored hash stops matching it. */
  tokenHash: string;
  tokenName: string;
  clientName: string | null;
  clientVersion: string | null;
}

export interface SharedConnection {
  id: string;
  name: string;
}

/** The slice of `MongoPool` the gate uses. It reads a status and opens its own client, and nothing else: never `connect`, `readDb` or `readClient`. */
export interface AgentPool {
  status(id: string): Pick<ConnectionRuntime, 'status'>;
  /** `signal` abandons a client that is still opening: its rejection is how a revocation or a quit stops waiting on a server that never answers. */
  openAgentClient(id: string, signal: AbortSignal): Promise<MongoClient>;
  on(event: 'status', listener: (runtime: Pick<ConnectionRuntime, 'id' | 'status'>) => void): unknown;
  off(event: 'status', listener: (runtime: Pick<ConnectionRuntime, 'id' | 'status'>) => void): unknown;
}

/** One admitted Agent operation. Everything a tool needs to run, and to stop when told to. */
export interface AgentLease {
  client: MongoClient;
  /** Aborts on revocation, on the client's `notifications/cancelled` and when the transport closes. Pass it to every driver call. */
  signal: AbortSignal;
  /** Call after every `await` that returns data, before serialising it: throws CANCELLED once any gate has closed. */
  assertStill(): void;
  /** Frees the concurrency slot. Idempotent. */
  release(): void;
}

export interface AgentGateDeps {
  /** Live: reads the app-state switch on every call, never a cached copy. */
  accessOn: () => boolean;
  connections: {
    findById(id: string): { id: string; name: string; share_with_agents?: number } | null;
    listShared(): Array<{ id: string; name: string }>;
  };
  /** The gate never connects: a call that could wake a Dormant Connection is the bug it exists to prevent. */
  pool: AgentPool;
  tokens: { findById(id: string): { token_hash: string } | null };
  log?: Pick<Logger, 'warn'>;
}

/** How long a quit waits for agent clients to finish closing before it moves on to the rest of the teardown. */
export const CLOSE_BUDGET_MS = 1000;

/** An agent client, opening or open, with the controller that abandons its open. */
interface ClientEntry {
  promise: Promise<MongoClient>;
  ctrl: AbortController;
}

/** Settles like `promise`, or rejects with CANCELLED the moment `signal` aborts. The promise itself is left running. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      promise.catch(() => undefined);
      reject(new AgentToolError('CANCELLED'));
      return;
    }
    const onAbort = () => reject(new AgentToolError('CANCELLED'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

/** An operation in flight, registered so a revocation can abort it. */
interface InFlight {
  connectionId: string;
  tokenId: string;
  ctrl: AbortController;
}

/**
 * The gate in front of every Agent read (X27 §2, §6.1). It checks the gates and
 * the session's token on every acquisition, hands out the Connection's own
 * agent client (never the user's pooled one), caps concurrency per Connection,
 * and keeps each operation's `AbortController` so a revocation (§10) stops it.
 */
export class AgentGate {
  private deps: AgentGateDeps;
  private inFlight = new Set<InFlight>();
  private limits = new Map<string, Semaphore>();
  private clients = new Map<string, ClientEntry>();
  private closing = new Set<Promise<void>>();
  private onStatus: (runtime: Pick<ConnectionRuntime, 'id' | 'status'>) => void;

  constructor(deps: AgentGateDeps) {
    this.deps = deps;
    // Closed, dropped, deleted or edited: every one ends in a status other than `connected`.
    this.onStatus = (runtime) => {
      if (runtime.status !== 'connected') this.revokeConnection(runtime.id);
    };
    deps.pool.on('status', this.onStatus);
  }

  /** Stops following the pool. Call `close` first when operations may still be running. */
  dispose(): void {
    this.deps.pool.off('status', this.onStatus);
  }

  /** Whether the session's token still matches the stored hash and Agent Access is on. */
  checkToken(session: AgentSessionIdentity): GateVerdict {
    if (!this.deps.accessOn()) return 'ACCESS_OFF';
    const row = this.deps.tokens.findById(session.tokenId);
    // matchHash compares in constant time; a revoked token has no row, a regenerated one a new hash.
    if (!row || matchHash(session.tokenHash, [row]) === null) return 'ACCESS_OFF';
    return 'ok';
  }

  /** The three gates for one Connection, in the order a refusal is reported. An unknown id reads as not shared. */
  checkConnection(connectionId: string): GateVerdict {
    const row = this.deps.connections.findById(connectionId);
    return evaluateGates({
      accessOn: this.deps.accessOn(),
      shared: row?.share_with_agents === 1,
      status: this.deps.pool.status(connectionId).status,
    });
  }

  /** Throws the refusal for a Connection that fails a gate. */
  assertConnection(connectionId: string): void {
    const verdict = this.checkConnection(connectionId);
    if (verdict !== 'ok') throw new AgentToolError(verdict);
  }

  /** Shared Connections with whether an Agent can use them now; never a host, URI, user or Read-Only flag. */
  listShared(): Array<SharedConnection & { state: 'available' | 'unavailable' }> {
    return this.deps.connections.listShared().map((row) => ({
      id: row.id,
      name: row.name,
      state: this.deps.pool.status(row.id).status === 'connected' ? 'available' : 'unavailable',
    }));
  }

  /**
   * Admits one operation: the gates and the token, a concurrency slot (BUSY past
   * the queue), then the Connection's agent client, opened on first use. The
   * gates are read again after each wait. Never connects the Connection.
   */
  async acquire(connectionId: string, session: AgentSessionIdentity, mcpSignal: AbortSignal): Promise<AgentLease> {
    if (this.checkToken(session) !== 'ok') throw new AgentToolError('ACCESS_OFF');
    this.assertConnection(connectionId);
    const entry: InFlight = { connectionId, tokenId: session.tokenId, ctrl: new AbortController() };
    this.inFlight.add(entry);
    const signal = AbortSignal.any([mcpSignal, entry.ctrl.signal]);
    const assertStill = () => this.assertStill(connectionId, session, signal);
    const limit = this.limitFor(connectionId);
    let releaseSlot: (() => void) | null = null;
    const release = () => {
      const free = releaseSlot;
      releaseSlot = null;
      free?.();
      this.inFlight.delete(entry);
      if (limit.idle && this.limits.get(connectionId) === limit) this.limits.delete(connectionId);
    };
    try {
      releaseSlot = await limit.acquire(signal);
      // Before the open: a revocation that landed while this call waited found no client to close, so opening one now would cache a client for a Connection that is no longer open.
      assertStill();
      const client = await untilAborted(this.clientFor(connectionId), signal);
      // And again after it: a gate that closed during the open refuses the call here.
      assertStill();
      return { client, signal, assertStill, release };
    } catch (err) {
      release();
      // No client may outlive a Connection that fails its gates, whichever wait the refusal came from.
      if (this.checkConnection(connectionId) !== 'ok') this.closeClient(connectionId);
      throw err;
    }
  }

  /** Aborts what is running on one Connection and closes its agent client: unshared, closed, dropped, deleted or edited. */
  revokeConnection(connectionId: string): void {
    for (const entry of this.inFlight) if (entry.connectionId === connectionId) entry.ctrl.abort();
    this.closeClient(connectionId);
  }

  /** Aborts what one token's sessions are running: the token was revoked or regenerated. */
  revokeToken(tokenId: string): void {
    for (const entry of this.inFlight) if (entry.tokenId === tokenId) entry.ctrl.abort();
  }

  /** Aborts everything and closes every agent client: Agent Access went off, or the app is quitting. */
  revokeAll(): void {
    for (const entry of this.inFlight) entry.ctrl.abort();
    for (const connectionId of [...this.clients.keys()]) this.closeClient(connectionId);
  }

  /**
   * `revokeAll`, then resolves once every agent client has closed, or after
   * `budgetMs`: an unresponsive server must not hold the quit teardown, and a
   * client still closing then finishes on its own.
   */
  async close(budgetMs = CLOSE_BUDGET_MS): Promise<void> {
    this.revokeAll();
    let timer: NodeJS.Timeout | undefined;
    const budget = new Promise<'late'>((resolve) => {
      timer = setTimeout(() => resolve('late'), budgetMs);
      timer.unref();
    });
    const outcome = await Promise.race([this.whenClosed().then(() => 'closed' as const), budget]);
    clearTimeout(timer);
    if (outcome === 'late') this.deps.log?.warn('agent', 'agent clients were still closing at the end of the budget', { budgetMs });
  }

  /** Resolves when every agent client closing right now has finished. */
  async whenClosed(): Promise<void> {
    await Promise.all([...this.closing]);
  }

  /** Whether an agent client exists (or is opening) for the Connection. */
  hasClient(connectionId: string): boolean {
    return this.clients.has(connectionId);
  }

  private assertStill(connectionId: string, session: AgentSessionIdentity, signal: AbortSignal): void {
    if (signal.aborted || this.checkToken(session) !== 'ok' || this.checkConnection(connectionId) !== 'ok') {
      throw new AgentToolError('CANCELLED');
    }
  }

  private limitFor(connectionId: string): Semaphore {
    let limit = this.limits.get(connectionId);
    if (!limit) {
      limit = new Semaphore();
      this.limits.set(connectionId, limit);
    }
    return limit;
  }

  private clientFor(connectionId: string): Promise<MongoClient> {
    let opening = this.clients.get(connectionId);
    if (!opening) {
      const ctrl = new AbortController();
      const created: ClientEntry = { promise: this.deps.pool.openAgentClient(connectionId, ctrl.signal), ctrl };
      opening = created;
      this.clients.set(connectionId, created);
      // A failed open is delivered to the caller awaiting it; here it only clears the cache so the next call retries.
      created.promise.then(undefined, () => {
        if (this.clients.get(connectionId) === created) this.clients.delete(connectionId);
      });
    }
    return opening.promise;
  }

  private closeClient(connectionId: string): void {
    const opening = this.clients.get(connectionId);
    if (!opening) return;
    this.clients.delete(connectionId);
    // A client still opening is abandoned: its open rejects at once, so there is nothing to wait for.
    opening.ctrl.abort();
    const closing: Promise<void> = opening.promise
      .then(
        (client) => client.close(),
        () => undefined,
      )
      .catch((err: unknown) => {
        this.deps.log?.warn('agent', 'closing an agent client failed', {
          connectionId,
          errName: err instanceof Error ? err.name : typeof err,
        });
      })
      .finally(() => this.closing.delete(closing));
    this.closing.add(closing);
  }
}
