import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { vi } from 'vitest';
import type { MongoClient } from 'mongodb';
import type { AgentPool } from '../../electron/agent/AgentGate';
import type { Logger } from '../../electron/log';
import { AppStateRepo } from '../../electron/db/repositories/AppStateRepo';
import { AgentReadLogRepo } from '../../electron/db/repositories/AgentReadLogRepo';
import { AgentTokenRepo } from '../../electron/db/repositories/AgentTokenRepo';
import { ConnectionRepo, inputToRow } from '../../electron/db/repositories/ConnectionRepo';
import { AppStateService } from '../../electron/services/AppStateService';
import { AgentAccessService } from '../../electron/services/AgentAccessService';
import { AGENT_ACCESS_KEY } from '../../electron/ipc/prefKeys';
import type { ConnectionInput } from '@shared/types';
import { createTempCipher, createTempDb, type TempDb } from './db';

export type PoolStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

/** What a harness hands a custom pool factory: the real repository and database the service uses. */
export interface PoolFactoryContext {
  tmp: TempDb;
  connRepo: ConnectionRepo;
}

export interface AgentHarnessOptions {
  /** Replaces the fake pool, e.g. with a real `MongoPool` over a memory server. */
  makePool?: (ctx: PoolFactoryContext) => AgentPool;
}

/** A pool that only reports the statuses a test sets, and emits `status` like the real one. */
class FakePool extends EventEmitter implements AgentPool {
  statuses = new Map<string, PoolStatus>();
  calls: string[] = [];

  status(id: string): { status: PoolStatus } {
    this.calls.push(id);
    return { status: this.statuses.get(id) ?? 'disconnected' };
  }

  openAgentClient(): Promise<MongoClient> {
    return Promise.reject(new Error('the fake pool opens no client'));
  }
}

export interface AgentHarness {
  tmp: TempDb;
  appState: AppStateService;
  tokenRepo: AgentTokenRepo;
  readLogRepo: AgentReadLogRepo;
  connRepo: ConnectionRepo;
  svc: AgentAccessService;
  pool: AgentPool;
  log: Logger;
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
  const pool: AgentPool = options.makePool?.({ tmp, connRepo }) ?? fake;
  const log: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const svc = new AgentAccessService({
    appState,
    tokenRepo,
    readLogRepo,
    connRepo,
    pool,
    userData: tmp.dir,
    log,
  });
  svc.init();

  return {
    tmp,
    appState,
    tokenRepo,
    readLogRepo,
    connRepo,
    svc,
    pool,
    log,
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
}
