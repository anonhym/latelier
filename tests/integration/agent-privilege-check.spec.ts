import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import type { AgentAccessPool } from '../../electron/services/AgentAccessService';
import { NotFoundError, ValidationError } from '../../electron/errors';
import { createAgentHarness, type AgentHarness, type PoolStatus } from '../helpers/agentHarness';
import { getSharedMongoUri } from '../helpers/mongo';
import { startMongoMemoryServer } from '../helpers/startMongoMemoryServer';

const SHARE = 1;

/** A pool that reports the statuses a test sets and hands out the one real client registered per Connection. */
class ClientPool extends EventEmitter implements AgentAccessPool {
  statuses = new Map<string, PoolStatus>();
  clients = new Map<string, MongoClient>();
  /** Order of calls, to prove the status is read before the client is asked for. */
  calls: string[] = [];
  status(id: string): { status: PoolStatus } {
    this.calls.push('status');
    return { status: this.statuses.get(id) ?? 'disconnected' };
  }
  openAgentClient(): Promise<MongoClient> {
    return Promise.reject(new Error('the privilege check must never use the agent client'));
  }
  readClient(id: string): Promise<MongoClient> {
    this.calls.push('readClient');
    const client = this.clients.get(id);
    return client ? Promise.resolve(client) : Promise.reject(new Error(`no client for ${id}`));
  }
}

describe('the share-time privilege check against real servers', () => {
  let authServer: MongoMemoryServer;
  let authUri: string;
  const open: MongoClient[] = [];
  const harnesses: AgentHarness[] = [];

  beforeAll(async () => {
    authServer = await startMongoMemoryServer({ auth: { enable: true, customRootName: 'root', customRootPwd: 'rootpw' } });
    authUri = authServer.getUri();
    const root = await connect(authUri.replace('mongodb://', 'mongodb://root:rootpw@') + '?authSource=admin');
    await root.db('shop').command({ createUser: 'ro', pwd: 'pw', roles: [{ role: 'read', db: 'shop' }] });
    await root.db('shop').command({ createUser: 'rw', pwd: 'pw', roles: [{ role: 'readWrite', db: 'shop' }] });
  }, 120_000);

  afterAll(async () => {
    await authServer.stop();
  });

  afterEach(async () => {
    for (const c of open.splice(0)) await c.close();
    for (const h of harnesses.splice(0)) await h.cleanup();
  });

  async function connect(uri: string): Promise<MongoClient> {
    const client = new MongoClient(uri);
    await client.connect();
    open.push(client);
    return client;
  }

  function setup(platform: NodeJS.Platform = 'darwin') {
    const pool = new ClientPool();
    const h = createAgentHarness({ makePool: () => pool, platform });
    harnesses.push(h);
    const id = randomUUID();
    h.addConnection(id, 'prod');
    pool.statuses.set(id, 'connected');
    return { h, pool, id };
  }

  const asUser = (user: string) => connect(authUri.replace('mongodb://', `mongodb://${user}:pw@`) + '?authSource=shop');
  const isShared = (h: AgentHarness, id: string) => h.connRepo.findById(id)?.share_with_agents === 1;

  it('shows a read-only user as such, and shares on Share', async () => {
    const { h, pool, id } = setup();
    pool.clients.set(id, await asUser('ro'));
    h.answers.push(SHARE);

    const out = await h.svc.requestSetShared(id, true);

    expect(out).toEqual({ shared: true, privilege: { kind: 'read-only', roles: ['read@shop'] } });
    const box = h.boxes.at(-1)!;
    expect(box.buttons).toEqual(['Cancel', 'Share']);
    expect(box.type).toBe('info');
    expect(box.detail).toContain('This user can only read.');
    expect(isShared(h, id)).toBe(true);
    expect(h.svc.getState().privilege[id]).toEqual({ kind: 'read-only', roles: ['read@shop'] });
  });

  it('warns about a readWrite user by name, and still lets the user share', async () => {
    const { h, pool, id } = setup();
    pool.clients.set(id, await asUser('rw'));
    h.answers.push(SHARE);

    const out = await h.svc.requestSetShared(id, true);

    expect(out.privilege).toEqual({ kind: 'beyond-read', roles: ['readWrite@shop'] });
    expect(out.shared).toBe(true);
    const box = h.boxes.at(-1)!;
    expect(box.type).toBe('warning');
    expect(box.detail).toContain('readWrite@shop');
    expect(box.detail).toContain('read-only database user');
  });

  it('never reads a server with auth off as a pass', async () => {
    const { h, pool, id } = setup();
    pool.clients.set(id, await connect(getSharedMongoUri()));
    h.answers.push(SHARE);

    const out = await h.svc.requestSetShared(id, true);

    expect(out.privilege).toEqual({ kind: 'no-auth', roles: [] });
    const box = h.boxes.at(-1)!;
    expect(box.type).toBe('warning');
    expect(box.detail).toContain(
      'Cannot verify: this server does not require authentication, so anything that reaches it can write.',
    );
    expect(box.detail).not.toContain('This user can only read.');
  });

  it('reports a failed check with its error code, never the driver message, and never as a pass', async () => {
    const { h, pool, id } = setup();
    const failing = {
      db: () => ({
        command: () => Promise.reject(Object.assign(new Error('not authorized on admin at host.internal:27017'), { code: 13, codeName: 'Unauthorized' })),
      }),
    } as unknown as MongoClient;
    pool.clients.set(id, failing);
    h.answers.push(SHARE);

    const out = await h.svc.requestSetShared(id, true);

    expect(out.privilege).toEqual({ kind: 'failed', roles: [], errorCode: 'UNAUTHORIZED' });
    const text = h.boxes.map((b) => `${b.message}\n${b.detail}`).join('\n');
    expect(text).toContain("Could not check this user's privileges (error code: UNAUTHORIZED).");
    expect(text).not.toContain('host.internal');
    expect(text).not.toContain('This user can only read.');
  });

  it('asks for the privileges with a 5 second limit', async () => {
    const { h, pool, id } = setup();
    const command = vi.fn(async () => ({ authInfo: { authenticatedUsers: [], authenticatedUserRoles: [], authenticatedUserPrivileges: [] } }));
    const db = vi.fn(() => ({ command }));
    pool.clients.set(id, { db } as unknown as MongoClient);

    await h.svc.requestSetShared(id, true);

    expect(db).toHaveBeenCalledWith('admin');
    expect(command).toHaveBeenCalledWith({ connectionStatus: 1, showPrivileges: true, maxTimeMS: 5000 });
  });

  it('leaves the flag off when the user cancels, but still reports what the check found', async () => {
    const { h, pool, id } = setup();
    pool.clients.set(id, await asUser('rw'));
    h.answers.push(0);

    const out = await h.svc.requestSetShared(id, true);

    expect(out.shared).toBe(false);
    expect(out.privilege?.kind).toBe('beyond-read');
    expect(isShared(h, id)).toBe(false);
    expect(h.svc.getState().privilege).toEqual({});
  });

  it('asks the user to open a Connection that is not open, and neither checks nor shares it', async () => {
    const { h, pool, id } = setup();
    pool.statuses.set(id, 'disconnected');
    const readClient = vi.spyOn(pool, 'readClient');

    const out = await h.svc.requestSetShared(id, true);

    expect(out).toEqual({ shared: false });
    expect(h.boxes).toHaveLength(1);
    expect(h.boxes[0]!.title).toBe('Open this Connection first');
    expect(h.boxes[0]!.buttons).toEqual(['OK']);
    expect(readClient).not.toHaveBeenCalled();
    expect(isShared(h, id)).toBe(false);
  });

  it('reads the status before it asks for the client, and uses the user client, never the agent one', async () => {
    const { h, pool, id } = setup();
    pool.clients.set(id, await connect(getSharedMongoUri()));
    const openAgent = vi.spyOn(pool, 'openAgentClient');

    await h.svc.requestSetShared(id, true);

    expect(pool.calls).toEqual(['status', 'readClient']);
    expect(openAgent).not.toHaveBeenCalled();
  });

  it('refuses an SSH-tunnelled Connection with a clear message, without a dialog or a check', async () => {
    const { h, pool, id } = setup();
    h.tmp.db.prepare('UPDATE connections SET ssh_enabled = 1 WHERE id = ?').run(id);
    const readClient = vi.spyOn(pool, 'readClient');

    await expect(h.svc.requestSetShared(id, true)).rejects.toThrow(ValidationError);
    await expect(h.svc.requestSetShared(id, true)).rejects.toThrow(/SSH tunnel cannot be shared with Agents/);
    expect(h.boxes).toHaveLength(0);
    expect(readClient).not.toHaveBeenCalled();
    expect(isShared(h, id)).toBe(false);
  });

  it('refuses a Connection that does not exist', async () => {
    const { h } = setup();
    await expect(h.svc.requestSetShared(randomUUID(), true)).rejects.toThrow(NotFoundError);
    await expect(h.svc.requestSetShared(randomUUID(), false)).rejects.toThrow(NotFoundError);
  });

  it('unshares at once, with no dialog and no check, and forgets the verdict', async () => {
    const { h, pool, id } = setup();
    pool.clients.set(id, await asUser('ro'));
    h.answers.push(SHARE);
    await h.svc.requestSetShared(id, true);
    const boxesBefore = h.boxes.length;
    const readClient = vi.spyOn(pool, 'readClient');

    const out = await h.svc.requestSetShared(id, false);

    expect(out).toEqual({ shared: false });
    expect(h.boxes).toHaveLength(boxesBefore);
    expect(readClient).not.toHaveBeenCalled();
    expect(isShared(h, id)).toBe(false);
    expect(h.svc.getState().privilege).toEqual({});
  });

  it('says the token is the only protection on Windows, in the share dialog, and not elsewhere', async () => {
    const win = setup('win32');
    win.pool.clients.set(win.id, await connect(getSharedMongoUri()));
    await win.h.svc.requestSetShared(win.id, true);
    expect(win.h.boxes.at(-1)!.detail).toContain('the only protection against other users of this computer is the Agent Token');

    const mac = setup('darwin');
    mac.pool.clients.set(mac.id, await connect(getSharedMongoUri()));
    await mac.h.svc.requestSetShared(mac.id, true);
    expect(mac.h.boxes.at(-1)!.detail).not.toContain('Agent Token');
  });

  it('keeps the verdict only for Connections that are still shared', async () => {
    const { h, pool, id } = setup();
    pool.clients.set(id, await asUser('ro'));
    h.answers.push(SHARE);
    await h.svc.requestSetShared(id, true);
    h.connRepo.setShared(id, false);
    expect(h.svc.getState().privilege).toEqual({});
  });

  it('pushes the new state when the flag changes', async () => {
    const { h, pool, id } = setup();
    pool.clients.set(id, await asUser('ro'));
    h.answers.push(SHARE);
    const before = h.states.length;
    await h.svc.requestSetShared(id, true);
    expect(h.states.length).toBeGreaterThan(before);
    expect(h.states.at(-1)!.privilege[id]!.kind).toBe('read-only');
  });
});
