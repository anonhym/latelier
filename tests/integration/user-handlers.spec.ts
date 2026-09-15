import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { createRouter } from '../../electron/ipc/router';
import { registerUserChannels } from '../../electron/ipc/handlers/users';
import { IPC_CHANNELS } from '../../shared/ipc';
import { NotFoundError, SystemError } from '../../electron/errors';
import type { UserService } from '../../electron/mongo/UserService';
import type { Envelope } from '../../shared/ipc';
import type { UserInfo, RoleInfo } from '@shared/types';
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

function stubSvc(overrides: Partial<UserService> = {}): UserService {
  const base: Partial<UserService> = {
    list: async () => [] as UserInfo[],
    get: async () => ({} as UserInfo),
    create: async () => ({ ok: true as const }),
    update: async () => ({ ok: true as const }),
    drop: async () => ({ dropped: true as const }),
    listRoles: async () => [] as RoleInfo[],
  };
  return { ...base, ...overrides } as UserService;
}

/**
 * P1-13: handler-layer integration tests for user:* — exercises the
 * SECRET_INPUT-carrying channels (`user:create`, `user:update`) through
 * Zod + envelope so the contract glue is regression-pinned.
 */
describe('user:* handlers via router', () => {
  let shim: ReturnType<typeof createShim>;

  function setupWith(overrides: Partial<UserService> = {}) {
    const svc = stubSvc(overrides);
    const router = createRouter(shim.ipcMain, testSenderCheck);
    registerUserChannels(router, svc);
  }

  beforeEach(() => {
    shim = createShim();
  });

  it('user:list rejects an empty connectionId via Zod', async () => {
    setupWith();
    const env = await shim.invoke<UserInfo[]>(IPC_CHANNELS.userList, { connectionId: '' });
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error.code).toBe('VALIDATION');
  });

  it('user:list with a valid connectionId returns the service result', async () => {
    const users: UserInfo[] = [
      {
        db: 'myapp',
        username: 'reader',
        mechanisms: ['SCRAM-SHA-256'],
        roles: [{ role: 'read', db: 'myapp' }],
        external: false,
      },
    ];
    setupWith({ list: async () => users });
    const env = await shim.invoke<UserInfo[]>(IPC_CHANNELS.userList, {
      connectionId: 'c1',
    });
    expect(env).toEqual({ ok: true, data: users });
  });

  it('user:create rejects an empty password via Zod (SECRET_INPUT field is required)', async () => {
    setupWith();
    const env = await shim.invoke(IPC_CHANNELS.userCreate, {
      connectionId: 'c1',
      dbName: 'myapp',
      username: 'newuser',
      password: '',
      roles: [{ role: 'read', db: 'myapp' }],
    });
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error.code).toBe('VALIDATION');
  });

  it('user:create with a valid SECRET_INPUT payload forwards to the service', async () => {
    const spy = vi.fn<UserService['create']>(async () => ({ ok: true as const }));
    setupWith({ create: spy });
    const env = await shim.invoke(IPC_CHANNELS.userCreate, {
      connectionId: 'c1',
      dbName: 'myapp',
      username: 'newuser',
      password: 's3cret',
      roles: [{ role: 'read', db: 'myapp' }],
    });
    expect(env.ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    // The plaintext password reached the service exactly once (this is the
    // SECRET_INPUT path; we want to confirm no extra layering swallows it).
    expect(spy.mock.calls[0]![0]!.password).toBe('s3cret');
  });

  it('user:update without password is accepted (password optional on update)', async () => {
    const spy = vi.fn<UserService['update']>(async () => ({ ok: true as const }));
    setupWith({ update: spy });
    const env = await shim.invoke(IPC_CHANNELS.userUpdate, {
      connectionId: 'c1',
      dbName: 'myapp',
      username: 'reader',
      patch: { roles: [{ role: 'readWrite', db: 'myapp' }] },
    });
    expect(env.ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]!.patch.password).toBeUndefined();
  });

  it('user:update maps NotFoundError to NOT_FOUND code', async () => {
    setupWith({
      update: async () => {
        throw new NotFoundError('user does not exist', { username: 'ghost' });
      },
    });
    const env = await shim.invoke(IPC_CHANNELS.userUpdate, {
      connectionId: 'c1',
      dbName: 'myapp',
      username: 'ghost',
      patch: { password: 'newpw' },
    });
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error.code).toBe('NOT_FOUND');
  });

  it('user:drop maps SystemError(UNAUTHORIZED) to UNAUTHORIZED code', async () => {
    setupWith({
      drop: async () => {
        throw new SystemError('UNAUTHORIZED', 'not allowed to drop users');
      },
    });
    const env = await shim.invoke(IPC_CHANNELS.userDrop, {
      connectionId: 'c1',
      dbName: 'myapp',
      username: 'reader',
    });
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error.code).toBe('UNAUTHORIZED');
  });
});
