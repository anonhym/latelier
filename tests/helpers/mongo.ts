import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Connection } from '@shared/types';
import type { ConnectionReader } from '../../electron/mongo/MongoPool';

let singleton: Promise<MongoMemoryServer> | null = null;

/**
 * Start (or reuse) a single in-process Mongo instance across the whole vitest
 * suite. The returned URI is of the form mongodb://localhost:<port>.
 *
 * Stop is not wired automatically; the OS reaps it at process exit. If you
 * need isolation, call stopSharedServer() in a global teardown.
 */
export async function getSharedServer(): Promise<MongoMemoryServer> {
  if (!singleton) singleton = MongoMemoryServer.create();
  return singleton;
}

export async function stopSharedServer(): Promise<void> {
  if (!singleton) return;
  const s = await singleton;
  await s.stop();
  singleton = null;
}

/**
 * Parse a mongodb-memory-server URI into host/port for our Connection shape.
 */
export function uriToHostPort(uri: string): { host: string; port: number } {
  const m = uri.match(/^mongodb:\/\/([^:/]+):(\d+)/);
  if (!m) throw new Error(`cannot parse uri ${uri}`);
  return { host: m[1]!, port: Number(m[2]!) };
}

export function makeConnection(
  id: string,
  hp: { host: string; port: number },
  overrides: Partial<Connection> = {},
): Connection {
  return {
    id,
    name: `conn-${id}`,
    color: '#1A6835',
    connectionType: 'standard',
    host: hp.host,
    port: hp.port,
    authMech: 'none',
    tls: { enabled: false, verify: true },
    advanced: {
      connectTimeoutMs: 5000,
      socketTimeoutMs: 5000,
      serverSelectionTimeoutMs: 5000,
      readPreference: 'primary',
      maxPoolSize: 5,
      directConnection: true,
    },
    hasPasswordStored: false,
    hasSshPasswordStored: false,
    hasSshPassphraseStored: false,
    readOnly: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function makeReader(conns: Connection[]): ConnectionReader {
  return {
    findById: (id: string) => conns.find((c) => c.id === id) ?? null,
  };
}

export interface CountingReader extends ConnectionReader {
  calls: number;
  reset(): void;
}

export function makeCountingReader(conns: Connection[]): CountingReader {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    reset() {
      state.calls = 0;
    },
    findById(id: string) {
      state.calls++;
      return conns.find((c) => c.id === id) ?? null;
    },
  };
}
