import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { MongoClient } from 'mongodb';
import { IPC_CHANNELS } from '@shared/ipc';
import type { ShellSessionInfo } from '@shared/types';
import { createRouter } from '../../electron/ipc/router';
import { registerMshellChannels } from '../../electron/ipc/handlers/mshell';
import { ShellService } from '../../electron/services/ShellService';
import type { MongoPool } from '../../electron/mongo/MongoPool';
import { NotFoundError, ReadOnlyConnectionError } from '../../electron/errors';
import { createTestSpawner, type TestSpawner } from '../helpers/runnerSpawner';
import { createIpcShim } from '../helpers/ipcShim';
import { expectSchemaReject } from '../helpers/ipcAssert';
import { testSenderCheck } from '../helpers/ipcSender';

/**
 * Drives the four `mshell:*` request channels through the real router, zod
 * validators and `ShellService`, with a real runner child per session and a
 * stubbed pool. Output text and `dbName` defaulting are covered by
 * shell-service.spec.ts and are not repeated here.
 */

/** The pool is an emitter: the service listens for status and read-only flips. */
function poolStub(stub: object): MongoPool {
  return Object.assign(
    new EventEmitter(),
    { resolveDbName: (_id: string, dbName?: string) => dbName?.trim() || 'test' },
    stub,
  ) as unknown as MongoPool;
}

/** Fake MongoClient: the router specs never run a query, so no surface is needed. */
function fakeClient(): MongoClient {
  return { db: () => ({}) } as unknown as MongoClient;
}

function fakePool(client: MongoClient): MongoPool {
  return poolStub({
    readClient: async () => client,
    isReadOnly: () => false,
    assertWritable: () => {},
  });
}

let spawner: TestSpawner;
let shim: ReturnType<typeof createIpcShim>;
let svc: ShellService;

/** Registers the channels over a fresh shim, since a shim refuses a second handler per channel. */
function setup(pool: MongoPool): void {
  shim = createIpcShim();
  svc = new ShellService({ spawner, pool, emit: () => {} });
  registerMshellChannels(createRouter(shim.ipcMain, testSenderCheck), svc);
}

beforeEach(() => {
  spawner = createTestSpawner();
  setup(fakePool(fakeClient()));
});

afterEach(() => {
  spawner.killAll();
});

describe('mshell:list via router', () => {
  it.each([
    ['no payload', undefined],
    ['a null payload', null],
  ])('answers an empty list for %s', async (_what, payload) => {
    const env = await shim.invoke<ShellSessionInfo[]>(IPC_CHANNELS.mshellList, payload);
    expect(env).toEqual({ ok: true, data: [] });
  });
});

describe('mshell:start via router', () => {
  it.each([
    ['an empty payload', {}, 'connectionId'],
    ['an empty connectionId', { connectionId: '' }, 'connectionId'],
    ['a non-string dbName', { connectionId: 'c1', dbName: 5 }, 'dbName'],
  ])('rejects %s with VALIDATION', async (_what, payload, path) => {
    expectSchemaReject(await shim.invoke(IPC_CHANNELS.mshellStart, payload), path);
    expect(spawner.spawns).toHaveLength(0);
  });

  it('answers READ_ONLY for a read-only connection, before spawning anything', async () => {
    setup(
      poolStub({
        assertWritable: () => {
          throw new ReadOnlyConnectionError('Connection "c1" is read-only.');
        },
      }),
    );
    const env = await shim.invoke(IPC_CHANNELS.mshellStart, { connectionId: 'c1' });
    expect(env.ok).toBe(false);
    if (env.ok) return;
    expect(env.error.code).toBe('READ_ONLY');
    expect(spawner.spawns).toHaveLength(0);
  });

  it('answers NOT_FOUND when the pool cannot find the connection, before spawning anything', async () => {
    setup(
      poolStub({
        assertWritable: () => {},
        readClient: async () => {
          throw new NotFoundError('connection c1 not found');
        },
      }),
    );
    const env = await shim.invoke(IPC_CHANNELS.mshellStart, { connectionId: 'c1' });
    expect(env.ok).toBe(false);
    if (env.ok) return;
    expect(env.error.code).toBe('NOT_FOUND');
    expect(spawner.spawns).toHaveLength(0);
  });
});

describe('mshell:write via router', () => {
  it.each([
    ['an empty sessionId', { sessionId: '', data: 'x' }, 'sessionId'],
    ['a missing data field', { sessionId: 's' }, 'data'],
  ])('rejects %s with VALIDATION', async (_what, payload, path) => {
    expectSchemaReject(await shim.invoke(IPC_CHANNELS.mshellWrite, payload), path);
  });

  it('answers NOT_FOUND for an unknown session', async () => {
    const env = await shim.invoke(IPC_CHANNELS.mshellWrite, { sessionId: 'nope', data: 'x' });
    expect(env.ok).toBe(false);
    if (env.ok) return;
    expect(env.error.code).toBe('NOT_FOUND');
  });
});

describe('mshell:stop via router', () => {
  it('rejects an empty sessionId with VALIDATION', async () => {
    expectSchemaReject(await shim.invoke(IPC_CHANNELS.mshellStop, { sessionId: '' }), 'sessionId');
  });

  it('is a no-op for an unknown session', async () => {
    const env = await shim.invoke(IPC_CHANNELS.mshellStop, { sessionId: 'nope' });
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.data).toBeUndefined();
  });
});

describe('mshell session lifecycle via router', () => {
  it('starts a session, lists it, takes input for it and stops it', async () => {
    const started = await shim.invoke<ShellSessionInfo>(IPC_CHANNELS.mshellStart, {
      connectionId: 'c1',
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const { sessionId } = started.data;
    expect(typeof sessionId).toBe('string');
    expect(started.data.connectionId).toBe('c1');
    expect(spawner.spawns).toHaveLength(1);

    const listed = await shim.invoke<ShellSessionInfo[]>(IPC_CHANNELS.mshellList);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.data.map((s) => s.sessionId)).toEqual([sessionId]);

    const written = await shim.invoke(IPC_CHANNELS.mshellWrite, { sessionId, data: '1+1\n' });
    expect(written.ok).toBe(true);

    const stopped = await shim.invoke(IPC_CHANNELS.mshellStop, { sessionId });
    expect(stopped.ok).toBe(true);
    if (!stopped.ok) return;
    expect(stopped.data).toBeUndefined();

    const after = await shim.invoke<ShellSessionInfo[]>(IPC_CHANNELS.mshellList);
    expect(after).toEqual({ ok: true, data: [] });
  });
});
