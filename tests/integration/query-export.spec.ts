import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import type { IpcMainInvokeEvent } from 'electron';
import { MongoPool } from '../../electron/mongo/MongoPool';
import { QueryService } from '../../electron/mongo/QueryService';
import { RecentQueryService } from '../../electron/services/RecentQueryService';
import { RecentQueryRepo } from '../../electron/db/repositories/RecentQueryRepo';
import { registerQueryChannels } from '../../electron/ipc/handlers/query';
import { createRouter } from '../../electron/ipc/router';
import type { Envelope } from '../../shared/ipc';
import { createTempDb, type TempDb } from '../helpers/db';
import { getSharedServer, makeConnection, makeReader } from '../helpers/mongo';
import { invokeEvent, testSenderCheck } from '../helpers/ipcSender';
import { serializeJsonArray, serializeJsonl, serializeCsv, type ExportColumn } from '../../src/pages/Workspace/exportFormat';

describe('QueryService.exportToFile', () => {
  let server: MongoMemoryServer;
  let pool: MongoPool;
  let svc: QueryService;
  let tmp: TempDb;
  let outDir: string;
  const connId = 'test-conn';
  const dbName = 'testdb';
  const collName = 'items';

  beforeAll(async () => {
    server = await getSharedServer();
    const uri = server.getUri();
    const hp = { host: new URL(uri).hostname, port: Number(new URL(uri).port) };
    const conn = makeConnection(connId, hp, { defaultDb: dbName });
    pool = new MongoPool({
      repo: makeReader([conn]),
      vault: { get: () => null } as unknown as import('../../electron/secrets/SecretsVault').SecretsVault,
    });

    tmp = createTempDb();
    const recentRepo = new RecentQueryRepo(tmp.db);
    const recentSvc = new RecentQueryService(recentRepo);
    // A 5-document cap so the "cap hit" case doesn't need to seed 100k rows.
    svc = new QueryService(pool, recentSvc, 5);
  });

  afterAll(async () => {
    await pool.disconnectAll();
    tmp.cleanup();
  });

  beforeEach(async () => {
    const client = await pool.write(connId).client();
    const coll = client.db(dbName).collection(collName);
    await coll.deleteMany({});
    outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'latelier-export-'));
  });

  afterEach(async () => {
    await fs.rm(outDir, { recursive: true, force: true });
  });

  const outPath = (name: string) => path.join(outDir, name);
  const columns: ExportColumn[] = [
    { header: '_id', path: '_id' },
    { header: 'n', path: 'n' },
    { header: 'tag', path: 'tag' },
  ];

  async function seed(n: number) {
    const client = await pool.write(connId).client();
    const coll = client.db(dbName).collection(collName);
    await coll.insertMany(Array.from({ length: n }, (_, i) => ({ n: i, tag: `t${i}` })));
  }

  it('exports every matching document as a JSON array, byte-identical to the page serializer', async () => {
    await seed(3);
    const file = outPath('out.json');
    const result = await svc.exportToFile(
      { connectionId: connId, dbName, collection: collName, filter: '{}', format: 'json' },
      file,
    );
    expect(result).toEqual({ path: file, written: 3, truncated: false });

    const written = await fs.readFile(file, 'utf8');
    // Same shape `find` itself returns: canonical-EJSON-encoded documents.
    const client = await pool.write(connId).client();
    const docs = await client.db(dbName).collection(collName).find({}).sort({ n: 1 }).toArray();
    const { EJSON } = await import('bson');
    const wireDocs = docs.map((d) => EJSON.serialize(d, { relaxed: false }));
    expect(written).toBe(serializeJsonArray(wireDocs, false));
  });

  it('exports JSONL, one document per line, byte-identical to the page serializer', async () => {
    await seed(3);
    const file = outPath('out.jsonl');
    const result = await svc.exportToFile(
      { connectionId: connId, dbName, collection: collName, filter: '{}', format: 'jsonl' },
      file,
    );
    expect(result.written).toBe(3);

    const written = await fs.readFile(file, 'utf8');
    const client = await pool.write(connId).client();
    const docs = await client.db(dbName).collection(collName).find({}).sort({ n: 1 }).toArray();
    const { EJSON } = await import('bson');
    const wireDocs = docs.map((d) => EJSON.serialize(d, { relaxed: false }));
    expect(written).toBe(serializeJsonl(wireDocs, false));
  });

  it('exports CSV using the given columns, byte-identical to the page serializer', async () => {
    await seed(2);
    const file = outPath('out.csv');
    await svc.exportToFile(
      { connectionId: connId, dbName, collection: collName, filter: '{}', format: 'csv', columns },
      file,
    );

    const written = await fs.readFile(file, 'utf8');
    const client = await pool.write(connId).client();
    const docs = await client.db(dbName).collection(collName).find({}).sort({ n: 1 }).toArray();
    const { EJSON } = await import('bson');
    const wireDocs = docs.map((d) => EJSON.serialize(d, { relaxed: false }));
    expect(written).toBe(serializeCsv(wireDocs, columns));
  });

  it('relaxed JSON output matches the page serializer\'s relaxed output', async () => {
    await seed(2);
    const file = outPath('out.json');
    await svc.exportToFile(
      { connectionId: connId, dbName, collection: collName, filter: '{}', format: 'json', relaxed: true },
      file,
    );

    const written = await fs.readFile(file, 'utf8');
    const client = await pool.write(connId).client();
    const docs = await client.db(dbName).collection(collName).find({}).sort({ n: 1 }).toArray();
    const { EJSON } = await import('bson');
    const wireDocs = docs.map((d) => EJSON.serialize(d, { relaxed: false }));
    expect(written).toBe(serializeJsonArray(wireDocs, true));
  });

  it('honours filter, sort and projection', async () => {
    await seed(5);
    const file = outPath('out.jsonl');
    const result = await svc.exportToFile(
      {
        connectionId: connId,
        dbName,
        collection: collName,
        filter: '{"n":{"$gte":2}}',
        sort: '{"n":-1}',
        projection: '{"n":1,"_id":0}',
        format: 'jsonl',
      },
      file,
    );
    expect(result.written).toBe(3);
    const lines = (await fs.readFile(file, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    // Canonical EJSON: an int32 is wrapped as `{"$numberInt": "..."}`.
    expect(lines).toEqual([
      { n: { $numberInt: '4' } },
      { n: { $numberInt: '3' } },
      { n: { $numberInt: '2' } },
    ]);
  });

  it('a builder limit under the cap is honoured and never marked truncated', async () => {
    await seed(10); // service cap is 5
    const file = outPath('out.jsonl');
    const result = await svc.exportToFile(
      { connectionId: connId, dbName, collection: collName, filter: '{}', format: 'jsonl', limit: 3 },
      file,
    );
    expect(result).toEqual({ path: file, written: 3, truncated: false });
  });

  it('a builder limit above the cap is clamped to the cap', async () => {
    await seed(10); // service cap is 5
    const file = outPath('out.jsonl');
    const result = await svc.exportToFile(
      { connectionId: connId, dbName, collection: collName, filter: '{}', format: 'jsonl', limit: 9000 },
      file,
    );
    expect(result).toEqual({ path: file, written: 5, truncated: false });
  });

  it('hitting the cap with no builder limit reports truncated=true and written===cap', async () => {
    await seed(10); // service cap is 5
    const file = outPath('out.jsonl');
    const result = await svc.exportToFile(
      { connectionId: connId, dbName, collection: collName, filter: '{}', format: 'jsonl' },
      file,
    );
    expect(result).toEqual({ path: file, written: 5, truncated: true });
    const lines = (await fs.readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(5);
  });

  it('removes the partial file when the cursor errors mid-stream', async () => {
    await seed(3);
    const client = await pool.write(connId).client();
    // A document whose `tag` can't convert to a number — the projection
    // errors once the cursor reaches it, after the file has been opened and
    // at least one earlier document may already have been written.
    await client.db(dbName).collection(collName).insertOne({ n: -1, tag: 'not-a-number' });
    const file = outPath('out.jsonl');

    await expect(
      svc.exportToFile(
        {
          connectionId: connId,
          dbName,
          collection: collName,
          filter: '{}',
          sort: '{"n":1}',
          projection: '{"r":{"$toInt":"$tag"}}',
          format: 'jsonl',
        },
        file,
      ),
    ).rejects.toThrow();

    await expect(fs.access(file)).rejects.toThrow();
  });
});

describe('query:export handler — save-panel cancel', () => {
  it('returns {path: null} without touching the export service when the dialog is cancelled', async () => {
    type Handler = (evt: IpcMainInvokeEvent, payload: unknown) => Promise<Envelope<unknown>>;
    const handlers = new Map<string, Handler>();
    const router = createRouter(
      { handle: (channel: string, fn: Handler) => handlers.set(channel, fn) } as never,
      testSenderCheck,
    );
    const exportToFile = vi.fn();
    registerQueryChannels(
      router,
      { exportToFile } as unknown as QueryService,
      async () => null, // simulates the user cancelling the save panel
    );

    const handler = handlers.get('query:export')!;
    const envelope = (await handler(invokeEvent, {
      connectionId: 'c',
      dbName: 'd',
      collection: 'coll',
      filter: '{}',
      format: 'json',
    })) as Envelope<{ path: string | null; written: number; truncated: boolean }>;

    expect(envelope).toEqual({ ok: true, data: { path: null, written: 0, truncated: false } });
    expect(exportToFile).not.toHaveBeenCalled();
  });
});
