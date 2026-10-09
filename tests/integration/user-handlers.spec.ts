import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRouter } from '../../electron/ipc/router';
import { registerUserChannels } from '../../electron/ipc/handlers/users';
import { IPC_CHANNELS } from '../../shared/ipc';
import { NotFoundError, SystemError } from '../../electron/errors';
import type { UserService } from '../../electron/mongo/UserService';
import type { UserInfo, RoleInfo } from '@shared/types';
import { createIpcShim } from '../helpers/ipcShim';
import { testSenderCheck } from '../helpers/ipcSender';

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
  let shim: ReturnType<typeof createIpcShim>;

  function setupWith(overrides: Partial<UserService> = {}) {
    const svc = stubSvc(overrides);
    const router = createRouter(shim.ipcMain, testSenderCheck);
    registerUserChannels(router, svc);
  }

  beforeEach(() => {
    shim = createIpcShim();
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

  describe('user:get', () => {
    const payload = { connectionId: 'c1', dbName: 'myapp', username: 'reader' };

    it('passes exactly the validated object to the service and returns its user', async () => {
      const user: UserInfo = {
        db: 'myapp',
        username: 'reader',
        mechanisms: ['SCRAM-SHA-256'],
        roles: [{ role: 'read', db: 'myapp' }],
        external: false,
      };
      const spy = vi.fn<UserService['get']>(async () => user);
      setupWith({ get: spy });

      const env = await shim.invoke<UserInfo>(IPC_CHANNELS.userGet, payload);

      expect(env).toEqual({ ok: true, data: user });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(payload);
    });

    it.each(['connectionId', 'dbName', 'username'] as const)(
      'rejects a payload without %s with VALIDATION and never calls the service',
      async (field) => {
        const spy = vi.fn<UserService['get']>(async () => ({}) as UserInfo);
        setupWith({ get: spy });
        const rest = Object.fromEntries(Object.entries(payload).filter(([k]) => k !== field));

        const env = await shim.invoke(IPC_CHANNELS.userGet, rest);

        expect(env.ok).toBe(false);
        if (!env.ok) expect(env.error.code).toBe('VALIDATION');
        expect(spy).not.toHaveBeenCalled();
      },
    );

    it.each(['connectionId', 'dbName', 'username'] as const)(
      'rejects an empty %s with VALIDATION and never calls the service',
      async (field) => {
        const spy = vi.fn<UserService['get']>(async () => ({}) as UserInfo);
        setupWith({ get: spy });

        const env = await shim.invoke(IPC_CHANNELS.userGet, { ...payload, [field]: '' });

        expect(env.ok).toBe(false);
        if (!env.ok) expect(env.error.code).toBe('VALIDATION');
        expect(spy).not.toHaveBeenCalled();
      },
    );

    it('maps the service NotFoundError to NOT_FOUND', async () => {
      setupWith({
        get: async () => {
          throw new NotFoundError('user does not exist', { username: 'reader' });
        },
      });

      const env = await shim.invoke(IPC_CHANNELS.userGet, payload);

      expect(env.ok).toBe(false);
      if (!env.ok) expect(env.error.code).toBe('NOT_FOUND');
    });
  });

  describe('role:list', () => {
    const payload = { connectionId: 'c1', dbName: 'myapp' };

    it('passes exactly the validated object to the service and returns its roles', async () => {
      const roles: RoleInfo[] = [
        { role: 'read', db: 'myapp', isBuiltin: true, inheritedRoles: [] },
      ];
      const spy = vi.fn<UserService['listRoles']>(async () => roles);
      setupWith({ listRoles: spy });

      const env = await shim.invoke<RoleInfo[]>(IPC_CHANNELS.roleList, payload);

      expect(env).toEqual({ ok: true, data: roles });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(payload);
    });

    it.each(['connectionId', 'dbName'] as const)(
      'rejects a payload without %s with VALIDATION and never calls the service',
      async (field) => {
        const spy = vi.fn<UserService['listRoles']>(async () => [] as RoleInfo[]);
        setupWith({ listRoles: spy });
        const rest = Object.fromEntries(Object.entries(payload).filter(([k]) => k !== field));

        const env = await shim.invoke(IPC_CHANNELS.roleList, rest);

        expect(env.ok).toBe(false);
        if (!env.ok) expect(env.error.code).toBe('VALIDATION');
        expect(spy).not.toHaveBeenCalled();
      },
    );

    it.each(['connectionId', 'dbName'] as const)(
      'rejects an empty %s with VALIDATION and never calls the service',
      async (field) => {
        const spy = vi.fn<UserService['listRoles']>(async () => [] as RoleInfo[]);
        setupWith({ listRoles: spy });

        const env = await shim.invoke(IPC_CHANNELS.roleList, { ...payload, [field]: '' });

        expect(env.ok).toBe(false);
        if (!env.ok) expect(env.error.code).toBe('VALIDATION');
        expect(spy).not.toHaveBeenCalled();
      },
    );
  });
});
