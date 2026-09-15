import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RecentQueryRepo } from '../../electron/db/repositories/RecentQueryRepo';
import { RecentQueryService } from '../../electron/services/RecentQueryService';
import { NotFoundError } from '../../electron/errors';
import { createTempDb, type TempDb } from '../helpers/db';
import type { FindInput } from '@shared/types';

const CONNECTION_ID = 'conn-1';
const DB_NAME = 'mydb';
const COLLECTION = 'items';

function makeFindInput(overrides: Partial<FindInput> = {}): FindInput {
  return {
    connectionId: CONNECTION_ID,
    dbName: DB_NAME,
    collection: COLLECTION,
    filter: '{}',
    limit: 20,
    skip: 0,
    ...overrides,
  };
}

describe('RecentQueryService', () => {
  let tmp: TempDb;
  let svc: RecentQueryService;

  beforeEach(() => {
    tmp = createTempDb();
    // Insert a real connection row so FK constraint passes
    tmp.db.prepare(`
      INSERT INTO connections (
        id, name, color, connection_type, host, port,
        auth_mech, tls_enabled, tls_verify, ssh_enabled,
        connect_timeout_ms, socket_timeout_ms, server_selection_timeout_ms,
        read_preference, max_pool_size, direct_connection,
        created_at, updated_at
      ) VALUES (
        ?, 'Test', '#1A6835', 'standard', 'localhost', 27017,
        'none', 1, 1, 0,
        10000, 30000, 30000,
        'primary', 100, 0,
        ?, ?
      )
    `).run(CONNECTION_ID, new Date().toISOString(), new Date().toISOString());

    const repo = new RecentQueryRepo(tmp.db);
    svc = new RecentQueryService(repo);
  });

  afterEach(() => {
    tmp.cleanup();
  });

  it('recordFind inserts a row retrievable via get', async () => {
    await svc.recordFind(makeFindInput(), 42, 10);

    const list = svc.list({ connectionId: CONNECTION_ID });
    expect(list).toHaveLength(1);

    const item = list[0]!;
    expect(item.connectionId).toBe(CONNECTION_ID);
    expect(item.dbName).toBe(DB_NAME);
    expect(item.collection).toBe(COLLECTION);
    expect(item.kind).toBe('find');
    expect(item.durationMs).toBe(42);
    expect(item.resultCount).toBe(10);
    expect(item.errorCode).toBeUndefined();

    const fetched = svc.get(item.id);
    expect(fetched.id).toBe(item.id);
  });

  // Codex review on the W15 base → `main` PR. `recordFind` wrote a hardcoded
  // empty builder while `BuilderPane`'s Recent hydration reads `projectionRaw`
  // from it — so rerunning a query that had excluded a field ran with no
  // projection at all and put the excluded field back on screen. Silently: the
  // run in the history list was not the run you got.
  it('recordFind preserves the projection that actually executed', async () => {
    await svc.recordFind(
      { ...makeFindInput(), projection: '{"secret":0}', sort: '{"createdAt":-1}' },
      5,
      1,
    );

    const item = svc.list({ connectionId: CONNECTION_ID })[0]!;
    const payload = item.payload as { builder: { projectionRaw?: string; sort: string; limit: string } };
    expect(payload.builder.projectionRaw).toBe('{"secret":0}');
    expect(payload.builder.sort).toBe('{"createdAt":-1}');
    // `FindInput.limit` is the *effective page* limit, not the user's cap, so
    // recording it would make a rerun inherit whichever page the original run
    // happened to be on.
    expect(payload.builder.limit).toBe('');
  });

  it('recordFind leaves projectionRaw unset when the run had no projection', async () => {
    await svc.recordFind(makeFindInput(), 5, 1);

    const item = svc.list({ connectionId: CONNECTION_ID })[0]!;
    const payload = item.payload as { builder: { projectionRaw?: string } };
    expect(payload.builder.projectionRaw).toBeUndefined();
  });

  it('recordFind stores errorCode when provided', async () => {
    await svc.recordFind(makeFindInput(), 0, 0, 'TIMEOUT');

    const list = svc.list({ connectionId: CONNECTION_ID });
    expect(list).toHaveLength(1);
    expect(list[0]!.errorCode).toBe('TIMEOUT');
  });

  it('get throws NotFoundError for unknown id', () => {
    expect(() => svc.get('does-not-exist')).toThrow(NotFoundError);
  });

  it('clear deletes matching rows and returns count', async () => {
    await svc.recordFind(makeFindInput(), 10, 5);
    await svc.recordFind(makeFindInput({ collection: 'other' }), 20, 3);

    const result = svc.clear({ connectionId: CONNECTION_ID });
    expect(result.deleted).toBe(2);
    expect(svc.list({ connectionId: CONNECTION_ID })).toHaveLength(0);
  });

  it('clear with collection filter only deletes matching rows', async () => {
    await svc.recordFind(makeFindInput(), 10, 5);
    await svc.recordFind(makeFindInput({ collection: 'other' }), 20, 3);

    const result = svc.clear({ collection: COLLECTION });
    expect(result.deleted).toBe(1);
    expect(svc.list({ connectionId: CONNECTION_ID })).toHaveLength(1);
  });

  // the Recent tab's delete/clear paths both ride `clear`.
  it('clear by id removes exactly that row', async () => {
    await svc.recordFind(makeFindInput({ filter: '{"a":1}' }), 10, 5);
    await svc.recordFind(makeFindInput({ filter: '{"b":2}' }), 20, 3);

    const [victim, survivor] = svc.list({ connectionId: CONNECTION_ID });
    const result = svc.clear({ id: victim!.id });

    expect(result.deleted).toBe(1);
    const left = svc.list({ connectionId: CONNECTION_ID });
    expect(left).toHaveLength(1);
    expect(left[0]!.id).toBe(survivor!.id);
  });

  it('clear with kind find leaves aggregation history alone', async () => {
    await svc.recordFind(makeFindInput(), 10, 5);
    await svc.recordAggregation(
      { connectionId: CONNECTION_ID, dbName: DB_NAME, collection: COLLECTION, stages: [] },
      15,
      2,
    );

    const result = svc.clear({
      connectionId: CONNECTION_ID,
      dbName: DB_NAME,
      collection: COLLECTION,
      kind: 'find',
    });

    expect(result.deleted).toBe(1);
    const left = svc.list({ connectionId: CONNECTION_ID });
    expect(left).toHaveLength(1);
    expect(left[0]!.kind).toBe('aggregation');
  });

  // Same collection name, different database — the discriminating case. If
  // `deleteByFilter` ignored `dbName`, `collection = ?` would take both rows.
  it('clear scoped to a database spares the same collection elsewhere', async () => {
    await svc.recordFind(makeFindInput(), 10, 5);
    await svc.recordFind(makeFindInput({ dbName: 'analytics' }), 20, 3);

    const result = svc.clear({
      connectionId: CONNECTION_ID,
      dbName: DB_NAME,
      collection: COLLECTION,
      kind: 'find',
    });

    expect(result.deleted).toBe(1);
    const left = svc.list({ connectionId: CONNECTION_ID });
    expect(left).toHaveLength(1);
    expect(left[0]!.dbName).toBe('analytics');
  });

  it('205 inserts → only 200 survive (oldest evicted)', async () => {
    const total = 205;

    for (let i = 0; i < total; i++) {
      // Use slightly different timestamps to ensure ordering
      await svc.recordFind(makeFindInput({ filter: `{"n":${i}}` }), i, 1);
    }

    // Eviction is deferred to setImmediate so the IPC reply isn't held
    // up by the COUNT + DELETE pair; flush before asserting.
    await svc.drainEvictions();
    const count = svc.list({ connectionId: CONNECTION_ID }).length;
    expect(count).toBe(200);
  });

  it('eviction keeps at most 200 entries after bulk inserts', async () => {
    const total = 205;

    for (let i = 0; i < total; i++) {
      await svc.recordFind(makeFindInput({ filter: `{"n":${i}}` }), i, 1);
    }

    await svc.drainEvictions();
    const list = svc.list({ connectionId: CONNECTION_ID });
    // After 205 inserts the count must not exceed 200
    expect(list.length).toBeLessThanOrEqual(200);
  });
});
