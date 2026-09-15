import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IpcMainInvokeEvent } from 'electron';
import { createRouter } from '../../electron/ipc/router';
import { registerMongoChannels } from '../../electron/ipc/handlers/mongo';
import { IPC_CHANNELS } from '../../shared/ipc';
import { NotFoundError } from '../../electron/errors';
import type { MongoPool } from '../../electron/mongo/MongoPool';
import type { Envelope, ServerInfo } from '../../shared/ipc';
import type { ConnectionRuntime } from '@shared/types';
import { invokeEvent, testSenderCheck } from '../helpers/ipcSender';

type Handler = (evt: IpcMainInvokeEvent, payload: unknown) => unknown;

// The router never reads the event (`_evt` in router.ts), so the shim stands
// one in rather than constructing a real Electron event.

function createShim() {
  const handlers = new Map<string, Handler>();
  return {
    ipcMain: {
      handle(channel: string, fn: Handler) {
        handlers.set(channel, fn);
      },
    } as const,
    async invoke<T>(channel: string, payload: unknown): Promise<Envelope<T>> {
      const h = handlers.get(channel);
      if (!h) throw new Error(`no handler for ${channel}`);
      return (await h(invokeEvent, payload)) as Envelope<T>;
    },
  };
}

function fakeRuntime(over: Partial<ConnectionRuntime> = {}): ConnectionRuntime {
  return { id: 'c1', status: 'connected', ...over };
}

function fakeServerInfo(over: Partial<ServerInfo> = {}): ServerInfo {
  return {
    version: '7.0.0',
    uptimeSeconds: 100,
    connectionsCurrent: 1,
    connectionsAvailable: 99,
    opcountersPerSec: 0,
    databaseCount: 2,
    dataSizeBytes: 1024,
    storageSizeBytes: 2048,
    indexCount: 3,
    topology: 'Single',
    serverStatsAvailable: true,
    ...over,
  };
}

/**
 * `mongo:*` had router-level coverage nowhere: `mongo-pool.spec.ts`
 * exercises `MongoPool` directly, never through `createRouter`/
 * `registerMongoChannels`, so Zod validation, `AppError` → `IpcError.code`
 * mapping, and the envelope shape for this domain were unverified. `pool` is
 * stubbed (a real `EventEmitter` with the five methods `registerMongoChannels`
 * calls, cast to `MongoPool`) so each test isolates the handler/router
 * behavior, matching the pattern in `conn-handlers.spec.ts`.
 */
describe('mongo:* handlers via router', () => {
  let shim: ReturnType<typeof createShim>;
  let pool: MongoPool;
  let webContents: { isDestroyed: () => boolean; send: ReturnType<typeof vi.fn> } | null;

  beforeEach(() => {
    shim = createShim();
    webContents = null;
  });

  function setupWith(overrides: Partial<MongoPool> = {}) {
    const base: Partial<MongoPool> = {
      connect: async () => fakeRuntime(),
      disconnect: async () => undefined,
      status: () => fakeRuntime(),
      ping: async () => 5,
      serverInfo: async () => fakeServerInfo(),
    };
    pool = Object.assign(new EventEmitter(), base, overrides) as unknown as MongoPool;
    const router = createRouter(shim.ipcMain, testSenderCheck);
    registerMongoChannels(router, pool, () => webContents as never);
  }

  it('mongo:connect returns the pool runtime through the envelope', async () => {
    const runtime = fakeRuntime({ status: 'connected', serverVersion: '7.0.0' });
    setupWith({ connect: async () => runtime });
    const env = await shim.invoke<ConnectionRuntime>(IPC_CHANNELS.mongoConnect, { id: 'c1' });
    expect(env).toEqual({ ok: true, data: runtime });
  });

  it('mongo:connect maps NotFoundError to NOT_FOUND', async () => {
    setupWith({
      connect: async () => {
        throw new NotFoundError('connection missing not found', { id: 'missing' });
      },
    });
    const env = await shim.invoke<ConnectionRuntime>(IPC_CHANNELS.mongoConnect, { id: 'missing' });
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error.code).toBe('NOT_FOUND');
  });

  it('mongo:connect with a missing id fails Zod (VALIDATION)', async () => {
    setupWith();
    const env = await shim.invoke<ConnectionRuntime>(IPC_CHANNELS.mongoConnect, { id: '' });
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error.code).toBe('VALIDATION');
  });

  it('mongo:disconnect calls pool.disconnect and returns { id }', async () => {
    const disconnectSpy = vi.fn(async () => undefined);
    setupWith({ disconnect: disconnectSpy });
    const env = await shim.invoke<{ id: string }>(IPC_CHANNELS.mongoDisconnect, { id: 'c1' });
    expect(env).toEqual({ ok: true, data: { id: 'c1' } });
    expect(disconnectSpy).toHaveBeenCalledWith('c1');
  });

  it('mongo:status forwards the pool runtime synchronously through the envelope', async () => {
    const runtime = fakeRuntime({ status: 'error', errorCode: 'AUTH' });
    setupWith({ status: () => runtime });
    const env = await shim.invoke<ConnectionRuntime>(IPC_CHANNELS.mongoStatus, { id: 'c1' });
    expect(env).toEqual({ ok: true, data: runtime });
  });

  it('mongo:ping wraps the pool round-trip in { roundTripMs }', async () => {
    setupWith({ ping: async () => 42 });
    const env = await shim.invoke<{ roundTripMs: number }>(IPC_CHANNELS.mongoPing, { id: 'c1' });
    expect(env).toEqual({ ok: true, data: { roundTripMs: 42 } });
  });

  it('mongo:serverInfo returns the pool result through the envelope', async () => {
    const info = fakeServerInfo({ version: '8.1.0', databaseCount: 5 });
    setupWith({ serverInfo: async () => info });
    const env = await shim.invoke<ServerInfo>(IPC_CHANNELS.mongoServerInfo, { id: 'c1' });
    expect(env).toEqual({ ok: true, data: info });
  });

  it('a "status" event on the pool is forwarded to the renderer over mongo:status-event', () => {
    webContents = { isDestroyed: () => false, send: vi.fn() };
    setupWith();
    const runtime = fakeRuntime({ status: 'connecting' });
    pool.emit('status', runtime);
    expect(webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.mongoStatusEvent, runtime);
  });

  it('a "status" event is dropped, not thrown, when there is no live webContents to forward to', () => {
    webContents = null;
    setupWith();
    // getWebContents() returning null must not throw synchronously inside the
    // pool's own 'status' emit — a listener throwing would crash whatever
    // else triggered the status change (a connect/disconnect in progress).
    expect(() => pool.emit('status', fakeRuntime())).not.toThrow();
  });

  it('a "status" event is dropped when the webContents is already destroyed', () => {
    const send = vi.fn();
    webContents = { isDestroyed: () => true, send };
    setupWith();
    pool.emit('status', fakeRuntime());
    expect(send).not.toHaveBeenCalled();
  });
});
