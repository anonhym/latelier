import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { vi } from 'vitest';
import type { MongoClient } from 'mongodb';
import type { AgentMessageBox } from '../../electron/agent/dialogCopy';
import type { BridgeHandle } from '../../electron/agent/bridgeInstall';
import type { Logger } from '../../electron/log';
import { AppStateRepo } from '../../electron/db/repositories/AppStateRepo';
import { AgentReadLogRepo } from '../../electron/db/repositories/AgentReadLogRepo';
import { AgentTokenRepo } from '../../electron/db/repositories/AgentTokenRepo';
import { ConnectionRepo, inputToRow } from '../../electron/db/repositories/ConnectionRepo';
import { AppStateService } from '../../electron/services/AppStateService';
import { AgentAccessService, type AgentAccessPool } from '../../electron/services/AgentAccessService';
import { AGENT_ACCESS_KEY } from '../../electron/ipc/prefKeys';
import type { AgentAccessState, ConnectionInput } from '@shared/types';
import { createTempCipher, createTempDb, type TempDb } from './db';

export type PoolStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

/** What a harness hands a custom pool factory: the real repository and database the service uses. */
export interface PoolFactoryContext {
  tmp: TempDb;
  connRepo: ConnectionRepo;
}

export interface AgentHarnessOptions {
  /** Replaces the fake pool, e.g. with a real `MongoPool` over a memory server. */
  makePool?: (ctx: PoolFactoryContext) => AgentAccessPool;
  platform?: NodeJS.Platform;
}

/** A pool that only reports the statuses a test sets, and emits `status` like the real one. */
class FakePool extends EventEmitter implements AgentAccessPool {
  statuses = new Map<string, PoolStatus>();
  calls: string[] = [];

  status(id: string): { status: PoolStatus } {
    this.calls.push(id);
    return { status: this.statuses.get(id) ?? 'disconnected' };
  }

  openAgentClient(): Promise<MongoClient> {
    return Promise.reject(new Error('the fake pool opens no client'));
  }

  readClient(): Promise<MongoClient> {
    return Promise.reject(new Error('the fake pool opens no client'));
  }
}

/** A bridge installer that touches no disk. */
export class FakeBridge implements BridgeHandle {
  installedPath = '/fake/bin/latelier-agent-bridge';
  installed = false;
  /** How many times the service asked for a copy. */
  copies = 0;
  isInstalled(): boolean {
    return this.installed;
  }
  ensureCopy(): 'copied' {
    this.copies += 1;
    this.installed = true;
    return 'copied';
  }
  remove(): boolean {
    const was = this.installed;
    this.installed = false;
    return was;
  }
}

export interface AgentHarness {
  tmp: TempDb;
  appState: AppStateService;
  tokenRepo: AgentTokenRepo;
  readLogRepo: AgentReadLogRepo;
  connRepo: ConnectionRepo;
  svc: AgentAccessService;
  pool: AgentAccessPool;
  log: Logger;
  /** Every state the service pushed to the renderer. */
  states: AgentAccessState[];
  /** Every message box the service showed, and the buttons the test script answers them with (default: button 0). */
  boxes: AgentMessageBox[];
  clipboard: string[];
  /** Makes every clipboard write fail. */
  clipboardFails: boolean;
  answers: number[];
  bridge: FakeBridge;
  /** Runs when a message box opens, before it is answered. */
  onBox: ((box: AgentMessageBox) => void) | null;
  /** Per-Connection status the fake pool reports; absent means disconnected. */
  statuses: Map<string, PoolStatus>;
  /** Every `status()` call, to prove an Agent call never asks for more than a status. */
  poolCalls: string[];
  addConnection: (
    id: string,
    name: string,
    opts?: { shared?: boolean; status?: PoolStatus; hostPort?: { host: string; port: number } },
  ) => void;
  enable: () => Promise<string>;
  disable: () => Promise<void>;
  cleanup: () => Promise<void>;
}

function connectionInput(name: string, hostPort?: { host: string; port: number }): ConnectionInput {
  return {
    name,
    color: '#1A6835',
    connectionType: 'standard',
    readOnly: false,
    host: hostPort?.host ?? 'secret-host.internal',
    port: hostPort?.port ?? 27017,
    authMech: 'none',
    tls: { enabled: false, verify: true },
    advanced: {
      connectTimeoutMs: 10_000,
      socketTimeoutMs: 30_000,
      serverSelectionTimeoutMs: 30_000,
      readPreference: 'primary',
      maxPoolSize: 100,
      directConnection: false,
    },
  };
}

/** Real SQLite and a real socket server, with a fake pool that only reports statuses. */
export function createAgentHarness(options: AgentHarnessOptions = {}): AgentHarness {
  const tmp = createTempDb();
  const appState = new AppStateService(new AppStateRepo(tmp.db));
  const cipher = createTempCipher();
  const tokenRepo = new AgentTokenRepo(tmp.db);
  const readLogRepo = new AgentReadLogRepo(tmp.db, cipher);
  const connRepo = new ConnectionRepo(tmp.db);
  const fake = new FakePool();
  const statuses = fake.statuses;
  const poolCalls = fake.calls;
  const pool: AgentAccessPool = options.makePool?.({ tmp, connRepo }) ?? fake;
  const states: AgentAccessState[] = [];
  const boxes: AgentMessageBox[] = [];
  const clipboard: string[] = [];
  const answers: number[] = [];
  const bridge = new FakeBridge();
  const log: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const svc = new AgentAccessService({
    appState,
    tokenRepo,
    readLogRepo,
    connRepo,
    pool,
    userData: tmp.dir,
    log,
    bridge,
    platform: options.platform ?? 'darwin',
    dialogs: {
      // Button 0 (Cancel / Done) unless the test scripted another: a short script can never hang a spec.
      showMessageBox: async (box) => {
        boxes.push(box);
        harness.onBox?.(box);
        return { response: answers.shift() ?? 0 };
      },
      writeClipboard: async (text) => {
        if (harness.clipboardFails) throw new Error('clipboard unavailable');
        clipboard.push(text);
      },
    },
    emit: (state) => void states.push(state),
  });
  svc.init();

  const harness: AgentHarness = {
    tmp,
    appState,
    tokenRepo,
    readLogRepo,
    connRepo,
    svc,
    pool,
    log,
    states,
    boxes,
    clipboard,
    clipboardFails: false,
    answers,
    bridge,
    onBox: null,
    statuses,
    poolCalls,
    addConnection(id, name, opts = {}) {
      connRepo.insert(inputToRow(id, connectionInput(name, opts.hostPort), new Date().toISOString()));
      if (opts.shared) connRepo.setShared(id, true);
      if (opts.status) statuses.set(id, opts.status);
    },
    async enable() {
      appState.set(AGENT_ACCESS_KEY, true);
      await svc.settled();
      const path = svc.socketPath;
      if (!path) throw new Error('the agent server did not start');
      return path;
    },
    async disable() {
      appState.set(AGENT_ACCESS_KEY, false);
      await svc.settled();
    },
    async cleanup() {
      await svc.stop();
      tmp.cleanup();
      fs.rmSync(tmp.dir, { recursive: true, force: true });
    },
  };
  return harness;
}
