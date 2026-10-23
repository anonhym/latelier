import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { MongoPool } from '../../electron/mongo/MongoPool';
import { MonitorService, opidForKill } from '../../electron/mongo/MonitorService';
import { SecretsVault } from '../../electron/secrets/SecretsVault';
import { createSafeStorageMock } from '../helpers/safeStorageMock';
import { createTempDb, type TempDb } from '../helpers/db';
import { uriToHostPort, makeConnection, makeReader } from '../helpers/mongo';
import type { CurrentOpSummary } from '@shared/types';

const DB = 'monitor_test';

// The profiler's slowms is server-wide, so this file runs its own mongod
// instead of the shared one (see tests/helpers/mongo.ts).
describe('MonitorService', () => {
  let server: MongoMemoryServer;
  let hp: { host: string; port: number };
  let tmp: TempDb;
  let pool: MongoPool;
  let svc: MonitorService;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    hp = uriToHostPort(server.getUri());
  });

  afterAll(async () => {
    await server.stop();
  });

  afterEach(async () => {
    await pool?.disconnectAll();
    tmp?.cleanup();
  });

  function setup(readOnly = false): void {
    tmp = createTempDb();
    const vault = new SecretsVault(tmp.db, createSafeStorageMock());
    pool = new MongoPool({
      repo: makeReader([
        makeConnection('rw', hp, { defaultDb: DB }),
        makeConnection('ro', hp, { defaultDb: DB, readOnly }),
      ]),
      vault,
    });
    svc = new MonitorService(pool);
  }

  it('currentOp lists its own aggregate, active or not, and minSecsRunning filters it out', async () => {
    setup();
    await pool.connect('rw');
    const own = (ops: CurrentOpSummary[]) => ops.filter((o) => o.ns === 'admin.$cmd.aggregate');

    const all = await svc.currentOp({ connectionId: 'rw' });
    expect(Array.isArray(all.ops)).toBe(true);
    expect(own(all.ops)).toHaveLength(1);
    const row = own(all.ops)[0]!;
    expect(row.opid).toMatch(/^\d+$/);
    expect(row.op).toBe('command');
    // The op's own command is shown as canonical EJSON.
    expect(JSON.parse(row.command)).toMatchObject({ aggregate: { $numberInt: '1' } });

    // Its own aggregate is active while it runs, so activeOnly keeps it.
    const active = await svc.currentOp({ connectionId: 'rw', activeOnly: true });
    expect(own(active.ops)).toHaveLength(1);

    const slow = await svc.currentOp({ connectionId: 'rw', minSecsRunning: 3600 });
    expect(own(slow.ops)).toHaveLength(0);
  });

  it('killOp of an opid that does not exist resolves: the server answers ok', async () => {
    setup();
    await pool.connect('rw');
    await expect(svc.killOp({ connectionId: 'rw', opid: '987654321' })).resolves.toEqual({ ok: true });
  });

  it('killOp stops a running operation', async () => {
    setup();
    await pool.connect('rw');
    const outside = new MongoClient(server.getUri());
    await outside.connect();
    try {
      await outside.db(DB).collection('sleepy').insertOne({ a: 1 });
      const running = outside
        .db(DB)
        .collection('sleepy')
        .find({ $where: 'sleep(20000) || true' })
        .toArray();
      let target: string | undefined;
      for (let i = 0; i < 50 && !target; i++) {
        const { ops } = await svc.currentOp({ connectionId: 'rw', activeOnly: true });
        target = ops.find((o) => o.ns === `${DB}.sleepy`)?.opid;
        if (!target) await new Promise((r) => setTimeout(r, 100));
      }
      expect(target).toBeDefined();
      await svc.killOp({ connectionId: 'rw', opid: target! });
      await expect(running).rejects.toMatchObject({ codeName: 'Interrupted' });
    } finally {
      await outside.close();
    }
  });

  it('a read-only connection refuses killOp and setProfileLevel but still reads', async () => {
    setup(true);
    await pool.connect('ro');
    await expect(svc.killOp({ connectionId: 'ro', opid: '1' })).rejects.toMatchObject({
      code: 'READ_ONLY',
    });
    await expect(
      svc.setProfileLevel({ connectionId: 'ro', dbName: DB, level: 2 }),
    ).rejects.toMatchObject({ code: 'READ_ONLY' });
    await expect(svc.profileStatus({ connectionId: 'ro', dbName: DB })).resolves.toMatchObject({
      level: 0,
    });
  });

  it('profileStatus, setProfileLevel(1, slowms 0), a find, then profileTail lists it', async () => {
    setup();
    await pool.connect('rw');
    try {
      expect(await svc.profileStatus({ connectionId: 'rw', dbName: DB })).toEqual({
        level: 0,
        slowms: 100,
      });
      await svc.setProfileLevel({ connectionId: 'rw', dbName: DB, level: 1, slowms: 0 });
      expect(await svc.profileStatus({ connectionId: 'rw', dbName: DB })).toEqual({
        level: 1,
        slowms: 0,
      });

      const outside = new MongoClient(server.getUri());
      await outside.connect();
      try {
        await outside.db(DB).collection('profiled').find({ marker: 'monitor-spec' }).toArray();
      } finally {
        await outside.close();
      }

      const { docs } = await svc.profileTail({ connectionId: 'rw', dbName: DB, limit: 10 });
      const hit = (docs as Array<Record<string, unknown>>).find(
        (d) => d.ns === `${DB}.profiled` && d.op === 'query',
      );
      expect(hit).toBeDefined();
      // Canonical EJSON on the wire: a date and an int arrive as sentinels.
      expect(hit!.ts).toHaveProperty('$date');
      expect(hit!.millis).toHaveProperty('$numberInt');
    } finally {
      await svc.setProfileLevel({ connectionId: 'rw', dbName: DB, level: 0, slowms: 100 });
    }
  });
});

describe('opidForKill', () => {
  it('sends a numeric opid as a number and a sharded one as the string', () => {
    expect(opidForKill('12345')).toBe(12345);
    expect(opidForKill('-7')).toBe(-7);
    expect(opidForKill('shard01:12345')).toBe('shard01:12345');
    expect(opidForKill('12a')).toBe('12a');
  });
});
