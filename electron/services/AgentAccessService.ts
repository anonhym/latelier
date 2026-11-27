import { randomUUID } from 'node:crypto';
import type { MongoClient } from 'mongodb';
import type {
  AgentAccessState,
  AgentCallRow,
  AgentCopyResult,
  AgentCallSummary,
  AgentCallsQuery,
  AgentSessionEndReason,
  AgentSessionInfo,
  AgentSessionRow,
  AgentSessionsQuery,
  AgentTokenInfo,
  ConnectionRuntime,
  PrivilegeResult,
  SnippetClient,
} from '@shared/types';
import { AGENT_ACCESS_KEY } from '../ipc/prefKeys.ts';
import type { Logger } from '../log.ts';
import { ConflictError, NotFoundError, SystemError, ValidationError } from '../errors.ts';
import { classifyMongoOpError } from '../mongo/errors.ts';
import {
  connectClientBox,
  COPY_CONFIRMED,
  copySetupBox,
  enableAndShareBox,
  enableBox,
  notOpenBox,
  shareBox,
  type AgentMessageBox,
} from '../agent/dialogCopy.ts';
import type { BridgeHandle } from '../agent/bridgeInstall.ts';
import { failedVerdict, privilegeVerdict } from '../agent/privilegeVerdict.ts';
import { claudeCodeCommandTemplate, configSnippet, snippetLabel, snippetTemplates } from '../agent/snippets.ts';
import { ConnectionRequests } from '../agent/connectionRequests.ts';
import { AgentGate, type AgentPool } from '../agent/AgentGate.ts';
import { AgentServer, type AgentSessionEvent } from '../agent/AgentServer.ts';
import { displayFolder } from '../agent/folderDisplay.ts';
import { AgentToolRunner } from '../agent/AgentToolRunner.ts';
import { AGENT_TOOLS, type AgentReferenceRules } from '../agent/tools.ts';
import { generateToken, hashToken } from '../agent/token.ts';
import type { AgentTokenRepo, AgentTokenRow } from '../db/repositories/AgentTokenRepo.ts';
import type { AgentReadLogRepo } from '../db/repositories/AgentReadLogRepo.ts';
import type { AgentSessionRepo } from '../db/repositories/AgentSessionRepo.ts';
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
  /** Main only: the renderer is never allowed to read the clipboard. */
  readClipboard(): Promise<string>;
  clearClipboard(): void;
}

export interface AgentAccessDeps {
  appState: Pick<AppStateService, 'get' | 'set' | 'subscribe'>;
  tokenRepo: AgentTokenRepo;
  readLogRepo: AgentReadLogRepo;
  sessionRepo: AgentSessionRepo;
  connRepo: ConnectionRepo;
  pool: AgentAccessPool;
  userData: string;
  log: Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>;
  dialogs: AgentDialogs;
  bridge: BridgeHandle;
  platform: NodeJS.Platform;
  /** The user's home directory: a session's folder is shown with it as `~`. */
  homedir: string;
  /** Pushes the state to the renderer. The state holds no token. */
  emit: (state: AgentAccessState) => void;
  /** Pushes one new Agent Read Log row, without its request, to the renderer. */
  emitCall: (row: AgentCallSummary) => void;
  /** The Reference Rules the relation tools read. */
  refs: AgentReferenceRules;
  /** The clock Connection requests and copies are timed by. */
  now?: () => number;
}

/** A live session's counts, this run only; the stored rows answer for ended ones. */
interface SessionStats {
  callCount: number;
  refusedCount: number;
  lastCallAt: string | null;
}

/** Read counts are pushed at most this often: a burst of tool calls is one update. */
const READ_COUNT_EMIT_MS = 250;

/** A copied setup holds a token: main clears it this long after the copy if it is still there (X27 §16.8). */
export const CLIPBOARD_CLEAR_MS = 5 * 60 * 1000;

/** How often quiet Connection requests are looked for; each one lives 30 minutes past its last refusal. */
const REQUEST_SWEEP_MS = 60 * 1000;

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
  private sessionStats = new Map<string, SessionStats>();
  private sessionEndedHooks = new Set<(sessionId: string, reason: AgentSessionEndReason) => void>();
  /** Last privilege verdict per Connection, this run only. Display only: sharing always re-checks. */
  private privilegeByConnection = new Map<string, PrivilegeResult>();
  private enabling: Promise<{ enabled: boolean }> | null = null;
  /** One share question per Connection at a time. */
  private sharing = new Map<string, Promise<{ shared: boolean; privilege?: PrivilegeResult }>>();
  private emitTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private requests: ConnectionRequests;
  private requestSweep: NodeJS.Timeout | null = null;
  /** The text main last put on the clipboard, until it is cleared or replaced. */
  private copied: { text: string; timer: NodeJS.Timeout } | null = null;
  /** Serialises start and stop, so a quick off-on never races two listeners. */
  private chain: Promise<void> = Promise.resolve();
  /** An edit that points a Connection elsewhere ended its share (`ConnectionService.update` cleared the flag); a delete ends it too. */
  private onIdentityChanged = (connectionId: string): void => {
    this.gate.revokeConnection(connectionId);
    this.privilegeByConnection.delete(connectionId);
    this.requests.endConnection(connectionId);
    // Not `emitState`: a delete announces itself before the row goes, and the coalesced push reads it after.
    this.scheduleEmit();
  };

  /** A Connection the user opened ends every request for it: there is nothing left to ask. */
  private onPoolStatus = (runtime: { id: string; status: ConnectionRuntime['status'] }): void => {
    if (runtime.status === 'connected' && this.requests.endConnection(runtime.id)) this.emitState();
  };

  constructor(deps: AgentAccessDeps) {
    this.deps = deps;
    this.requests = new ConnectionRequests(() => this.now());
    // A session still open in the table was left by a run that crashed or was killed: nothing serves it now.
    const orphans = deps.sessionRepo.closeOrphans(new Date().toISOString());
    if (orphans > 0) deps.log.info('agent', 'closed Agent sessions left open by the last run', { count: orphans });
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
      refs: deps.refs,
      onRowWritten: (row) => this.onRowWritten(row),
    });
    this.server = new AgentServer({
      userData: deps.userData,
      runner,
      tools: AGENT_TOOLS,
      tokens: deps.tokenRepo,
      log: deps.log,
      sessions: deps.sessionRepo,
      accessOn: () => this.isEnabled(),
    });
    this.server.setSessionsListener((event) => this.onSessionEvent(event));
    deps.pool.on('connection-identity-changed', this.onIdentityChanged);
    deps.pool.on('status', this.onPoolStatus);
  }

  isEnabled(): boolean {
    return this.deps.appState.get<boolean>(AGENT_ACCESS_KEY) === true;
  }

  /** Starts the server when the switch is already on, and follows it from then on. */
  init(): void {
    if (this.unsubscribe) return;
    this.requestSweep ??= setInterval(() => {
      if (this.requests.expire()) this.emitState();
    }, REQUEST_SWEEP_MS);
    this.requestSweep.unref();
    this.unsubscribe = this.deps.appState.subscribe<boolean>(AGENT_ACCESS_KEY, (value) => {
      if (value !== true) {
        // Right now, not when the queue gets to it: no read may finish after the user said stop.
        this.gate.revokeAll();
        this.enqueue(() => this.server.stop('access-off'));
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
      this.enqueue(() => this.server.stop('access-off'));
    }
  }

  /** Stops following the switch and closes the server. Resolves once it is down. */
  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.stopped = true;
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.emitTimer = null;
    if (this.requestSweep) clearInterval(this.requestSweep);
    this.requestSweep = null;
    // First, so the quit teardown aborts every in-flight Agent read before anything else closes.
    this.gate.revokeAll();
    this.enqueue(() => this.server.stop('app-quit'));
    await this.chain;
    await this.gate.close();
    this.gate.dispose();
    this.deps.pool.off('connection-identity-changed', this.onIdentityChanged);
    this.deps.pool.off('status', this.onPoolStatus);
    // Last, at quit, a setup main copied is not left on the clipboard (X27 §16.8). Reading it awaits, and no Agent read may run on through that; a failure is logged, never thrown.
    await this.clearCopiedSetup();
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

  /**
   * Runs whenever a counted session ends, with why. Returns the unsubscribe.
   * For main-process consumers whose state lives and dies with a session.
   */
  onSessionEnded(fn: (sessionId: string, reason: AgentSessionEndReason) => void): () => void {
    this.sessionEndedHooks.add(fn);
    return () => this.sessionEndedHooks.delete(fn);
  }

  /** The live, counted sessions with their counts this run; the folder in display form only. */
  liveSessions(): AgentSessionInfo[] {
    return this.server.liveSessions().map((s) => {
      const stats = this.sessionStats.get(s.id);
      return {
        ...s,
        folder: this.displayFolder(s.folder),
        callCount: stats?.callCount ?? 0,
        refusedCount: stats?.refusedCount ?? 0,
        lastCallAt: stats?.lastCallAt ?? null,
      };
    });
  }

  /** Agent Read Log rows, newest first. The request is opened for this answer only. */
  listCalls(query: AgentCallsQuery): AgentCallRow[] {
    return this.deps.readLogRepo.listCalls(query);
  }

  /**
   * Stored sessions, newest first, with the folder in display form. The raw path never leaves main.
   * An open row the server no longer holds is left out: its end could not be written, and showing
   * it as live would disagree with `getState`. The next launch closes it as `unknown`.
   */
  listSessions(query: AgentSessionsQuery): AgentSessionRow[] {
    const live = new Set(this.server.liveSessions().map((s) => s.id));
    return this.deps.sessionRepo
      .list(query)
      .filter((row) => row.endedAt !== null || live.has(row.id))
      .map((row) => ({ ...row, folder: this.displayFolder(row.folder) }));
  }

  /** Ends one live session at the user's request. Throws NotFoundError when it is not live. */
  endSession(sessionId: string): { ok: true } {
    this.server.endSession(sessionId);
    return { ok: true };
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
    if (!shared) {
      this.gate.revokeConnection(connectionId);
      this.requests.endConnection(connectionId);
    }
  }

  /** What the renderer is shown. No token, no hash: only names, times and counts. */
  getState(): AgentAccessState {
    // The sweep runs once a minute; a state read between two sweeps is never stale either.
    this.requests.expire();
    const sessions = this.liveSessions();
    const shared = new Set(this.deps.connRepo.listShared().map((c) => c.id));
    const privilege: Record<string, PrivilegeResult> = {};
    for (const [id, result] of this.privilegeByConnection) {
      if (shared.has(id)) privilege[id] = result;
    }
    return {
      enabled: this.isEnabled(),
      socketPath: this.socketPath ?? '',
      sessionReadCount: this.readCount,
      sessionCount: sessions.length,
      sessions,
      tokens: this.listTokens(),
      bridgeInstalled: this.deps.bridge.isInstalled(),
      bridgePath: this.deps.bridge.installedPath,
      claudeCodeCommand: claudeCodeCommandTemplate(this.deps.bridge.installedPath, this.deps.platform),
      snippetTemplates: snippetTemplates(this.deps.bridge.installedPath, this.deps.platform),
      connectionRequests: this.requests.list(),
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
    await this.turnOn();
    return { enabled: this.isEnabled() };
  }

  /** Only ever called after a confirmed main-process dialog. Resolves once the server has started. */
  private async turnOn(): Promise<void> {
    this.deps.appState.set(AGENT_ACCESS_KEY, true);
    await this.chain;
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
    // Off: one dialog asks to turn it on and to share (§3.2), so the share is never silent.
    const alsoEnable = !this.isEnabled();
    const box = alsoEnable
      ? enableAndShareBox(row.name, result, this.deps.platform)
      : shareBox(row.name, result, this.deps.platform);
    const answer = await this.deps.dialogs.showMessageBox(box);
    if (answer.response !== 1) {
      return { shared: this.deps.connRepo.findById(connectionId)?.share_with_agents === 1, privilege: result };
    }
    // The verdict on the box described the Connection as it was when the question opened. Edited, deleted or moved to a tunnel meanwhile, it no longer describes what "Share" would grant.
    this.assertUnchanged(connectionId, fingerprint);
    if (alsoEnable) {
      await this.turnOn();
      // Starting the server awaits, and an edit can land in that gap: check again right before the write. A refused share never leaves Agent Access on behind it.
      try {
        this.assertUnchanged(connectionId, fingerprint);
      } catch (err) {
        await this.disable();
        throw err;
      }
    }
    this.setShared(connectionId, true);
    this.privilegeByConnection.set(connectionId, result);
    this.emitState();
    return { shared: true, privilege: result };
  }

  /** Throws unless the Connection still exists, has no tunnel, and has the identity the share dialog described. */
  private assertUnchanged(connectionId: string, fingerprint: string): void {
    const current = this.deps.connRepo.findById(connectionId);
    if (!current) throw new NotFoundError(`connection ${connectionId} not found`);
    if (current.ssh_enabled === 1 || connectionIdentityFingerprint(current) !== fingerprint) {
      throw new ConflictError('The Connection changed while the question was open, so it was not shared. Share it again to review it.');
    }
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

  /**
   * X27 §16.8: after main's confirm, creates an Agent Token and puts the
   * client's setup, holding it, on the clipboard. Resolves only once the write
   * has returned, so "copied" is true when the renderer says it. Cancel
   * creates nothing.
   */
  async connectClient(name: string, client: SnippetClient): Promise<AgentCopyResult> {
    const label = snippetLabel(client);
    const answer = await this.deps.dialogs.showMessageBox(connectClientBox(name, label));
    if (answer.response !== COPY_CONFIRMED) return { cancelled: true };
    const { info, token } = this.addToken(name);
    const text = configSnippet(client, this.deps.bridge.installedPath, token, this.deps.platform);
    try {
      await this.deps.dialogs.writeClipboard(text);
    } catch (err) {
      // A token nobody holds would sit in the list unusable: it goes, and the user tries again.
      this.deps.tokenRepo.deleteById(info.id);
      this.deps.log.warn('agent', 'could not copy the Agent setup', { errName: err instanceof Error ? err.name : typeof err });
      throw new SystemError('INTERNAL', 'The setup could not be copied, so the Agent was not added. Try again.');
    }
    this.rememberCopiedSetup(text);
    this.emitState();
    return { tokenId: info.id, copiedAt: new Date(this.now()).toISOString() };
  }

  /**
   * Copies an existing Agent's setup. The token is stored only as a hash, so
   * copying regenerates it, which ends the Agent's live sessions; main's
   * confirm says so first. Cancel changes nothing.
   */
  async copySetup(id: string, client: SnippetClient): Promise<AgentCopyResult> {
    const label = snippetLabel(client);
    const row = this.deps.tokenRepo.findById(id);
    if (!row) throw new NotFoundError(`agent token ${id} not found`);
    const live = this.server.liveSessions().filter((s) => s.tokenId === id).length;
    const answer = await this.deps.dialogs.showMessageBox(copySetupBox(row.name, label, live));
    if (answer.response !== COPY_CONFIRMED) return { cancelled: true };
    const { info, token } = this.regenerateToken(id);
    this.emitState();
    const text = configSnippet(client, this.deps.bridge.installedPath, token, this.deps.platform);
    try {
      await this.deps.dialogs.writeClipboard(text);
    } catch (err) {
      // The old token is already dead and its sessions ended: nothing to roll back to. A new copy regenerates again.
      this.deps.log.warn('agent', 'could not copy the Agent setup', { errName: err instanceof Error ? err.name : typeof err });
      throw new SystemError('INTERNAL', "The token was regenerated, but the setup could not be copied. Copy the setup again.");
    }
    this.rememberCopiedSetup(text);
    return { tokenId: info.id, copiedAt: new Date(this.now()).toISOString() };
  }

  /** Renames an Agent. Live sessions write the new name from their next call; stored rows keep the old one. */
  renameToken(id: string, name: string): AgentTokenInfo {
    if (!this.deps.tokenRepo.rename(id, name)) throw new NotFoundError(`agent token ${id} not found`);
    this.server.renameToken(id, name);
    const row = this.deps.tokenRepo.findById(id);
    if (!row) throw new NotFoundError(`agent token ${id} not found`);
    this.emitState();
    return toInfo(row);
  }

  /**
   * The user dismissed a Connection request: it goes, and that session makes
   * no new one for that Connection. A session that is not live has nothing
   * to dismiss, and remembering a pair for it would never be forgotten.
   */
  dismissRequest(sessionId: string, connectionId: string): { ok: true } {
    if (this.server.liveSessions().some((s) => s.id === sessionId)) {
      this.requests.dismiss(sessionId, connectionId);
      this.emitState();
    }
    return { ok: true };
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

  /** A new copy replaces the one pending: only the latest text main wrote is ever cleared. */
  private rememberCopiedSetup(text: string): void {
    if (this.copied) clearTimeout(this.copied.timer);
    const timer = setTimeout(() => void this.clearCopiedSetup(), CLIPBOARD_CLEAR_MS);
    timer.unref();
    this.copied = { text, timer };
  }

  /** Clears the clipboard only if it still holds exactly what main wrote: anything the user copied since stays. */
  private async clearCopiedSetup(): Promise<void> {
    const copied = this.copied;
    if (!copied) return;
    clearTimeout(copied.timer);
    this.copied = null;
    try {
      if ((await this.deps.dialogs.readClipboard()) === copied.text) this.deps.dialogs.clearClipboard();
    } catch (err) {
      // Quitting must not stop on a clipboard that cannot be read; the failure is logged by class.
      this.deps.log.warn('agent', 'could not clear the copied Agent setup', { errName: err instanceof Error ? err.name : typeof err });
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
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

  private displayFolder(folder: string | null): string | null {
    return folder === null ? null : displayFolder(folder, this.deps.homedir, this.deps.platform);
  }

  /** One Agent Read Log row was written: the counts move (coalesced) and the row goes to the renderer at once. */
  private onRowWritten(row: AgentCallSummary): void {
    // A paused call writes a row for its asking round and one for its retry; it is one read.
    if (row.outcome !== 'INPUT_REQUIRED') {
      this.readCount += 1;
      const stats = row.sessionId === null ? undefined : this.sessionStats.get(row.sessionId);
      if (stats) {
        stats.callCount += 1;
        if (row.outcome !== 'ok') stats.refusedCount += 1;
        stats.lastCallAt = row.ts;
      }
    }
    if (!this.stopped) this.deps.emitCall(row);
    if (this.observeRequest(row) === 'added') this.emitState();
    else this.scheduleEmit();
  }

  /**
   * A refused or paused call on a shared Connection that is not open becomes
   * a Connection request (X27 §16.6). One that opened, or stopped being
   * shared, while the call ran would only sit there for 30 minutes: skipped.
   */
  private observeRequest(row: AgentCallSummary): 'added' | 'updated' | 'ignored' {
    if (row.outcome !== 'NOT_OPEN' && row.outcome !== 'INPUT_REQUIRED') return 'ignored';
    if (row.connectionId === null || row.sessionId === null) return 'ignored';
    if (this.deps.pool.status(row.connectionId).status === 'connected') return 'ignored';
    if (this.deps.connRepo.findById(row.connectionId)?.share_with_agents !== 1) return 'ignored';
    const session = this.server.liveSessions().find((s) => s.id === row.sessionId);
    return this.requests.observe(row, this.displayFolder(session?.folder ?? null));
  }

  /** A session opening or closing is pushed at once, not coalesced. */
  private onSessionEvent(event: AgentSessionEvent): void {
    const id = event.session.identity.sessionId;
    if (event.kind === 'opened') {
      this.sessionStats.set(id, { callCount: 0, refusedCount: 0, lastCallAt: null });
    } else {
      this.sessionStats.delete(id);
      this.requests.endSession(id);
      const reason = event.session.endReason ?? 'unknown';
      for (const hook of this.sessionEndedHooks) hook(id, reason);
    }
    this.emitState();
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
