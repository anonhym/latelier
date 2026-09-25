import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { createRouter } from '../../electron/ipc/router';
import { registerDataChannels } from '../../electron/ipc/handlers/data';
import { MongoPool } from '../../electron/mongo/MongoPool';
import { ImportService } from '../../electron/mongo/ImportService';
import { AuditRepo } from '../../electron/db/repositories/AuditRepo';
import { AuditService } from '../../electron/services/AuditService';
import { SecretsVault } from '../../electron/secrets/SecretsVault';
import type { Logger } from '../../electron/log';
import { IPC_CHANNELS, type Envelope } from '../../shared/ipc';
import type { AuditEntry, ImportReport } from '../../shared/types';
import { createSafeStorageMock } from '../helpers/safeStorageMock';
import { createTempDb, type TempDb } from '../helpers/db';
import { invokeEvent, testSenderCheck } from '../helpers/ipcSender';
import { getSharedServer, uriToHostPort, makeConnection, makeReader } from '../helpers/mongo';

type Handler = (evt: IpcMainInvokeEvent, payload: unknown) => unknown;

// A value that exists only inside the imported file. If it shows up in an
// audit row, the summary has started persisting document bodies.
const BODY_MARKER = 'body-only-value-9c1e';

describe('data:import via the router', () => {
  let server: MongoMemoryServer;
  let client: MongoClient;
  let tmp: TempDb;
  let pool: MongoPool;
  let dir: string;
  let dbName: string;
  const handlers = new Map<string, Handler>();

  const invoke = async <T,>(payload: unknown): Promise<Envelope<T>> =>
    (await handlers.get(IPC_CHANNELS.dataImport)!(invokeEvent, payload)) as Envelope<T>;

  const rows = (): AuditEntry[] =>
    (tmp.db.prepare('SELECT * FROM audit_log').all() as Record<string, unknown>[]).map((r) => ({
      op: r.op,
      outcome: r.outcome,
      errorCode: r.error_code,
      collection: r.collection,
      summary: JSON.parse(r.summary_json as string),
      reversible: r.reversible === 1,
      raw: r.summary_json,
    }) as unknown as AuditEntry);

  beforeAll(async () => {
    server = await getSharedServer();
    client = await MongoClient.connect(server.getUri());
  }, 60_000);

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    tmp = createTempDb();
    const now = new Date().toISOString();
    for (const id of ['c1', 'c-ro']) {
      tmp.db.prepare(
        `INSERT INTO connections (id, name, connection_type, host, port, auth_mech, created_at, updated_at)
         VALUES (?, ?, 'standard', 'localhost', 27017, 'none', ?, ?)`,
      ).run(id, `conn-${id}`, now, now);
    }
    const hp = uriToHostPort(server.getUri());
    pool = new MongoPool({
      repo: makeReader([makeConnection('c1', hp), makeConnection('c-ro', hp, { readOnly: true })]),
      vault: new SecretsVault(tmp.db, createSafeStorageMock()),
    });
    const log: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const auditSvc = new AuditService(new AuditRepo(tmp.db), pool, log);
    handlers.clear();
    const router = createRouter(
      { handle: (channel: string, fn: Handler) => void handlers.set(channel, fn) },
      testSenderCheck,
      log,
      auditSvc,
    );
    registerDataChannels(router, new ImportService(pool));
    dbName = `data_${randomUUID().slice(0, 8)}`;
    await client.db(dbName).createCollection('people');
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'latelier-data-'));
  });

  afterEach(async () => {
    await client.db(dbName).dropDatabase();
    await pool.disconnectAll();
    await fs.rm(dir, { recursive: true, force: true });
    tmp.cleanup();
  });

  async function file(name: string, content: string): Promise<string> {
    const p = path.join(dir, name);
    await fs.writeFile(p, content, 'utf8');
    return p;
  }

  const target = () => ({ connectionId: 'c1', dbName, collection: 'people' });

  it('records one ok row per clean import, naming the file but not its directory or contents', async () => {
    const p = await file('clean.jsonl', `{"_id":1,"s":"${BODY_MARKER}"}\n{"_id":2}\n`);
    const env = await invoke<ImportReport>({ ...target(), path: p });
    expect(env).toMatchObject({ ok: true, data: { inserted: 2, failed: 0 } });
    const [row, ...rest] = rows();
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      op: 'import',
      outcome: 'ok',
      errorCode: null,
      collection: 'people',
      reversible: false,
      summary: { op: 'import', fileName: 'clean.jsonl', format: 'jsonl', insertedCount: 2, failedCount: 0 },
    });
    const raw = (row as unknown as { raw: string }).raw;
    expect(raw).not.toContain(BODY_MARKER);
    expect(raw).not.toContain(dir);
  });

  it('records an import with rejected documents as partial', async () => {
    const p = await file('dup.json', `[{"_id":1},{"_id":1,"s":"${BODY_MARKER}"}]`);
    const env = await invoke<ImportReport>({ ...target(), path: p });
    expect(env).toMatchObject({ ok: true, data: { format: 'json', inserted: 1, failed: 1 } });
    expect(rows()).toMatchObject([{
      outcome: 'partial',
      errorCode: null,
      summary: { op: 'import', fileName: 'dup.json', format: 'json', insertedCount: 1, failedCount: 1 },
    }]);
    expect((rows()[0] as unknown as { raw: string }).raw).not.toContain(BODY_MARKER);
  });

  it('records a refused import as an error that still names the file', async () => {
    const p = await file('people.jsonl', '{"_id":1}\n');
    const env = await invoke({ ...target(), connectionId: 'c-ro', path: p });
    expect(env).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
    expect(rows()).toMatchObject([{ op: 'import', outcome: 'error', errorCode: 'READ_ONLY', summary: { op: 'import', fileName: 'people.jsonl' } }]);
    expect(await client.db(dbName).collection('people').countDocuments()).toBe(0);
  });

  it('refuses a payload without a path before reaching the service', async () => {
    const env = await invoke({ ...target() });
    expect(env).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });
});
