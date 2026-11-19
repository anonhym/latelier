import { randomUUID } from 'node:crypto';
import type { AgentTokenInfo } from '@shared/types';
import { AGENT_ACCESS_KEY } from '../ipc/prefKeys.ts';
import type { Logger } from '../log.ts';
import { NotFoundError } from '../errors.ts';
import { AgentGate, type AgentPool } from '../agent/AgentGate.ts';
import { AgentServer } from '../agent/AgentServer.ts';
import { AgentToolRunner } from '../agent/AgentToolRunner.ts';
import { AGENT_TOOLS } from '../agent/tools.ts';
import { generateToken, hashToken } from '../agent/token.ts';
import type { AgentTokenRepo, AgentTokenRow } from '../db/repositories/AgentTokenRepo.ts';
import type { AgentReadLogRepo } from '../db/repositories/AgentReadLogRepo.ts';
import type { ConnectionRepo } from '../db/repositories/ConnectionRepo.ts';
import type { AppStateService } from './AppStateService.ts';

export interface AgentAccessDeps {
  appState: Pick<AppStateService, 'get' | 'subscribe'>;
  tokenRepo: AgentTokenRepo;
  readLogRepo: AgentReadLogRepo;
  connRepo: ConnectionRepo;
  pool: AgentPool;
  userData: string;
  log: Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>;
}

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
 * reach, and `appState.subscribe` starts and stops the server live. Dialogs
 * and the renderer-facing channels arrive in a later slice; this class holds
 * the data operations they will call.
 */
export class AgentAccessService {
  private deps: AgentAccessDeps;
  private gate: AgentGate;
  private server: AgentServer;
  private unsubscribe: (() => void) | null = null;
  private readCount = 0;
  /** Serialises start and stop, so a quick off-on never races two listeners. */
  private chain: Promise<void> = Promise.resolve();

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
      },
    });
    this.server = new AgentServer({
      userData: deps.userData,
      runner,
      tools: AGENT_TOOLS,
      tokens: deps.tokenRepo,
      log: deps.log,
    });
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
    });
    if (this.isEnabled()) this.enqueue(() => this.startServer());
  }

  /** Stops following the switch and closes the server. Resolves once it is down. */
  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    // First, so the quit teardown aborts every in-flight Agent read before anything else closes.
    this.gate.revokeAll();
    this.enqueue(() => this.server.stop());
    await this.chain;
    await this.gate.close();
    this.gate.dispose();
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
  }
}
