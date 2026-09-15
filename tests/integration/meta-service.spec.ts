import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Collection, Db, MongoClient } from 'mongodb';
import { MongoPool } from '../../electron/mongo/MongoPool';
import { MetaService } from '../../electron/mongo/MetaService';
import { QUERY_TIMEOUT_MS } from '../../electron/mongo/timeouts';
import { SecretsVault } from '../../electron/secrets/SecretsVault';
import { createSafeStorageMock } from '../helpers/safeStorageMock';
import { createTempDb, type TempDb } from '../helpers/db';
import { ConnectionRepo } from '../../electron/db/repositories/ConnectionRepo';
import {
  ConnectionService,
  connectionReader,
} from '../../electron/mongo/ConnectionService';
import type { ConnectionInput } from '@shared/types';
import { getSharedServer, stopSharedServer, uriToHostPort } from '../helpers/mongo';

async function seedData(uri: string) {
  const c = new MongoClient(uri);
  try {
    await c.connect();
    await c
      .db('shopdb')
      .collection('products')
      .insertMany([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
    await c.db('shopdb').collection('orders').insertOne({ ts: new Date() });
    await c.db('analytics').collection('events').insertOne({ name: 'click' });
  } finally {
    await c.close();
  }
}

/**
 * Regression test for P1-3: meta channel logic moved from
 * `electron/ipc/handlers/meta.ts` into `electron/mongo/MetaService.ts`. The
 * handler is now a thin validate-and-delegate; verify the service's three
 * methods behave correctly end-to-end.
 */
describe('MetaService', () => {
  let server: MongoMemoryServer;
  let hp: { host: string; port: number };
  let tmp: TempDb;
  let pool: MongoPool;
  let svc: MetaService;
  let connId: string;

  beforeAll(async () => {
    server = await getSharedServer();
    hp = uriToHostPort(server.getUri());
    await seedData(server.getUri());
  }, 60_000);

  afterAll(async () => {
    await stopSharedServer();
  });

  afterEach(async () => {
    await pool.disconnectAll();
    tmp.cleanup();
  });

  async function setup() {
    tmp = createTempDb();
    const repo = new ConnectionRepo(tmp.db);
    const vault = new SecretsVault(tmp.db, createSafeStorageMock());
    pool = new MongoPool({ repo: connectionReader(repo, vault), vault });
    svc = new MetaService(pool);
    const connSvc = new ConnectionService({ repo, vault, pool });
    const c = await connSvc.create({
      name: 'mem',
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
    } as ConnectionInput);
    connId = c.id;
  }

  it('listDatabases excludes admin/local/config by default and includes them with includeSystem', async () => {
    await setup();
    const filtered = await svc.listDatabases({ connectionId: connId });
    expect(filtered.some((d) => d.name === 'admin')).toBe(false);
    expect(filtered.some((d) => d.name === 'shopdb')).toBe(true);

    const all = await svc.listDatabases({ connectionId: connId, includeSystem: true });
    expect(all.some((d) => d.name === 'admin')).toBe(true);
  });

  // listDatabases used to send no maxTimeMS at all. The bound goes on the
  // command document (db.command's options argument only carries CSOT's
  // timeoutMS), matching the pattern UserService established.
  it('listDatabases sends maxTimeMS on the command document', async () => {
    await setup();
    // Warm the connection first — connect()'s own buildInfo probe also goes
    // through Db.prototype.command and would otherwise show up in the spy
    // with no maxTimeMS, which isn't this service's concern.
    await svc.listDatabases({ connectionId: connId });

    const commandSpy = vi.spyOn(Db.prototype, 'command');
    await svc.listDatabases({ connectionId: connId });
    expect(commandSpy.mock.calls.length).toBeGreaterThan(0);
    const cmd = commandSpy.mock.calls[0]![0] as { maxTimeMS?: number };
    // The interactive budget: nameOnly:false totals storage per database, so
    // the cost scales with the deployment rather than being a fixed-cost read.
    expect(cmd.maxTimeMS).toBe(QUERY_TIMEOUT_MS);
    commandSpy.mockRestore();
  });

  it('listCollections returns per-collection storage stats', async () => {
    await setup();
    const cols = await svc.listCollections({ connectionId: connId, dbName: 'shopdb' });
    const products = cols.find((c) => c.name === 'products');
    expect(products).toBeDefined();
    expect(products!.documentCount).toBe(3);
    expect(products!.type).toBe('collection');
    expect(products!.indexCount).toBeGreaterThanOrEqual(1); // _id index
  });

  // `$collStats` is unavailable to a restricted user (Atlas free tier, or any
  // role without `collStats`), where it fails rather than returning empty.
  // MetaService falls back to estimatedDocumentCount + indexes(). Nothing
  // covered that branch, though `specs/PLAN-connections.md` claimed it did —
  // the deleted `meta-handlers.spec.ts` asserted `$collStats` through the raw
  // driver and never reached MetaService at all.
  it('listCollections falls back to cheap estimates when $collStats is unauthorized', async () => {
    await setup();
    const aggregate = vi
      .spyOn(Collection.prototype, 'aggregate')
      .mockImplementation((() => ({
        next: async () => {
          throw new Error('not authorized on shopdb to execute command $collStats');
        },
      })) as never);

    try {
      const cols = await svc.listCollections({ connectionId: connId, dbName: 'shopdb' });
      const products = cols.find((c) => c.name === 'products');
      expect(products).toBeDefined();
      // The point of the fallback is real numbers, not a silent zero.
      expect(products!.documentCount).toBe(3);
      expect(products!.indexCount).toBeGreaterThanOrEqual(1);
      expect(aggregate).toHaveBeenCalled();
    } finally {
      aggregate.mockRestore();
    }
  });

  it('sampleSchema returns merged recent + random documents', async () => {
    await setup();
    const { docs } = await svc.sampleSchema({
      connectionId: connId,
      dbName: 'shopdb',
      collection: 'products',
      size: 10,
    });
    // 3 source docs, 2 facet branches → up to 6 results (with duplicates).
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.length).toBeLessThanOrEqual(6);
  });

  // A dedicated server, not the shared one: `failCommand` needs
  // `enableTestCommands`, which nothing else in this suite wants turned on.
  // The failpoint makes the *real* mongod return a genuine
  // MaxTimeMSExpired — the same driver error shape a slow deployment would
  // produce — so this exercises the retry over the actual wire rather than
  // asserting against a mocked rejection.
  describe('listDatabases degrades on a real MaxTimeMSExpired', () => {
    let ftServer: MongoMemoryServer;
    let ftPool: MongoPool;
    let ftSvc: MetaService;
    let ftTmp: TempDb;
    let ftConnId: string;

    beforeAll(async () => {
      ftServer = await MongoMemoryServer.create({
        instance: { args: ['--setParameter', 'enableTestCommands=1'] },
      });
      const hp = uriToHostPort(ftServer.getUri());
      const seedClient = new MongoClient(ftServer.getUri());
      await seedClient.connect();
      await seedClient.db('shopdb').collection('products').insertOne({ name: 'a' });
      await seedClient.close();

      ftTmp = createTempDb();
      const repo = new ConnectionRepo(ftTmp.db);
      const vault = new SecretsVault(ftTmp.db, createSafeStorageMock());
      ftPool = new MongoPool({ repo: connectionReader(repo, vault), vault });
      ftSvc = new MetaService(ftPool);
      const connSvc = new ConnectionService({ repo, vault, pool: ftPool });
      const c = await connSvc.create({
        name: 'failpoint-target',
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
      } as ConnectionInput);
      ftConnId = c.id;
    }, 60_000);

    afterAll(async () => {
      await ftPool.disconnectAll();
      ftTmp.cleanup();
      await ftServer.stop();
    });

    it('retries with nameOnly and still returns database names', async () => {
      const client = await ftPool.readClient(ftConnId);
      await client.db('admin').command({
        configureFailPoint: 'failCommand',
        mode: { times: 1 },
        data: { failCommands: ['listDatabases'], errorCode: 50 },
      });

      const dbs = await ftSvc.listDatabases({ connectionId: ftConnId });

      expect(dbs.some((d) => d.name === 'shopdb')).toBe(true);
      // Sizes come back absent rather than 0, so the panel that prints this
      // figure can say "not measured" instead of "measured, and empty".
      const row = dbs.find((d) => d.name === 'shopdb')!;
      expect(row.sizeOnDisk).toBeUndefined();
      expect('sizeOnDisk' in row).toBe(false);
    });

    it('reports a real size on the normal path, so the absence above means something', async () => {
      const dbs = await ftSvc.listDatabases({ connectionId: ftConnId });
      expect(dbs.find((d) => d.name === 'shopdb')?.sizeOnDisk).toBeGreaterThan(0);
    });

    it('still throws TIMEOUT when the retry also expires', async () => {
      const client = await ftPool.readClient(ftConnId);
      await client.db('admin').command({
        configureFailPoint: 'failCommand',
        mode: { times: 2 },
        data: { failCommands: ['listDatabases'], errorCode: 50 },
      });

      await expect(ftSvc.listDatabases({ connectionId: ftConnId })).rejects.toMatchObject({
        code: 'TIMEOUT',
      });
    });
  });
});
