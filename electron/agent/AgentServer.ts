import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import type { Logger } from '../log.ts';
import { ensurePrivateDir, writePrivateFile } from '../utils/privateFs.ts';
import { AgentSession } from './AgentSession.ts';
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
  platform?: NodeJS.Platform;
  tmpdir?: string;
  uid?: string | number;
  /** Defaults to `$XDG_RUNTIME_DIR`. */
  xdgRuntimeDir?: string | null;
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
  private onSessionsChanged: (() => void) | null = null;

  constructor(deps: AgentServerDeps) {
    this.deps = deps;
  }

  /** The path or pipe name the server listens on; null while it is not listening. */
  get socketPath(): string | null {
    return this.listener ? (this.endpoint?.path ?? null) : null;
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  /** Called whenever a session opens or closes. */
  setSessionsListener(fn: (() => void) | null): void {
    this.onSessionsChanged = fn;
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

  /** Closes the listener and every session, and removes the socket and endpoint files. */
  async stop(): Promise<void> {
    const listener = this.listener;
    const endpoint = this.endpoint;
    this.listener = null;
    this.endpoint = null;
    for (const session of [...this.sessions]) session.destroy();
    for (const socket of this.pending) socket.destroy();
    if (listener) await new Promise<void>((resolve) => listener.close(() => resolve()));
    if (endpoint?.kind === 'unix') fs.rmSync(endpoint.path, { force: true });
    fs.rmSync(endpointFile(this.deps.userData), { force: true });
  }

  /** Ends every live session that authenticated with this token (revoked or regenerated). */
  closeSessionsForToken(tokenId: string): void {
    for (const session of [...this.sessions]) {
      if (session.identity.tokenId === tokenId) session.close();
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
    const session = new AgentSession({
      socket,
      identity,
      runner: this.deps.runner,
      tools: this.deps.tools,
      log: this.deps.log,
      onClosed: (s) => {
        if (this.sessions.delete(s)) this.onSessionsChanged?.();
      },
    });
    this.sessions.add(session);
    this.onSessionsChanged?.();
    // Not under the key `token`: the logger redacts any value filed under that name, so the Agent's name would never show.
    this.deps.log.info('agent', 'session opened', { agentName: row.name });
    try {
      await session.start();
    } catch (err) {
      this.deps.log.error('agent', 'session failed to start', { errName: err instanceof Error ? err.name : typeof err });
      session.destroy();
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
