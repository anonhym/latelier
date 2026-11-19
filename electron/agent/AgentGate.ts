import type { ConnectionRuntime } from '@shared/types';
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

export interface AgentGateDeps {
  /** Live: reads the app-state switch on every call, never a cached copy. */
  accessOn: () => boolean;
  connections: {
    findById(id: string): { id: string; name: string; share_with_agents?: number } | null;
    listShared(): Array<{ id: string; name: string }>;
  };
  /** Reads a status only. The gate never connects: a call that could wake a Dormant Connection is the bug it exists to prevent. */
  pool: { status(id: string): Pick<ConnectionRuntime, 'status'> };
  tokens: { findById(id: string): { token_hash: string } | null };
}

/**
 * The gate in front of every Agent read (X27 §2, §6.1). This slice carries the
 * checks and the token re-check; the per-Connection agent client, the abort
 * registry and revocation arrive with the read path.
 */
export class AgentGate {
  private deps: AgentGateDeps;

  constructor(deps: AgentGateDeps) {
    this.deps = deps;
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
}
