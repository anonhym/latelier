import { describe, it, expect, afterEach, vi } from 'vitest';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { AgentGate, type AgentSessionIdentity } from '../../electron/agent/AgentGate';
import * as ejsonModule from '../../electron/mongo/ejson';
import { AGENT_ACCESS_KEY } from '../../electron/ipc/prefKeys';
import { hashToken } from '../../electron/agent/token';
import { createReadFixture, type FixtureOptions, type ReadFixture } from '../helpers/agentFixture';
import { textOf } from '../helpers/agentSocket';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('AgentGate with a real pool', () => {
  let f: ReadFixture;
  let gate: AgentGate;
  let accessOn: boolean;
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
    vi.restoreAllMocks();
    await f?.cleanup();
  });

  async function setup(options: FixtureOptions = {}) {
    f = await createReadFixture(options);
    accessOn = true;
    gate = new AgentGate({
      accessOn: () => accessOn,
      connections: f.h.connRepo,
      pool: f.m.pool,
      tokens: f.h.tokenRepo,
      log: f.h.log,
    });
    cleanups.push(async () => {
      await gate.close();
      gate.dispose();
    });
    await f.db.collection('orders').insertMany(
      Array.from({ length: 10 }, (_, i) => ({ _id: i + 1, n: i + 1, label: `order-${i + 1}` })) as never,
    );
  }

  function identity(tokenId = f.tokenId): AgentSessionIdentity {
    const row = f.h.tokenRepo.findById(tokenId)!;
    return { sessionId: randomUUID(), tokenId, tokenHash: row.token_hash, tokenName: row.name, clientName: null, clientVersion: null };
  }

  const live = () => new AbortController().signal;
  const refusal = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (err) {
      return (err as { code?: string }).code;
    }
    return 'admitted';
  };

  describe('the three gates', () => {
    it('refuses with ACCESS_OFF when Agent Access is off', async () => {
      await setup();
      accessOn = false;
      expect(await refusal(gate.acquire(f.connectionId, identity(), live()))).toBe('ACCESS_OFF');
    });

    it('refuses with NOT_SHARED when the Connection is not shared, and for an id it has never heard of', async () => {
      await setup();
      f.h.connRepo.setShared(f.connectionId, false);
      expect(await refusal(gate.acquire(f.connectionId, identity(), live()))).toBe('NOT_SHARED');
      expect(await refusal(gate.acquire(randomUUID(), identity(), live()))).toBe('NOT_SHARED');
    });

    it('refuses a Dormant shared Connection with NOT_OPEN and never connects it', async () => {
      await setup({ connect: false });
      const connect = vi.spyOn(f.m.pool, 'connect');
      const readClient = vi.spyOn(f.m.pool, 'readClient');
      const readDb = vi.spyOn(f.m.pool, 'readDb');
      const builtBefore = f.m.factoryCalls.length;
      expect(await refusal(gate.acquire(f.connectionId, identity(), live()))).toBe('NOT_OPEN');
      const reply = await f.call('find', { ...f.on('orders') });
      expect(textOf(reply)).toMatch(/^NOT_OPEN: /);
      expect(connect).not.toHaveBeenCalled();
      expect(readClient).not.toHaveBeenCalled();
      expect(readDb).not.toHaveBeenCalled();
      expect(f.m.pool.status(f.connectionId).status).toBe('disconnected');
      expect(f.m.factoryCalls.length).toBe(builtBefore);
      expect(gate.hasClient(f.connectionId)).toBe(false);
    });

    it('reports a Connection that was lost as NOT_OPEN rather than waking it', async () => {
      await setup();
      await f.m.pool.disconnect(f.connectionId);
      const connect = vi.spyOn(f.m.pool, 'connect');
      expect(await refusal(gate.acquire(f.connectionId, identity(), live()))).toBe('NOT_OPEN');
      expect(connect).not.toHaveBeenCalled();
    });

    it('refuses a revoked token and a regenerated one with ACCESS_OFF', async () => {
      await setup();
      const before = identity();
      f.h.tokenRepo.replaceHash(f.tokenId, hashToken('a-new-token'));
      expect(await refusal(gate.acquire(f.connectionId, before, live()))).toBe('ACCESS_OFF');
      const after = identity();
      (await gate.acquire(f.connectionId, after, live())).release();
      f.h.tokenRepo.deleteById(f.tokenId);
      expect(await refusal(gate.acquire(f.connectionId, after, live()))).toBe('ACCESS_OFF');
    });

    it('admits a call that passes every gate, and gives it an agent client', async () => {
      await setup();
      const lease = await gate.acquire(f.connectionId, identity(), live());
      const cursor = lease.client.db(f.dbName).collection('orders').find({}, { limit: 1 });
      expect(await cursor.toArray()).toHaveLength(1);
      lease.release();
    });
  });

  describe('the agent client', () => {
    it('is not opened until the first call, and only for the Connection called', async () => {
      await setup();
      expect(f.m.agentClients.opened).toBe(0);
      expect(gate.hasClient(f.connectionId)).toBe(false);
      (await gate.acquire(f.connectionId, identity(), live())).release();
      expect(f.m.agentClients.opened).toBe(1);
    });

    it('is a separate client with a pool of two, and is reused by later calls', async () => {
      await setup();
      const userClients = f.m.factoryCalls.filter((o) => o.maxPoolSize !== 2);
      expect(userClients).toHaveLength(1);
      const a = await gate.acquire(f.connectionId, identity(), live());
      const b = await gate.acquire(f.connectionId, identity(), live());
      expect(b.client).toBe(a.client);
      expect(f.m.factoryCalls.filter((o) => o.maxPoolSize === 2)).toHaveLength(1);
      expect(f.m.factoryCalls.filter((o) => o.maxPoolSize !== 2)).toHaveLength(1);
      a.release();
      b.release();
    });

    it('opens one client when calls arrive together', async () => {
      await setup();
      const leases = await Promise.all([1, 2].map(() => gate.acquire(f.connectionId, identity(), live())));
      expect(f.m.agentClients.opened).toBe(1);
      for (const l of leases) l.release();
    });

    it('never asks the pool for its own client or database', async () => {
      await setup();
      const readClient = vi.spyOn(f.m.pool, 'readClient');
      const readDb = vi.spyOn(f.m.pool, 'readDb');
      const connect = vi.spyOn(f.m.pool, 'connect');
      (await gate.acquire(f.connectionId, identity(), live())).release();
      expect([readClient, readDb, connect].map((s) => s.mock.calls.length)).toEqual([0, 0, 0]);
    });

    it('retries the open on the next call after one failed, and delivers the failure to the caller', async () => {
      await setup();
      const open = vi.spyOn(f.m.pool, 'openAgentClient').mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 91 }));
      await expect(gate.acquire(f.connectionId, identity(), live())).rejects.toThrow('boom');
      expect(gate.hasClient(f.connectionId)).toBe(false);
      (await gate.acquire(f.connectionId, identity(), live())).release();
      expect(open).toHaveBeenCalledTimes(2);
      expect(gate.hasClient(f.connectionId)).toBe(true);
    });

    it('frees the slot of a call whose client could not be opened', async () => {
      await setup();
      vi.spyOn(f.m.pool, 'openAgentClient').mockRejectedValue(new Error('boom'));
      for (let i = 0; i < 8; i += 1) await expect(gate.acquire(f.connectionId, identity(), live())).rejects.toThrow('boom');
    });
  });

  describe('closing the agent client', () => {
    async function openClient() {
      const lease = await gate.acquire(f.connectionId, identity(), live());
      lease.release();
      expect(gate.hasClient(f.connectionId)).toBe(true);
    }

    it('closes it, and aborts what runs, when the Connection closes', async () => {
      await setup();
      const lease = await gate.acquire(f.connectionId, identity(), live());
      await f.m.pool.disconnect(f.connectionId);
      expect(lease.signal.aborted).toBe(true);
      await gate.whenClosed();
      expect(gate.hasClient(f.connectionId)).toBe(false);
      expect(f.m.agentClients.closed).toBe(1);
      expect(() => lease.assertStill()).toThrow(expect.objectContaining({ code: 'CANCELLED' }));
      lease.release();
    });

    it.each(['connecting', 'disconnected', 'error'] as const)('closes it on a %s status', async (status) => {
      await setup();
      await openClient();
      f.m.pool.emit('status', { id: f.connectionId, status });
      await gate.whenClosed();
      expect(gate.hasClient(f.connectionId)).toBe(false);
    });

    it('leaves it alone on a connected status, and on another Connection\'s status', async () => {
      await setup();
      await openClient();
      f.m.pool.emit('status', { id: f.connectionId, status: 'connected' });
      f.m.pool.emit('status', { id: randomUUID(), status: 'disconnected' });
      await gate.whenClosed();
      expect(gate.hasClient(f.connectionId)).toBe(true);
      expect(f.m.agentClients.closed).toBe(0);
    });

    it('opens a fresh client once the Connection is open again', async () => {
      await setup();
      await openClient();
      await f.m.pool.disconnect(f.connectionId);
      await gate.whenClosed();
      await f.m.pool.connect(f.connectionId);
      (await gate.acquire(f.connectionId, identity(), live())).release();
      expect(f.m.agentClients.opened).toBe(2);
    });

    it('closes it when the share flag goes off, through the service', async () => {
      await setup();
      await f.agent.close();
      await openClient();
      expect(gate.hasClient(f.connectionId)).toBe(true);
      gate.revokeConnection(f.connectionId);
      await gate.whenClosed();
      expect(gate.hasClient(f.connectionId)).toBe(false);
    });

    it('closes every agent client on revokeAll, and close() waits for them', async () => {
      await setup();
      await openClient();
      await gate.close();
      expect(f.m.agentClients).toEqual({ opened: 1, closed: 1 });
      expect(gate.hasClient(f.connectionId)).toBe(false);
    });

    it('stops following the pool after dispose', async () => {
      await setup();
      await openClient();
      gate.dispose();
      f.m.pool.emit('status', { id: f.connectionId, status: 'disconnected' });
      await gate.whenClosed();
      expect(gate.hasClient(f.connectionId)).toBe(true);
    });

    it('closes a client that finishes opening after the Connection closed', async () => {
      await setup();
      let finish: (() => void) | undefined;
      const real = f.m.pool.openAgentClient.bind(f.m.pool);
      vi.spyOn(f.m.pool, 'openAgentClient').mockImplementationOnce(
        (id) =>
          new Promise((resolve, reject) => {
            finish = () => void real(id).then(resolve, reject);
          }),
      );
      const pending = gate.acquire(f.connectionId, identity(), live());
      await flush();
      f.m.pool.emit('status', { id: f.connectionId, status: 'disconnected' });
      finish!();
      await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
      await gate.whenClosed();
      expect(f.m.agentClients).toEqual({ opened: 1, closed: 1 });
    });
  });

  describe('revocation and the abort registry', () => {
    it('aborts only the operations of the revoked token', async () => {
      await setup();
      const other = f.h.svc.addToken('Cursor');
      const mine = await gate.acquire(f.connectionId, identity(), live());
      const theirs = await gate.acquire(f.connectionId, identity(other.info.id), live());
      gate.revokeToken(other.info.id);
      expect(theirs.signal.aborted).toBe(true);
      expect(mine.signal.aborted).toBe(false);
      mine.release();
      theirs.release();
    });

    it('aborts only the operations on the revoked Connection', async () => {
      await setup();
      const second = randomUUID();
      f.h.addConnection(second, 'staging', { shared: true, hostPort: { host: '127.0.0.1', port: 1 } });
      f.m.pool.emit('status', { id: second, status: 'connected' });
      const mine = await gate.acquire(f.connectionId, identity(), live());
      gate.revokeConnection(second);
      expect(mine.signal.aborted).toBe(false);
      gate.revokeConnection(f.connectionId);
      expect(mine.signal.aborted).toBe(true);
      mine.release();
    });

    it('aborts everything on revokeAll', async () => {
      await setup();
      const a = await gate.acquire(f.connectionId, identity(), live());
      const b = await gate.acquire(f.connectionId, identity(), live());
      gate.revokeAll();
      expect([a.signal.aborted, b.signal.aborted]).toEqual([true, true]);
      a.release();
      b.release();
    });

    it('does not abort a released operation, and forgets it', async () => {
      await setup();
      const lease = await gate.acquire(f.connectionId, identity(), live());
      lease.release();
      lease.release();
      gate.revokeConnection(f.connectionId);
      expect(lease.signal.aborted).toBe(false);
    });

    it('aborts the lease when the client cancels the request', async () => {
      await setup();
      const mcp = new AbortController();
      const lease = await gate.acquire(f.connectionId, identity(), mcp.signal);
      expect(lease.signal.aborted).toBe(false);
      mcp.abort();
      expect(lease.signal.aborted).toBe(true);
      lease.release();
    });

    it.each([
      ['the share flag is off', () => f.h.connRepo.setShared(f.connectionId, false)],
      ['Agent Access is off', () => (accessOn = false)],
      ['the token is gone', () => f.h.tokenRepo.deleteById(f.tokenId)],
      ['the token was replaced', () => f.h.tokenRepo.replaceHash(f.tokenId, hashToken('replacement'))],
      ['the Connection row is gone', () => f.h.connRepo.deleteById(f.connectionId)],
      ['the Connection is no longer open', () => f.m.pool.emit('status', { id: f.connectionId, status: 'disconnected' })],
    ])('assertStill throws CANCELLED once %s', async (_label, change) => {
      await setup();
      const lease = await gate.acquire(f.connectionId, identity(), live());
      expect(() => lease.assertStill()).not.toThrow();
      await change();
      expect(() => lease.assertStill()).toThrow(expect.objectContaining({ code: 'CANCELLED' }));
      lease.release();
    });
  });

  describe('a revocation that lands while a call waits for its slot', () => {
    it('refuses the call before any client is opened', async () => {
      await setup();
      // The revocation is already queued when the call starts: it finds no client to close and no slot yet.
      queueMicrotask(() => {
        f.h.connRepo.setShared(f.connectionId, false);
        gate.revokeConnection(f.connectionId);
      });
      expect(await refusal(gate.acquire(f.connectionId, identity(), live()))).toBe('CANCELLED');
      await gate.whenClosed();
      expect(f.m.agentClients.opened).toBe(0);
      expect(gate.hasClient(f.connectionId)).toBe(false);
    });

    it('closes a client that finished opening for a Connection whose gate closed meanwhile', async () => {
      await setup();
      let finish: (() => void) | undefined;
      const real = f.m.pool.openAgentClient.bind(f.m.pool);
      vi.spyOn(f.m.pool, 'openAgentClient').mockImplementationOnce(
        (id) =>
          new Promise((resolve, reject) => {
            finish = () => void real(id).then(resolve, reject);
          }),
      );
      const pending = refusal(gate.acquire(f.connectionId, identity(), live()));
      await flush();
      // Flipped in the row only, with no revocation: nothing else would close the client.
      f.h.connRepo.setShared(f.connectionId, false);
      finish!();
      expect(await pending).toBe('CANCELLED');
      await gate.whenClosed();
      expect(f.m.agentClients).toEqual({ opened: 1, closed: 1 });
      expect(gate.hasClient(f.connectionId)).toBe(false);
    });
  });

  describe('a client that is still opening', () => {
    /** A server that accepts the TCP connection and never answers, as a database that stopped responding does. */
    async function silentConnection(): Promise<string> {
      const server = net.createServer(() => undefined);
      const sockets = new Set<net.Socket>();
      server.on('connection', (socket) => sockets.add(socket));
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      cleanups.push(async () => {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      });
      const id = randomUUID();
      f.h.addConnection(id, 'silent', { shared: true, hostPort: { host: '127.0.0.1', port: (server.address() as net.AddressInfo).port } });
      const real = f.m.pool.status.bind(f.m.pool);
      vi.spyOn(f.m.pool, 'status').mockImplementation((target) => (target === id ? ({ status: 'connected' } as never) : real(target)));
      return id;
    }

    it('lets close() return within a second while the open waits on a server that never answers', async () => {
      await setup();
      const id = await silentConnection();
      const pending = refusal(gate.acquire(id, identity(), live()));
      await flush();
      expect(gate.hasClient(id)).toBe(true);
      const started = Date.now();
      await gate.close();
      expect(Date.now() - started).toBeLessThan(1000);
      expect(await pending).toBe('CANCELLED');
      expect(gate.hasClient(id)).toBe(false);
    });

    it('rejects the pool open as soon as its signal aborts, against a server that never answers', async () => {
      await setup();
      const id = await silentConnection();
      const ctrl = new AbortController();
      const opening = f.m.pool.openAgentClient(id, ctrl.signal);
      const outcome = opening.then(() => 'opened', () => 'rejected');
      await flush();
      const started = Date.now();
      ctrl.abort();
      expect(await outcome).toBe('rejected');
      expect(Date.now() - started).toBeLessThan(1000);
      await expect(f.m.pool.openAgentClient(id, ctrl.signal)).rejects.toThrow(/cancelled/);
    });

    it('stops waiting for agent clients that will not finish closing, and says so', async () => {
      await setup();
      vi.spyOn(f.m.pool, 'openAgentClient').mockImplementation(
        () => Promise.resolve({ close: () => new Promise<void>(() => undefined) } as never),
      );
      (await gate.acquire(f.connectionId, identity(), live())).release();
      const started = Date.now();
      await gate.close(50);
      expect(Date.now() - started).toBeLessThan(1000);
      expect(f.h.log.warn).toHaveBeenCalledWith('agent', expect.stringContaining('still closing'), expect.anything());
    });

    it('frees the concurrency slot of a revoked call at once', async () => {
      await setup();
      vi.spyOn(f.m.pool, 'openAgentClient').mockImplementation(() => new Promise(() => undefined));
      const callers = Array.from({ length: 2 }, () => refusal(gate.acquire(f.connectionId, identity(), live())));
      await flush();
      gate.revokeConnection(f.connectionId);
      expect(await Promise.all(callers)).toEqual(['CANCELLED', 'CANCELLED']);
      vi.restoreAllMocks();
      // Both slots are free again, so two more calls are admitted instead of queueing behind dead ones.
      const again = await Promise.all([1, 2].map(() => gate.acquire(f.connectionId, identity(), live())));
      for (const l of again) l.release();
    });
  });

  describe('concurrency', () => {
    it('lets two run, queues four, and refuses the seventh with BUSY', async () => {
      await setup();
      const first = await gate.acquire(f.connectionId, identity(), live());
      const second = await gate.acquire(f.connectionId, identity(), live());
      const queued = Array.from({ length: 4 }, () => gate.acquire(f.connectionId, identity(), live()));
      const settled = queued.map((p) => {
        const s = { done: false };
        p.then(() => (s.done = true), () => (s.done = true));
        return s;
      });
      await flush();
      expect(settled.every((s) => !s.done)).toBe(true);
      expect(await refusal(gate.acquire(f.connectionId, identity(), live()))).toBe('BUSY');
      first.release();
      (await queued[0]!).release();
      second.release();
      for (const p of queued.slice(1)) (await p).release();
    });

    it('counts per Connection', async () => {
      await setup();
      const other = randomUUID();
      f.h.addConnection(other, 'staging', { shared: true, hostPort: { host: '127.0.0.1', port: 1 } });
      f.m.pool.emit('status', { id: other, status: 'connected' });
      const held = await Promise.all([1, 2].map(() => gate.acquire(f.connectionId, identity(), live())));
      const stuck = gate.acquire(f.connectionId, identity(), live());
      vi.spyOn(f.m.pool, 'status').mockImplementation((id) => ({ status: id === other || id === f.connectionId ? 'connected' : 'disconnected' }) as never);
      vi.spyOn(f.m.pool, 'openAgentClient').mockResolvedValue(held[0]!.client);
      // The other Connection has no slot taken, so it is admitted at once while this one is still full.
      const free = await gate.acquire(other, identity(), live());
      expect(free).toBeDefined();
      free.release();
      expect(await Promise.race([stuck.then(() => 'admitted', () => 'refused'), flush().then(() => 'still queued')])).toBe('still queued');
      for (const l of held) l.release();
      const granted = await stuck;
      expect(granted).toBeDefined();
      granted.release();
    });

    it('lets a queued call leave when its request is cancelled', async () => {
      await setup();
      const held = await Promise.all([1, 2].map(() => gate.acquire(f.connectionId, identity(), live())));
      const mcp = new AbortController();
      const waiting = gate.acquire(f.connectionId, identity(), mcp.signal);
      mcp.abort();
      expect(await refusal(waiting)).toBe('CANCELLED');
      for (const l of held) l.release();
    });

    it('cancels a queued call when its Connection is revoked, and a queued call granted after an unshare', async () => {
      await setup();
      const held = await Promise.all([1, 2].map(() => gate.acquire(f.connectionId, identity(), live())));
      const revoked = gate.acquire(f.connectionId, identity(), live());
      gate.revokeConnection(f.connectionId);
      expect(await refusal(revoked)).toBe('CANCELLED');
      for (const l of held) l.release();

      // A call that waits while the flag goes off, without a revocation reaching it: the gates are read again on the grant.
      await f.m.pool.connect(f.connectionId);
      const again = await Promise.all([1, 2].map(() => gate.acquire(f.connectionId, identity(), live())));
      const late = gate.acquire(f.connectionId, identity(), live());
      f.h.connRepo.setShared(f.connectionId, false);
      again[0]!.release();
      expect(await refusal(late)).toBe('CANCELLED');
      again[1]!.release();
    });

    it('frees the slot of a call that was refused after it queued', async () => {
      await setup();
      for (let round = 0; round < 3; round += 1) {
        const held = await Promise.all([1, 2].map(() => gate.acquire(f.connectionId, identity(), live())));
        const mcp = new AbortController();
        const waiting = gate.acquire(f.connectionId, identity(), mcp.signal);
        mcp.abort();
        expect(await refusal(waiting)).toBe('CANCELLED');
        for (const l of held) l.release();
      }
      const again = await Promise.all([1, 2].map(() => gate.acquire(f.connectionId, identity(), live())));
      expect(again).toHaveLength(2);
      // Both slots are free, so a third call queues instead of being refused BUSY by leaked slots.
      const third = gate.acquire(f.connectionId, identity(), live());
      for (const l of again) l.release();
      const last = await third;
      expect(last).toBeDefined();
      last.release();
    });
  });
});

describe('revocation mid-query, through the socket', () => {
  let f: ReadFixture;

  afterEach(async () => {
    f?.m.hold.release();
    await f?.cleanup();
  });

  type Event = [label: string, fire: (fx: ReadFixture) => Promise<void> | void, closesSession: boolean];
  const events: Event[] = [
    ['Shared with Agents turned off', (fx) => fx.h.svc.setShared(fx.connectionId, false), false],
    ['the Connection closes', (fx) => fx.m.pool.disconnect(fx.connectionId), false],
    [
      'the Connection is deleted',
      async (fx) => {
        await fx.m.pool.disconnect(fx.connectionId);
        fx.h.connRepo.deleteById(fx.connectionId);
      },
      false,
    ],
    ['the Connection drops', (fx) => void fx.m.pool.emit('status', { id: fx.connectionId, status: 'disconnected' }), false],
    ['Agent Access turned off', (fx) => fx.h.appState.set(AGENT_ACCESS_KEY, false), true],
    ['the token is revoked', (fx) => fx.h.svc.revokeToken(fx.tokenId), true],
    ['the token is regenerated', (fx) => void fx.h.svc.regenerateToken(fx.tokenId), true],
    ['the app quits', (fx) => fx.h.svc.stop(), true],
  ];

  async function startFind(mode: 'before' | 'after') {
    f = await createReadFixture();
    await f.db.collection('orders').insertMany(Array.from({ length: 10 }, (_, i) => ({ _id: i + 1, label: `order-${i + 1}`, secret: 'LEAK-CANARY' })) as never);
    f.m.hold.arm(mode);
    const pending = f.call('find', { ...f.on('orders'), limit: 5 }).then(
      (reply) => ({ reply, error: null as Error | null }),
      (error: Error) => ({ reply: null, error }),
    );
    await f.m.hold.waitEntered(1);
    // Boxed: returning the promise itself from an async function would wait for the call.
    return { pending };
  }

  describe.each(['after', 'before'] as const)('with the result held %s the driver answers', (mode) => {
    it.each(events)('%s cancels the call and no data leaves the app', async (_label, fire, closesSession) => {
      const { pending } = await startFind(mode);
      await fire(f);
      f.m.hold.release();
      const outcome = await pending;

      if (outcome.reply) {
        expect(outcome.reply.isError).toBe(true);
        expect(textOf(outcome.reply)).toMatch(/^CANCELLED: /);
        expect(JSON.stringify(outcome.reply)).not.toContain('LEAK-CANARY');
        expect(JSON.stringify(outcome.reply)).not.toContain('order-');
      } else {
        // The session was closed under the call: only an event that ends sessions may do that.
        expect(closesSession).toBe(true);
      }
      await vi.waitFor(() => expect(f.rows()).toHaveLength(1));
      expect(f.rows()[0]).toMatchObject({ tool: 'find', outcome: 'CANCELLED', doc_count: 0, truncated: 0 });
    });
  });

  it('cancels the call when the Connection\'s identity changes, with no status change to say so', async () => {
    const { pending } = await startFind('after');
    f.m.pool.emit('connection-identity-changed', f.connectionId);
    f.m.hold.release();
    expect(textOf((await pending).reply!)).toMatch(/^CANCELLED: /);
    await vi.waitFor(() => expect(f.m.agentClients).toEqual({ opened: 1, closed: 1 }));
  });

  it('serialises nothing once a gate has closed: the held document is discarded before it is encoded', async () => {
    const encode = vi.spyOn(ejsonModule, 'ejsonStringifyRelaxed');
    const { pending } = await startFind('after');
    f.h.svc.setShared(f.connectionId, false);
    f.m.hold.release();
    expect(textOf((await pending).reply!)).toMatch(/^CANCELLED: /);
    expect(encode).not.toHaveBeenCalled();
    encode.mockRestore();
  });

  it('reports any driver failure after a revocation as CANCELLED, and the same failure without one as DB_ERROR', async () => {
    const first = await startFind('before');
    f.m.hold.failWith = new Error('Topology is closed LEAK-CANARY');
    f.h.svc.setShared(f.connectionId, false);
    f.m.hold.release();
    expect(textOf((await first.pending).reply!)).toMatch(/^CANCELLED: /);
    await f.cleanup();

    const second = await startFind('before');
    f.m.hold.failWith = new Error('Topology is closed LEAK-CANARY');
    f.m.hold.release();
    const reply = (await second.pending).reply!;
    expect(textOf(reply)).toMatch(/^DB_ERROR: /);
    expect(textOf(reply)).not.toContain('LEAK-CANARY');
  });

  it('answers the next call after an unshare with NOT_SHARED, and closes the agent client', async () => {
    const { pending } = await startFind('after');
    f.h.svc.setShared(f.connectionId, false);
    f.m.hold.release();
    expect(textOf((await pending).reply!)).toMatch(/^CANCELLED: /);
    expect(textOf(await f.call('find', f.on('orders')))).toMatch(/^NOT_SHARED: /);
    await vi.waitFor(() => expect(f.m.agentClients).toEqual({ opened: 1, closed: 1 }));
  });

  it('closes the agent client when the Connection closes, and the next call says NOT_OPEN', async () => {
    const { pending } = await startFind('after');
    await f.m.pool.disconnect(f.connectionId);
    f.m.hold.release();
    expect(textOf((await pending).reply!)).toMatch(/^CANCELLED: /);
    expect(textOf(await f.call('find', f.on('orders')))).toMatch(/^NOT_OPEN: /);
    await vi.waitFor(() => expect(f.m.agentClients).toEqual({ opened: 1, closed: 1 }));
  });

  it('closes the agent client when Agent Access turns off', async () => {
    const { pending } = await startFind('after');
    f.h.appState.set(AGENT_ACCESS_KEY, false);
    f.m.hold.release();
    await pending;
    await vi.waitFor(() => expect(f.m.agentClients).toEqual({ opened: 1, closed: 1 }));
  });

  it('closes the agent client at quit, before anything else in the teardown finishes', async () => {
    const { pending } = await startFind('after');
    await f.h.svc.stop();
    expect(f.m.agentClients).toEqual({ opened: 1, closed: 1 });
    f.m.hold.release();
    await pending;
  });

  it('aborts only the request a client cancels with notifications/cancelled', async () => {
    f = await createReadFixture();
    await f.db.collection('orders').insertMany(Array.from({ length: 10 }, (_, i) => ({ _id: i + 1, label: `order-${i + 1}` })) as never);
    f.m.hold.arm('after');
    const cancel = new AbortController();
    const cancelled = f.agent.client
      .callTool({ name: 'find', arguments: { ...f.on('orders'), filter: { _id: 1 } } }, { signal: cancel.signal })
      .then(() => 'answered', () => 'cancelled');
    const kept = f.call('find', { ...f.on('orders'), filter: { _id: 2 } });
    await f.m.hold.waitEntered(2);
    cancel.abort();
    expect(await cancelled).toBe('cancelled');
    // Messages on one socket are handled in order, so once this answer is back the server has read the cancellation.
    await f.agent.client.listTools();
    f.m.hold.release();
    const reply = await kept;
    expect(reply.isError).toBeUndefined();
    expect(textOf(reply)).toContain('order-2');
    await vi.waitFor(() => expect(f.rows()).toHaveLength(2));
    expect(f.rows().map((r) => r.outcome).sort((a, b) => a.localeCompare(b))).toEqual(['CANCELLED', 'ok']);
  });

  it('refuses the 7th concurrent call with BUSY, and the six that were admitted all finish', async () => {
    f = await createReadFixture();
    await f.db.collection('orders').insertMany(Array.from({ length: 3 }, (_, i) => ({ _id: i + 1 })) as never);
    f.m.hold.arm('after');
    const six = Array.from({ length: 6 }, () => f.call('find', f.on('orders')));
    await f.m.hold.waitEntered(2);
    const seventh = await f.call('find', f.on('orders'));
    expect(textOf(seventh)).toMatch(/^BUSY: /);
    expect(seventh.isError).toBe(true);
    expect(f.m.agentClients.opened).toBe(1);
    f.m.hold.release();
    const replies = await Promise.all(six);
    expect(replies.every((r) => r.isError === undefined)).toBe(true);
    expect(f.rows().map((r) => r.outcome).filter((o) => o === 'BUSY')).toHaveLength(1);
    expect(f.rows().filter((r) => r.outcome === 'ok')).toHaveLength(6);
  });
});
