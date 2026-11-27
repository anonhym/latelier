import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import type { AgentSessionEndReason } from '@shared/types';
import { NotFoundError } from '../errors.ts';
import type { Logger } from '../log.ts';
import { ensurePrivateDir, writePrivateFile } from '../utils/privateFs.ts';
import { AgentSession, type AgentSessionSnapshot, type AgentSessionStore } from './AgentSession.ts';
import { cleanFolder } from './folderDisplay.ts';
import type { AgentSessionIdentity } from './AgentGate.ts';
import type { AgentToolRunner } from './AgentToolRunner.ts';
import type { AgentTool } from './tools.ts';
import { ensureOwnedPrivateDir } from './ownedDir.ts';
import { agentDir, endpointFile, resolveEndpoint, type ResolvedEndpoint } from './endpoint.ts';
import { readHandshake, refuse } from './handshake.ts';
import { hashToken, matchHash } from './token.ts';

export interface AgentServerDeps {
  userData: string;
  runner: AgentToolRunner;
  tools: readonly AgentTool[];
  tokens: {
    list(): Array<{ id: string; name: string; token_hash: string }>;
  };
  log: Pick<Logger, 'info' | 'warn' | 'error'>;
  /** Where each counted session's row is written and closed (X27 §16.2). */
  sessions: AgentSessionStore;
  /** Whether Agent Access is on: a session the runner ends after its token check failed ended for this reason or because its token went away. */
  accessOn: () => boolean;
  now?: () => Date;
  platform?: NodeJS.Platform;
  tmpdir?: string;
  uid?: string | number;
  /** Defaults to `$XDG_RUNTIME_DIR`. */
  xdgRuntimeDir?: string | null;
}

/** A counted session opened, or a counted session closed (its `endReason` is set). */
export interface AgentSessionEvent {
  kind: 'opened' | 'closed';
  session: AgentSession;
}

/**
 * The socket server in main (X27 §4). It authenticates each connection with
 * the handshake, then hands the socket to an `AgentSession`. It owns the
 * socket file and the endpoint file the bridge reads.
 */
export class AgentServer {
  private deps: AgentServerDeps;
  private listener: net.Server | null = null;
  private endpoint: ResolvedEndpoint | null = null;
  private sessions = new Set<AgentSession>();
  private pending = new Set<net.Socket>();
  private onSessionsChanged: ((event: AgentSessionEvent) => void) | null = null;

  constructor(deps: AgentServerDeps) {
    this.deps = deps;
  }

  /** The path or pipe name the server listens on; null while it is not listening. */
  get socketPath(): string | null {
    return this.listener ? (this.endpoint?.path ?? null) : null;
  }

  /** Sessions past a discovery probe: what presence shows as connected clients (X29 §2). */
  get sessionCount(): number {
    let count = 0;
    for (const session of this.sessions) if (session.isActive) count += 1;
    return count;
  }

  /** Called when a session is counted (its row written) and when a counted session closes. */
  setSessionsListener(fn: ((event: AgentSessionEvent) => void) | null): void {
    this.onSessionsChanged = fn;
  }

  /** The counted, live sessions, oldest first. */
  liveSessions(): AgentSessionSnapshot[] {
    const out: AgentSessionSnapshot[] = [];
    for (const session of this.sessions) {
      const snapshot = session.snapshot();
      if (snapshot) out.push(snapshot);
    }
    return out;
  }

  /** Ends one live session at the user's request. */
  endSession(sessionId: string): void {
    for (const session of this.sessions) {
      if (session.isActive && session.identity.sessionId === sessionId) {
        session.close('user-ended');
        return;
      }
    }
    throw new NotFoundError(`agent session ${sessionId} is not live`);
  }

  /**
   * Starts listening. Returns false, after logging, when something already
   * answers on the socket: a second instance must not take it over.
   */
  async start(): Promise<boolean> {
    if (this.listener) return true;
    const platform = this.deps.platform ?? process.platform;
    const endpointPath = endpointFile(this.deps.userData);
    const endpoint = resolveEndpoint({
      platform,
      userData: this.deps.userData,
      tmpdir: this.deps.tmpdir ?? os.tmpdir(),
      uid: this.deps.uid ?? process.getuid?.() ?? 'user',
      xdgRuntimeDir: this.deps.xdgRuntimeDir === undefined ? process.env.XDG_RUNTIME_DIR : this.deps.xdgRuntimeDir,
      randomHex: (n) => randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n),
    });
    // The 0700 agent/ directory is the real access control on Unix; the
    // socket's own mode below is a second line.
    ensurePrivateDir(agentDir(this.deps.userData));
    if (endpoint.dir !== null) {
      // The fallback lives where another user may have planted the name: it must be ours, a real directory, 0700.
      if (endpoint.fallback) ensureOwnedPrivateDir(endpoint.dir, process.getuid?.() ?? -1);
      else ensurePrivateDir(endpoint.dir);
    }
    if (endpoint.kind === 'unix' && !(await this.clearStaleSocket(endpoint.path))) {
      this.deps.log.warn('agent', 'another process answers on the Agent socket; not starting');
      return false;
    }

    // A file left by a run that crashed names an endpoint nothing serves. On Windows another local process could create that pipe name and be handed the token by a bridge that read the file, so it goes before anything listens, not when the new name is written.
    fs.rmSync(endpointPath, { force: true });

    const listener = net.createServer((socket) => void this.accept(socket));
    listener.on('error', (err) => this.deps.log.error('agent', 'listener error', { errName: err.name }));
    try {
      await new Promise<void>((resolve, reject) => {
        listener.once('error', reject);
        listener.listen(endpoint.path, () => {
          listener.off('error', reject);
          resolve();
        });
      });
      if (endpoint.kind === 'unix') fs.chmodSync(endpoint.path, 0o600);
      await writePrivateFile(endpointPath, `${endpoint.path}\n`);
    } catch (err) {
      // The bridge reads this file to find the endpoint: never leave one that
      // names a pipe or socket nothing serves.
      if (listener.listening) await new Promise<void>((resolve) => listener.close(() => resolve()));
      if (endpoint.kind === 'unix') fs.rmSync(endpoint.path, { force: true });
      fs.rmSync(endpointPath, { force: true });
      throw err;
    }
    this.listener = listener;
    this.endpoint = endpoint;
    this.deps.log.info('agent', 'agent server listening', { fallbackPath: endpoint.fallback });
    return true;
  }

  /** Closes the listener and every session, recording why, and removes the socket and endpoint files. */
  async stop(reason: AgentSessionEndReason): Promise<void> {
    const listener = this.listener;
    const endpoint = this.endpoint;
    this.listener = null;
    this.endpoint = null;
    for (const session of [...this.sessions]) session.destroy(reason);
    for (const socket of this.pending) socket.destroy();
    if (listener) await new Promise<void>((resolve) => listener.close(() => resolve()));
    if (endpoint?.kind === 'unix') fs.rmSync(endpoint.path, { force: true });
    fs.rmSync(endpointFile(this.deps.userData), { force: true });
  }

  /** Ends every live session that authenticated with this token (revoked or regenerated). */
  closeSessionsForToken(tokenId: string): void {
    for (const session of [...this.sessions]) {
      if (session.identity.tokenId === tokenId) session.close('token-revoked');
    }
  }

  /** The Agent was renamed: its live sessions write the new name from their next call on. */
  renameToken(tokenId: string, name: string): void {
    for (const session of this.sessions) {
      if (session.identity.tokenId === tokenId) session.identity.tokenName = name;
    }
  }

  private async accept(socket: net.Socket): Promise<void> {
    // A reset must never become an uncaught exception, here or inside the session.
    socket.on('error', () => socket.destroy());
    this.pending.add(socket);
    const outcome = await readHandshake(socket);
    this.pending.delete(socket);
    if (!outcome.ok) {
      this.deps.log.warn('agent', 'handshake refused', { reason: outcome.refusal });
      refuse(socket, outcome.refusal);
      return;
    }
    const tokenHash = hashToken(outcome.token);
    const row = matchHash(tokenHash, this.deps.tokens.list());
    if (!row) {
      this.deps.log.warn('agent', 'handshake refused', { reason: 'unknown-token' });
      refuse(socket, 'refused');
      return;
    }
    const identity: AgentSessionIdentity = {
      sessionId: randomUUID(),
      tokenId: row.id,
      tokenHash,
      tokenName: row.name,
      clientName: null,
      clientVersion: null,
    };
    // Display-only and reported, not proven: cleaned here, never logged.
    const folder = outcome.folder === null ? null : cleanFolder(outcome.folder);
    const session = new AgentSession({
      socket,
      identity,
      runner: this.deps.runner,
      tools: this.deps.tools,
      log: this.deps.log,
      store: this.deps.sessions,
      folder: folder === '' ? null : folder,
      refusedReason: () => (this.deps.accessOn() ? 'token-revoked' : 'access-off'),
      ...(this.deps.now ? { now: this.deps.now } : {}),
      onActive: (s) => {
        // Not under the key `token`: the logger redacts any value filed under that name, so the Agent's name would never show.
        this.deps.log.info('agent', 'session opened', { agentName: row.name });
        this.onSessionsChanged?.({ kind: 'opened', session: s });
      },
      onClosed: (s) => {
        if (this.sessions.delete(s) && s.isActive) this.onSessionsChanged?.({ kind: 'closed', session: s });
      },
    });
    // Counted in presence only once it is active: a client's discovery probe opens and closes a session of its own.
    this.sessions.add(session);
    try {
      await session.start();
    } catch (err) {
      this.deps.log.error('agent', 'session failed to start', { errName: err instanceof Error ? err.name : typeof err });
      session.destroy('unknown');
    }
  }

  /** True when the path is free: absent, or a leftover nothing answers on (which is then removed). */
  private clearStaleSocket(socketPath: string): Promise<boolean> {
    if (!fs.existsSync(socketPath)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const probe = net.connect(socketPath);
      probe.once('connect', () => {
        probe.destroy();
        resolve(false);
      });
      probe.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ECONNREFUSED' || err.code === 'ENOENT') {
          fs.rmSync(socketPath, { force: true });
          resolve(true);
        } else {
          this.deps.log.warn('agent', 'could not probe the Agent socket', { errCode: err.code });
          resolve(false);
        }
      });
    });
  }
}
