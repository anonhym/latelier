import fs from 'node:fs';
import { vi } from 'vitest';
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

export interface AgentHarness {
  tmp: TempDb;
  appState: AppStateService;
  tokenRepo: AgentTokenRepo;
  readLogRepo: AgentReadLogRepo;
  connRepo: ConnectionRepo;
  svc: AgentAccessService;
  log: Logger;
  /** Per-Connection status the fake pool reports; absent means disconnected. */
  statuses: Map<string, PoolStatus>;
  /** Every `status()` call, to prove an Agent call never asks for more than a status. */
  poolCalls: string[];
  addConnection: (id: string, name: string, opts?: { shared?: boolean; status?: PoolStatus }) => void;
  enable: () => Promise<string>;
  disable: () => Promise<void>;
  cleanup: () => Promise<void>;
}

function connectionInput(name: string): ConnectionInput {
  return {
    name,
    color: '#1A6835',
    connectionType: 'standard',
    readOnly: false,
    host: 'secret-host.internal',
    port: 27017,
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
export function createAgentHarness(): AgentHarness {
  const tmp = createTempDb();
  const appState = new AppStateService(new AppStateRepo(tmp.db));
  const cipher = createTempCipher();
  const tokenRepo = new AgentTokenRepo(tmp.db);
  const readLogRepo = new AgentReadLogRepo(tmp.db, cipher);
  const connRepo = new ConnectionRepo(tmp.db);
  const statuses = new Map<string, PoolStatus>();
  const poolCalls: string[] = [];
  const log: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const svc = new AgentAccessService({
    appState,
    tokenRepo,
    readLogRepo,
    connRepo,
    pool: {
      status: (id) => {
        poolCalls.push(id);
        return { status: statuses.get(id) ?? 'disconnected' };
      },
    },
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
    log,
    statuses,
    poolCalls,
    addConnection(id, name, opts = {}) {
      connRepo.insert(inputToRow(id, connectionInput(name), new Date().toISOString()));
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
