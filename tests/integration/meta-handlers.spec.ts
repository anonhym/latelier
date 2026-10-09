import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient } from 'mongodb';
import { IPC_CHANNELS } from '@shared/ipc';
import type { CollectionInfo, DbInfo } from '@shared/ipc';
import { createRouter } from '../../electron/ipc/router';
import { registerMetaChannels } from '../../electron/ipc/handlers/meta';
import { MongoPool } from '../../electron/mongo/MongoPool';
import { MetaService } from '../../electron/mongo/MetaService';
import { SecretsVault } from '../../electron/secrets/SecretsVault';
import { createSafeStorageMock } from '../helpers/safeStorageMock';
import { createTempDb, type TempDb } from '../helpers/db';
import { createIpcShim } from '../helpers/ipcShim';
import { testSenderCheck } from '../helpers/ipcSender';
import {
  getSharedServer,
  makeConnection,
  makeReader,
  stopSharedServer,
  uriToHostPort,
} from '../helpers/mongo';

/**
 * Drives `meta:*` through the real router, zod validators, `MetaService`,
 * `MongoPool` and a real mongod. The service spec skips the router and the
 * registration spec stubs the service, so neither proves that the schemas
 * accept what the renderer sends or that a failure crosses as a typed code.
 */
const DB = 'meta_router_shop';
const CONN = 'meta-conn';

describe('meta:* channels via router', () => {
  let tmp: TempDb;
  let pool: MongoPool;
  const shim = createIpcShim();

  beforeAll(async () => {
    const server = await getSharedServer();
    const seed = new MongoClient(server.getUri());
    try {
      await seed.connect();
      await seed
        .db(DB)
        .collection('products')
        .insertMany([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
      await seed.db(DB).collection('orders').insertOne({ total: 1 });
    } finally {
      await seed.close();
    }

    tmp = createTempDb();
    const vault = new SecretsVault(tmp.db, createSafeStorageMock());
    const conn = makeConnection(CONN, uriToHostPort(server.getUri()), { defaultDb: DB });
    pool = new MongoPool({ repo: makeReader([conn]), vault });
    registerMetaChannels(createRouter(shim.ipcMain, testSenderCheck), new MetaService(pool));
  }, 60_000);

  afterAll(async () => {
    await pool.disconnectAll();
    tmp.cleanup();
    await stopSharedServer();
  });

  describe('meta:listDatabases', () => {
    it('returns the seeded database and hides the system ones', async () => {
      const env = await shim.invoke<DbInfo[]>(IPC_CHANNELS.metaListDatabases, {
        connectionId: CONN,
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const names = env.data.map((d) => d.name);
      expect(names).toContain(DB);
      for (const sys of ['admin', 'local', 'config']) expect(names).not.toContain(sys);
      const shop = env.data.find((d) => d.name === DB);
      expect(shop).toMatchObject({ empty: false });
      expect(typeof shop?.sizeOnDisk).toBe('number');
    });

    it('includes the system databases with includeSystem: true', async () => {
      const env = await shim.invoke<DbInfo[]>(IPC_CHANNELS.metaListDatabases, {
        connectionId: CONN,
        includeSystem: true,
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.data.map((d) => d.name)).toContain('admin');
    });

    it.each([
      ['an empty payload', {}],
      ['an empty connectionId', { connectionId: '' }],
      ['a non-boolean includeSystem', { connectionId: CONN, includeSystem: 'yes' }],
      ['no payload at all', undefined],
    ])('rejects %s with VALIDATION', async (_what, payload) => {
      const env = await shim.invoke(IPC_CHANNELS.metaListDatabases, payload);
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('VALIDATION');
    });

    it('answers NOT_FOUND for an unknown connection', async () => {
      const env = await shim.invoke(IPC_CHANNELS.metaListDatabases, {
        connectionId: 'no-such-conn',
      });
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('NOT_FOUND');
    });
  });

  describe('meta:listCollections', () => {
    it('returns CollectionInfo for each seeded collection', async () => {
      const env = await shim.invoke<CollectionInfo[]>(IPC_CHANNELS.metaListCollections, {
        connectionId: CONN,
        dbName: DB,
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.data.map((c) => c.name).sort((a, b) => a.localeCompare(b))).toEqual([
        'orders',
        'products',
      ]);
      const products = env.data.find((c) => c.name === 'products');
      expect(products).toMatchObject({
        type: 'collection',
        documentCount: 3,
        capped: false,
      });
      expect(typeof products?.sizeBytes).toBe('number');
      expect(typeof products?.indexCount).toBe('number');
    });

    it.each([
      ['a missing dbName', { connectionId: CONN }],
      ['an empty dbName', { connectionId: CONN, dbName: '' }],
      ['a missing connectionId', { dbName: DB }],
    ])('rejects %s with VALIDATION', async (_what, payload) => {
      const env = await shim.invoke(IPC_CHANNELS.metaListCollections, payload);
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('VALIDATION');
    });

    it('answers NOT_FOUND for an unknown connection', async () => {
      const env = await shim.invoke(IPC_CHANNELS.metaListCollections, {
        connectionId: 'no-such-conn',
        dbName: DB,
      });
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('NOT_FOUND');
    });
  });

  describe('meta:sampleSchema', () => {
    const target = { connectionId: CONN, dbName: DB, collection: 'products' };

    it('returns sampled documents as an array', async () => {
      const env = await shim.invoke<{ docs: unknown[] }>(
        IPC_CHANNELS.metaSampleSchema,
        target,
      );
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(Array.isArray(env.data.docs)).toBe(true);
      expect(env.data.docs.length).toBeGreaterThan(0);
      expect(env.data.docs[0]).toMatchObject({ name: expect.any(String) });
    });

    it.each([1, 200])('accepts the size bound %i', async (size) => {
      const env = await shim.invoke<{ docs: unknown[] }>(IPC_CHANNELS.metaSampleSchema, {
        ...target,
        size,
      });
      expect(env.ok).toBe(true);
    });

    it.each([0, 201, 1.5, -1])('rejects size %s with VALIDATION', async (size) => {
      const env = await shim.invoke(IPC_CHANNELS.metaSampleSchema, { ...target, size });
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('VALIDATION');
    });

    it('rejects a missing collection with VALIDATION', async () => {
      const env = await shim.invoke(IPC_CHANNELS.metaSampleSchema, {
        connectionId: CONN,
        dbName: DB,
      });
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('VALIDATION');
    });

    it('answers NOT_FOUND for an unknown connection', async () => {
      const env = await shim.invoke(IPC_CHANNELS.metaSampleSchema, {
        ...target,
        connectionId: 'no-such-conn',
      });
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('NOT_FOUND');
    });

    it('fails open to an empty sample for a collection that does not exist', async () => {
      const env = await shim.invoke<{ docs: unknown[] }>(IPC_CHANNELS.metaSampleSchema, {
        ...target,
        collection: 'never_created',
      });
      expect(env).toEqual({ ok: true, data: { docs: [] } });
    });
  });
});
