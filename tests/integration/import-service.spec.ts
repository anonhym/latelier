import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Collection, Decimal128, MongoClient, MongoNetworkError, ObjectId } from 'mongodb';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoPool } from '../../electron/mongo/MongoPool';
import { ImportService } from '../../electron/mongo/ImportService';
import type { SecretsVault } from '../../electron/secrets/SecretsVault';
import { getSharedServer, makeConnection, makeReader, uriToHostPort } from '../helpers/mongo';

describe('ImportService.importFile', () => {
  let server: MongoMemoryServer;
  let client: MongoClient;
  let pool: MongoPool;
  let svc: ImportService;
  let dir: string;
  let dbName: string;
  const coll = 'people';

  beforeAll(async () => {
    server = await getSharedServer();
    const hp = uriToHostPort(server.getUri());
    client = await MongoClient.connect(server.getUri());
    pool = new MongoPool({
      repo: makeReader([makeConnection('c1', hp), makeConnection('c-ro', hp, { readOnly: true })]),
      vault: { get: () => null } as unknown as SecretsVault,
    });
  }, 60_000);

  afterAll(async () => {
    await pool.disconnectAll();
    await client.close();
  });

  beforeEach(async () => {
    svc = new ImportService(pool);
    dbName = `import_${randomUUID().slice(0, 8)}`;
    await client.db(dbName).createCollection(coll);
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'latelier-import-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await client.db(dbName).dropDatabase();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function file(name: string, content: string): Promise<string> {
    const p = path.join(dir, name);
    await fs.writeFile(p, content, 'utf8');
    return p;
  }

  const run = (p: string, over: Record<string, string> = {}) =>
    svc.importFile({ connectionId: 'c1', dbName, collection: coll, path: p, ...over });

  const stored = () => client.db(dbName).collection(coll).find({}, { sort: { _id: 1 } }).toArray();

  it('imports a JSON array, reviving canonical and relaxed EJSON', async () => {
    const oid = new ObjectId();
    const p = await file('people.json', JSON.stringify([
      { _id: { $oid: oid.toHexString() }, n: { $numberDecimal: '1.5' } },
      { _id: 'b', at: { $date: '2024-01-02T03:04:05Z' }, age: 7 },
    ]));
    const report = await run(p);
    expect(report).toEqual({ fileName: 'people.json', format: 'json', inserted: 2, failed: 0, errors: [], errorsTruncated: false });
    const docs = await client.db(dbName).collection(coll).find().toArray();
    const byId = new Map(docs.map((d) => [String(d._id), d]));
    expect(byId.get(oid.toHexString())!.n).toEqual(Decimal128.fromString('1.5'));
    expect(byId.get('b')!.at).toEqual(new Date('2024-01-02T03:04:05Z'));
  });

  it('imports JSONL, skipping blank lines and a leading BOM', async () => {
    const p = await file('people.jsonl', '﻿{"_id":1}\r\n\n{"_id":2}\n   \n{"_id":3}');
    const report = await run(p);
    expect(report).toMatchObject({ format: 'jsonl', inserted: 3, failed: 0 });
    expect((await stored()).map((d) => d._id)).toEqual([1, 2, 3]);
  });

  it('reads a .json file whose content is one document per line as JSONL', async () => {
    const p = await file('export.json', '﻿  \n{"_id":1}\n{"_id":2}\n');
    const report = await run(p);
    expect(report).toMatchObject({ fileName: 'export.json', format: 'jsonl', inserted: 2 });
  });

  it('treats an empty file as no documents', async () => {
    expect(await run(await file('empty.json', ''))).toMatchObject({ format: 'jsonl', inserted: 0, failed: 0 });
  });

  it('reports a malformed line by its line number, blank lines counted, and imports the rest', async () => {
    const p = await file('bad.jsonl', '{"_id":1}\n\n{"_id":2,\n[1,2]\n{"_id":3}\n');
    const report = await run(p);
    expect(report.inserted).toBe(2);
    expect(report.failed).toBe(2);
    expect(report.errors.map((e) => e.at)).toEqual([3, 4]);
    expect(report.errors[0]!.message).toMatch(/^invalid document: /);
    expect(report.errors[1]!.message).toMatch(/expected a document/);
  });

  it('reports a non-document array element by its index, not failing the file', async () => {
    const p = await file('mixed.json', '[{"_id":1}, 5, {"when":{"$date":"not a date"}}, {"_id":2}]');
    const report = await run(p);
    expect(report).toMatchObject({ inserted: 2, failed: 2 });
    expect(report.errors.map((e) => e.at)).toEqual([1, 2]);
  });

  it('refuses a JSON array that is not valid JSON', async () => {
    const p = await file('broken.json', '[{"_id":1},');
    await expect(run(p)).rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringMatching(/^invalid JSON array/) });
    expect(await stored()).toEqual([]);
  });

  it('reports a duplicate _id against its line and inserts the rest', async () => {
    await client.db(dbName).collection(coll).insertOne({ _id: 2 } as never);
    const p = await file('dup.jsonl', '{"_id":1}\n{"_id":2}\n{"_id":3}\n');
    const report = await run(p);
    expect(report).toMatchObject({ inserted: 2, failed: 1 });
    expect(report.errors).toEqual([{ at: 2, message: expect.stringMatching(/E11000/) }]);
  });

  it('maps a write error in a later batch back to its own line', async () => {
    svc = new ImportService(pool, { batchSize: 2 });
    await client.db(dbName).collection(coll).insertOne({ _id: 4 } as never);
    const p = await file('dup.jsonl', '{"_id":1}\n{"_id":2}\n{"_id":3}\n{"_id":4}\n{"_id":5}\n');
    const report = await run(p);
    expect(report).toMatchObject({ inserted: 4, failed: 1 });
    expect(report.errors.map((e) => e.at)).toEqual([4]);
  });

  it('inserts 2500 documents in batches of 1000', async () => {
    const spy = vi.spyOn(Collection.prototype, 'insertMany');
    const lines = Array.from({ length: 2500 }, (_, i) => JSON.stringify({ _id: i })).join('\n');
    const report = await run(await file('many.jsonl', lines));
    expect(report.inserted).toBe(2500);
    expect(spy.mock.calls.map((c) => (c[0] as unknown[]).length)).toEqual([1000, 1000, 500]);
    expect(spy.mock.calls.every((c) => (c[1] as { ordered?: boolean }).ordered === false)).toBe(true);
  });

  it('lists the first 50 failures and counts the rest', async () => {
    const lines = Array.from({ length: 53 }, () => 'nope').join('\n');
    const report = await run(await file('junk.jsonl', lines));
    expect(report.failed).toBe(53);
    expect(report.errors).toHaveLength(50);
    expect(report.errors[49]!.at).toBe(50);
    expect(report.errorsTruncated).toBe(true);
  });

  it('refuses a read-only connection before touching the file', async () => {
    const statSpy = vi.spyOn(fs, 'stat');
    await expect(
      svc.importFile({ connectionId: 'c-ro', dbName, collection: coll, path: path.join(dir, 'missing.json') }),
    ).rejects.toMatchObject({ code: 'READ_ONLY' });
    expect(statSpy).not.toHaveBeenCalled();
  });

  it('refuses a collection that does not exist, and a view', async () => {
    const p = await file('a.jsonl', '{"_id":1}');
    await expect(run(p, { collection: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await client.db(dbName).createCollection('v', { viewOn: coll, pipeline: [] });
    await expect(run(p, { collection: 'v' })).rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringMatching(/view/) });
    expect(await client.db(dbName).listCollections({ name: 'nope' }).toArray()).toEqual([]);
  });

  it('refuses a JSON array over the size cap, but not JSONL of the same size', async () => {
    svc = new ImportService(pool, { maxArrayBytes: 20 });
    const array = await file('big.json', '[{"_id":1},{"_id":2},{"_id":3}]');
    await expect(run(array)).rejects.toMatchObject({ code: 'VALIDATION', details: { maxBytes: 20 } });
    const lines = await file('big-lines.json', '{"_id":1}\n{"_id":2}\n{"_id":3}\n');
    expect((await run(lines)).inserted).toBe(3);
  });

  it('refuses a relative path, an extension outside the allow-list, and a directory', async () => {
    await expect(run('people.json')).rejects.toMatchObject({ code: 'VALIDATION', details: { field: 'path' } });
    await expect(run(await file('people.csv', 'a\n1'))).rejects.toMatchObject({ code: 'VALIDATION', details: { field: 'path' } });
    await fs.mkdir(path.join(dir, 'folder.json'));
    await expect(run(path.join(dir, 'folder.json'))).rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringMatching(/not a file/) });
  });

  it('reports a file that does not exist as INTERNAL, not a Mongo error', async () => {
    await expect(run(path.join(dir, 'gone.jsonl'))).rejects.toMatchObject({
      code: 'INTERNAL',
      message: expect.stringMatching(/failed to open import file: .*ENOENT/),
    });
  });

  it.skipIf(process.getuid?.() === 0)('reports a file it may not read as INTERNAL, for either format', async () => {
    const lines = await file('locked.jsonl', '{"_id":1}\n');
    const array = await file('locked.json', '[{"_id":1}]');
    await fs.chmod(lines, 0o000);
    await fs.chmod(array, 0o000);
    await expect(run(lines)).rejects.toMatchObject({
      code: 'INTERNAL',
      message: expect.stringMatching(/failed to read import file: .*EACCES/),
      details: { insertedCount: 0 },
    });
    await expect(run(array)).rejects.toMatchObject({ code: 'INTERNAL', message: expect.stringMatching(/EACCES/) });
  });

  it('a failure after earlier batches landed carries insertedCount', async () => {
    svc = new ImportService(pool, { batchSize: 2 });
    const real = Collection.prototype.insertMany;
    let calls = 0;
    vi.spyOn(Collection.prototype, 'insertMany').mockImplementation(function (this: Collection, ...args) {
      calls++;
      if (calls === 2) return Promise.reject(new MongoNetworkError('connection reset'));
      return real.apply(this, args as Parameters<typeof real>);
    });
    const p = await file('net.jsonl', '{"_id":1}\n{"_id":2}\n{"_id":3}\n{"_id":4}\n');
    await expect(run(p)).rejects.toMatchObject({ code: 'NETWORK', message: expect.stringMatching(/connection reset/), details: { insertedCount: 2 } });
  });
});
