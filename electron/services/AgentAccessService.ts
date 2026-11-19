import { randomUUID } from 'node:crypto';
import type { MongoClient } from 'mongodb';
import type { AgentAccessState, AgentTokenInfo, ConnectionRuntime, PrivilegeResult } from '@shared/types';
import { AGENT_ACCESS_KEY } from '../ipc/prefKeys.ts';
import type { Logger } from '../log.ts';
import { ConflictError, NotFoundError, ValidationError } from '../errors.ts';
import { classifyMongoOpError } from '../mongo/errors.ts';
import { enableBox, notOpenBox, shareBox, tokenBox, TOKEN_DONE, type AgentMessageBox } from '../agent/dialogCopy.ts';
import type { BridgeHandle } from '../agent/bridgeInstall.ts';
import { failedVerdict, privilegeVerdict } from '../agent/privilegeVerdict.ts';
import { configSnippet, SNIPPET_CLIENTS } from '../agent/snippets.ts';
import { AgentGate, type AgentPool } from '../agent/AgentGate.ts';
import { AgentServer } from '../agent/AgentServer.ts';
import { AgentToolRunner } from '../agent/AgentToolRunner.ts';
import { AGENT_TOOLS } from '../agent/tools.ts';
import { generateToken, hashToken } from '../agent/token.ts';
import type { AgentTokenRepo, AgentTokenRow } from '../db/repositories/AgentTokenRepo.ts';
import type { AgentReadLogRepo } from '../db/repositories/AgentReadLogRepo.ts';
import { connectionIdentityFingerprint, type ConnectionRepo } from '../db/repositories/ConnectionRepo.ts';
import type { AppStateService } from './AppStateService.ts';

/**
 * The gate's slice of the pool plus `readClient`, which only the share-time
 * privilege check uses: it runs on the user's own client, never the agent one,
 * and only once the Connection is known to be open.
 */
export interface AgentAccessPool extends AgentPool {
  readClient(id: string): Promise<MongoClient>;
  /** Emitted when a Connection's identity changes (an edit that points it elsewhere) or the Connection is deleted. */
  on(event: 'status', listener: (runtime: { id: string; status: ConnectionRuntime['status'] }) => void): unknown;
  on(event: 'connection-identity-changed', listener: (id: string) => void): unknown;
  off(event: 'status', listener: (runtime: { id: string; status: ConnectionRuntime['status'] }) => void): unknown;
  off(event: 'connection-identity-changed', listener: (id: string) => void): unknown;
}

/** The native dialogs and clipboard, so the flows that use them run in a test with a scripted box. */
export interface AgentDialogs {
  showMessageBox(options: AgentMessageBox): Promise<{ response: number }>;
  writeClipboard(text: string): Promise<void>;
}

export interface AgentAccessDeps {
  appState: Pick<AppStateService, 'get' | 'set' | 'subscribe'>;
  tokenRepo: AgentTokenRepo;
  readLogRepo: AgentReadLogRepo;
  connRepo: ConnectionRepo;
  pool: AgentAccessPool;
  userData: string;
  log: Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>;
  dialogs: AgentDialogs;
  bridge: BridgeHandle;
  platform: NodeJS.Platform;
  /** Pushes the state to the renderer. The state holds no token. */
  emit: (state: AgentAccessState) => void;
}

/** Read counts are pushed at most this often: a burst of tool calls is one update. */
const READ_COUNT_EMIT_MS = 250;

function toInfo(row: AgentTokenRow): AgentTokenInfo {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at ?? undefined,
  };
}

/**
 * Agent Access in main: the switch, the socket server, the tokens and the
 * share flag. The switch lives in `app_state` under a key the renderer cannot
 * reach, and `appState.subscribe` starts and stops the server live. Every
 * state change the renderer can ask for goes through a main-process dialog
 * here, and the plaintext token lives only in the closure that shows it.
 */
export class AgentAccessService {
  private deps: AgentAccessDeps;
  private gate: AgentGate;
  private server: AgentServer;
  private unsubscribe: (() => void) | null = null;
  private readCount = 0;
  /** Last privilege verdict per Connection, this run only. Display only: sharing always re-checks. */
  private privilegeByConnection = new Map<string, PrivilegeResult>();
  private enabling: Promise<{ enabled: boolean }> | null = null;
  /** One share question per Connection at a time. */
  private sharing = new Map<string, Promise<{ shared: boolean; privilege?: PrivilegeResult }>>();
  private emitTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  /** Serialises start and stop, so a quick off-on never races two listeners. */
  private chain: Promise<void> = Promise.resolve();
  /** An edit that points a Connection elsewhere ended its share (`ConnectionService.update` cleared the flag); a delete ends it too. */
  private onIdentityChanged = (connectionId: string): void => {
    this.gate.revokeConnection(connectionId);
    this.privilegeByConnection.delete(connectionId);
    // Not `emitState`: a delete announces itself before the row goes, and the coalesced push reads it after.
    this.scheduleEmit();
  };

  constructor(deps: AgentAccessDeps) {
    this.deps = deps;
    this.gate = new AgentGate({
      accessOn: () => this.isEnabled(),
      connections: deps.connRepo,
      pool: deps.pool,
      tokens: deps.tokenRepo,
      log: deps.log,
    });
    const runner = new AgentToolRunner({
      gate: this.gate,
      tools: AGENT_TOOLS,
      readLog: deps.readLogRepo,
      tokens: deps.tokenRepo,
      connections: deps.connRepo,
      log: deps.log,
      onRowWritten: () => {
        this.readCount += 1;
        this.scheduleEmit();
      },
    });
    this.server = new AgentServer({
      userData: deps.userData,
      runner,
      tools: AGENT_TOOLS,
      tokens: deps.tokenRepo,
      log: deps.log,
    });
    this.server.setSessionsListener(() => this.emitState());
    deps.pool.on('connection-identity-changed', this.onIdentityChanged);
  }

  isEnabled(): boolean {
    return this.deps.appState.get<boolean>(AGENT_ACCESS_KEY) === true;
  }

  /** Starts the server when the switch is already on, and follows it from then on. */
  init(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.deps.appState.subscribe<boolean>(AGENT_ACCESS_KEY, (value) => {
      if (value !== true) {
        // Right now, not when the queue gets to it: no read may finish after the user said stop.
        this.gate.revokeAll();
        this.enqueue(() => this.server.stop());
      } else {
        this.enqueue(() => this.startServer());
      }
      this.enqueue(async () => this.emitState());
    });
    if (this.isEnabled()) {
      this.enqueue(() => this.startServer());
      this.enqueue(async () => this.emitState());
    } else {
      // Access is off at launch: an endpoint file left by a crashed run must not outlive it, or the bridge would still read a name nothing serves.
      this.enqueue(() => this.server.stop());
    }
  }

  /** Stops following the switch and closes the server. Resolves once it is down. */
  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.stopped = true;
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.emitTimer = null;
    // First, so the quit teardown aborts every in-flight Agent read before anything else closes.
    this.gate.revokeAll();
    this.enqueue(() => this.server.stop());
    await this.chain;
    await this.gate.close();
    this.gate.dispose();
    this.deps.pool.off('connection-identity-changed', this.onIdentityChanged);
  }

  /** Resolves when every queued start or stop has finished. Tests use it to await the live switch. */
  settled(): Promise<void> {
    return this.chain;
  }

  get socketPath(): string | null {
    return this.server.socketPath;
  }

  get sessionCount(): number {
    return this.server.sessionCount;
  }

  /** Tool calls logged since the app started, refusals included. */
  get sessionReadCount(): number {
    return this.readCount;
  }

  listTokens(): AgentTokenInfo[] {
    return this.deps.tokenRepo.list().map(toInfo);
  }

  /** The plaintext token is returned once, to the caller that shows it; only its hash is stored. */
  addToken(name: string): { info: AgentTokenInfo; token: string } {
    const token = generateToken();
    const row: AgentTokenRow = {
      id: randomUUID(),
      name,
      token_hash: hashToken(token),
      created_at: new Date().toISOString(),
      last_used_at: null,
    };
    this.deps.tokenRepo.insert(row);
    return { info: toInfo(row), token };
  }

  /** A new token replaces the hash: the old one stops working at once, live sessions at their next call. */
  regenerateToken(id: string): { info: AgentTokenInfo; token: string } {
    const token = generateToken();
    if (!this.deps.tokenRepo.replaceHash(id, hashToken(token))) throw new NotFoundError(`agent token ${id} not found`);
    this.gate.revokeToken(id);
    this.server.closeSessionsForToken(id);
    const row = this.deps.tokenRepo.findById(id);
    if (!row) throw new NotFoundError(`agent token ${id} not found`);
    return { info: toInfo(row), token };
  }

  revokeToken(id: string): void {
    if (!this.deps.tokenRepo.deleteById(id)) throw new NotFoundError(`agent token ${id} not found`);
    this.gate.revokeToken(id);
    this.server.closeSessionsForToken(id);
  }

  /** Writes the share flag. The caller owns the dialog that must precede turning it on. Turning it off stops what is running on the Connection and closes its agent client. */
  setShared(connectionId: string, shared: boolean): void {
    if (!this.deps.connRepo.setShared(connectionId, shared)) {
      throw new NotFoundError(`connection ${connectionId} not found`);
    }
    if (!shared) this.gate.revokeConnection(connectionId);
  }

  /** What the renderer is shown. No token, no hash: only names, times and counts. */
  getState(): AgentAccessState {
    const shared = new Set(this.deps.connRepo.listShared().map((c) => c.id));
    const privilege: Record<string, PrivilegeResult> = {};
    for (const [id, result] of this.privilegeByConnection) {
      if (shared.has(id)) privilege[id] = result;
    }
    return {
      enabled: this.isEnabled(),
      socketPath: this.socketPath ?? '',
      sessionReadCount: this.readCount,
      sessionCount: this.sessionCount,
      tokens: this.listTokens(),
      bridgeInstalled: this.deps.bridge.isInstalled(),
      bridgePath: this.deps.bridge.installedPath,
      platformCaveat: this.deps.platform === 'win32' ? 'windows-pipe' : null,
      privilege,
    };
  }

  /**
   * Turns Agent Access on after main's own dialog: the renderer's switch is
   * only a request. Cancelling leaves it off. Resolves once the server has
   * started, so the answer and the state agree.
   */
  requestEnable(): Promise<{ enabled: boolean }> {
    if (this.isEnabled()) return Promise.resolve({ enabled: true });
    // Two clicks while the dialog is up are one question, not two.
    this.enabling ??= this.askToEnable().finally(() => {
      this.enabling = null;
    });
    return this.enabling;
  }

  private async askToEnable(): Promise<{ enabled: boolean }> {
    const answer = await this.deps.dialogs.showMessageBox(enableBox(this.deps.platform));
    if (answer.response !== 1) return { enabled: false };
    this.deps.appState.set(AGENT_ACCESS_KEY, true);
    await this.chain;
    return { enabled: this.isEnabled() };
  }

  /** Needs no confirmation. Resolves once the listener and every session are down. */
  async disable(): Promise<{ enabled: false }> {
    this.deps.appState.set(AGENT_ACCESS_KEY, false);
    await this.chain;
    return { enabled: false };
  }

  /**
   * Shares or unshares a Connection (X27 §3.2, §3.3). Unsharing is immediate.
   * Sharing refuses an SSH-tunnelled Connection, asks the user to open a
   * closed one, then runs the privilege check on the user's own client and
   * shows the verdict in a dialog. The flag is written only on "Share".
   */
  requestSetShared(connectionId: string, shared: boolean): Promise<{ shared: boolean; privilege?: PrivilegeResult }> {
    if (!shared) return this.applySetShared(connectionId, false);
    // Two clicks while the dialog is up are one question, not two.
    let pending = this.sharing.get(connectionId);
    if (!pending) {
      pending = this.applySetShared(connectionId, true).finally(() => {
        this.sharing.delete(connectionId);
      });
      this.sharing.set(connectionId, pending);
    }
    return pending;
  }

  private async applySetShared(connectionId: string, shared: boolean): Promise<{ shared: boolean; privilege?: PrivilegeResult }> {
    const row = this.deps.connRepo.findById(connectionId);
    if (!row) throw new NotFoundError(`connection ${connectionId} not found`);
    if (!shared) {
      this.setShared(connectionId, false);
      this.privilegeByConnection.delete(connectionId);
      this.emitState();
      return { shared: false };
    }
    if (row.ssh_enabled === 1) {
      throw new ValidationError('A Connection that uses an SSH tunnel cannot be shared with Agents yet.');
    }
    const fingerprint = connectionIdentityFingerprint(row);
    const result = await this.checkPrivileges(connectionId, row.name);
    if (result === 'not-open') return { shared: false };
    const answer = await this.deps.dialogs.showMessageBox(shareBox(row.name, result, this.deps.platform));
    if (answer.response !== 1) {
      return { shared: this.deps.connRepo.findById(connectionId)?.share_with_agents === 1, privilege: result };
    }
    // The verdict on the box described the Connection as it was when the question opened. Edited, deleted or moved to a tunnel meanwhile, it no longer describes what "Share" would grant.
    const current = this.deps.connRepo.findById(connectionId);
    if (!current) throw new NotFoundError(`connection ${connectionId} not found`);
    if (current.ssh_enabled === 1 || connectionIdentityFingerprint(current) !== fingerprint) {
      throw new ConflictError('The Connection changed while the question was open, so it was not shared. Share it again to review it.');
    }
    this.setShared(connectionId, true);
    this.privilegeByConnection.set(connectionId, result);
    this.emitState();
    return { shared: true, privilege: result };
  }

  /**
   * `connectionStatus` with `showPrivileges` on the user's own client. The
   * status is read and the client requested in the same tick, with nothing in
   * between that could let a Connection close and be woken by `readClient`.
   */
  private async checkPrivileges(connectionId: string, name: string): Promise<PrivilegeResult | 'not-open'> {
    const { pool } = this.deps;
    if (pool.status(connectionId).status !== 'connected') {
      await this.deps.dialogs.showMessageBox(notOpenBox(name));
      return 'not-open';
    }
    const clientPromise = pool.readClient(connectionId);
    try {
      const client = await clientPromise;
      const reply: unknown = await client
        .db('admin')
        .command({ connectionStatus: 1, showPrivileges: true, maxTimeMS: 5000 });
      return privilegeVerdict(reply);
    } catch (err) {
      return failedVerdict(classifyMongoOpError(err).code);
    }
  }

  /** The row exists before the dialog opens; the dialog only ends with Done. The token is shown here and nowhere else. */
  async addTokenWithDialog(name: string): Promise<AgentTokenInfo> {
    const { info, token } = this.addToken(name);
    this.emitState();
    await this.showToken(info.name, token, 'added');
    return info;
  }

  async regenerateTokenWithDialog(id: string): Promise<AgentTokenInfo> {
    const { info, token } = this.regenerateToken(id);
    this.emitState();
    await this.showToken(info.name, token, 'regenerated');
    return info;
  }

  /** Revokes a token and ends the sessions that used it. */
  revokeTokenAndNotify(id: string): { ok: true } {
    this.revokeToken(id);
    this.emitState();
    return { ok: true };
  }

  /** Refused while Agent Access is on: a client may be using the copy, and the launch copy would only put it back. */
  removeBridge(): { removed: boolean } {
    if (this.isEnabled()) throw new ConflictError('Turn Agent Access off before removing the bridge.');
    const removed = this.deps.bridge.remove();
    this.emitState();
    return { removed };
  }

  /**
   * One message box in a loop. A copy button puts that client's configuration
   * on the clipboard and shows the same box again with a note; only Done (or
   * Escape) ends it. The box closes on any button, so this is how "Copy"
   * works without a second window.
   */
  private async showToken(name: string, token: string, kind: 'added' | 'regenerated'): Promise<void> {
    let note: string | null = null;
    for (;;) {
      const { response } = await this.deps.dialogs.showMessageBox(tokenBox(name, token, kind, note));
      const choice = SNIPPET_CLIENTS[response - 1];
      if (response === TOKEN_DONE || !choice) return;
      try {
        await this.deps.dialogs.writeClipboard(configSnippet(choice.client, this.deps.bridge.installedPath, token));
        note = `Configuration copied for ${choice.label}.`;
      } catch (err) {
        // Say so in the box, which is still open to the token: the user can copy it by hand or regenerate.
        this.deps.log.warn('agent', 'could not copy the Agent configuration', { errName: err instanceof Error ? err.name : typeof err });
        note = `Could not copy the configuration for ${choice.label}.`;
      }
    }
  }

  /** Copies the bundled bridge to the per-user path. Never throws; the outcome is logged. */
  private installBridge(): void {
    this.deps.bridge.ensureCopy();
  }

  private emitState(): void {
    if (this.stopped) return;
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    this.deps.emit(this.getState());
  }

  /** Coalesces a burst of read-count changes into one push. */
  private scheduleEmit(): void {
    if (this.stopped || this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emitState();
    }, READ_COUNT_EMIT_MS);
    this.emitTimer.unref();
  }

  private enqueue(task: () => Promise<unknown>): void {
    this.chain = this.chain
      .then(task)
      .then(
        () => undefined,
        (err: unknown) => {
          this.deps.log.error('agent', 'agent server task failed', { errName: err instanceof Error ? err.name : typeof err });
        },
      );
  }

  private async startServer(): Promise<void> {
    if (!(await this.server.start())) {
      this.deps.log.warn('agent', 'Agent Access is on but the server is not listening');
    }
    this.installBridge();
  }
}
