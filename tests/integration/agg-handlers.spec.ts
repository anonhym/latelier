import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { MongoClient } from 'mongodb';
import { IPC_CHANNELS } from '@shared/ipc';
import type { AggResultWire, AggStagePreview } from '@shared/types';
import { createRouter } from '../../electron/ipc/router';
import { registerAggChannels } from '../../electron/ipc/handlers/agg';
import { MongoPool } from '../../electron/mongo/MongoPool';
import { AggregationService } from '../../electron/mongo/AggregationService';
import { RecentQueryService } from '../../electron/services/RecentQueryService';
import { RecentQueryRepo } from '../../electron/db/repositories/RecentQueryRepo';
import { SecretsVault } from '../../electron/secrets/SecretsVault';
import { createSafeStorageMock } from '../helpers/safeStorageMock';
import { createTempDb, insertConnectionRow, type TempDb } from '../helpers/db';
import { createIpcShim } from '../helpers/ipcShim';
import { expectSchemaReject } from '../helpers/ipcAssert';
import { testSenderCheck } from '../helpers/ipcSender';
import {
  getSharedServer,
  makeConnection,
  makeReader,
  stopSharedServer,
  uriToHostPort,
} from '../helpers/mongo';

/**
 * Drives `agg:*` through the real router, zod validators, `AggregationService`,
 * `MongoPool` and a real mongod. The service spec skips the router and the
 * registration spec stubs the service, so neither proves that `agg.ts` accepts
 * what the renderer sends, forwards every field of it, or that a failure
 * crosses as a typed code.
 *
 * Schema rejections go through `expectSchemaReject`: the service raises
 * VALIDATION too (no enabled stages, a bad collection name) and mongod answers
 * BadValue as VALIDATION, so a bare code check would stay green with the schema
 * loosened.
 */
const DB = 'agg_router_shop';
const SRC = 'products';
const RW = 'agg-rw';
const RO = 'agg-ro';
const SEEDED = ['apple', 'banana', 'cherry', 'carrot', 'leek'];

const stage = (id: number, op: string, body: string, enabled = true) => ({ id, op, body, enabled });
const input = (overrides: Record<string, unknown> = {}) => ({
  connectionId: RW,
  dbName: DB,
  collection: SRC,
  stages: [stage(1, '$match', '{}')],
  ...overrides,
});
const fruitNames = [
  stage(1, '$match', '{"kind":"fruit"}'),
  stage(2, '$sort', '{"name":1}'),
  stage(3, '$project', '{"_id":0,"name":1}'),
];
const names = (data: AggResultWire) =>
  (JSON.parse(data.rowsJson) as Array<{ name: string }>).map((r) => r.name);

describe('agg:* channels via router', () => {
  let tmp: TempDb;
  let pool: MongoPool;
  let svc: AggregationService;
  const shim = createIpcShim();

  const countOf = async (collection: string) =>
    (await pool.readDb(RW, DB)).collection(collection).countDocuments({});
  const exists = async (collection: string) =>
    (await (await pool.readDb(RW, DB)).listCollections({ name: collection }).toArray()).length === 1;

  beforeAll(async () => {
    const server = await getSharedServer();
    const seed = new MongoClient(server.getUri());
    try {
      await seed.connect();
      await seed
        .db(DB)
        .collection(SRC)
        .insertMany(
          SEEDED.map((name) => ({ name, kind: ['apple', 'banana', 'cherry'].includes(name) ? 'fruit' : 'veg' })),
        );
    } finally {
      await seed.close();
    }

    tmp = createTempDb();
    // The service records each run in the recent-query table, fire-and-forget:
    // without these rows the FK failure is swallowed and hides a real one.
    insertConnectionRow(tmp.db, RW);
    insertConnectionRow(tmp.db, RO);
    const hp = uriToHostPort(server.getUri());
    pool = new MongoPool({
      repo: makeReader([
        makeConnection(RW, hp, { defaultDb: DB }),
        makeConnection(RO, hp, { defaultDb: DB, readOnly: true }),
      ]),
      vault: new SecretsVault(tmp.db, createSafeStorageMock()),
    });
    svc = new AggregationService(pool, new RecentQueryService(new RecentQueryRepo(tmp.db)));
    registerAggChannels(createRouter(shim.ipcMain, testSenderCheck), svc);
  }, 60_000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await pool.disconnectAll();
    tmp.cleanup();
    await stopSharedServer();
  });

  describe('agg:run', () => {
    it('returns the rows with per-stage counts', async () => {
      const env = await shim.invoke<AggResultWire>(
        IPC_CHANNELS.aggRun,
        input({
          stages: [
            stage(1, '$match', '{"kind":"fruit"}'),
            stage(2, '$sort', '{"name":1}'),
            stage(3, '$limit', '2'),
            stage(4, '$project', '{"_id":0,"name":1}'),
          ],
        }),
      );
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(names(env.data)).toEqual(['apple', 'banana']);
      expect(env.data.stageCounts).toEqual({ 1: 3, 2: 3, 3: 2, 4: 2 });
      expect(env.data.hasMore).toBe(false);
    });

    it('forwards limit, so the page is cut short and hasMore is set', async () => {
      const env = await shim.invoke<AggResultWire>(
        IPC_CHANNELS.aggRun,
        input({ stages: fruitNames, limit: 2 }),
      );
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(names(env.data)).toEqual(['apple', 'banana']);
      expect(env.data.hasMore).toBe(true);
    });

    it('forwards cancelToken to the service', async () => {
      const run = vi.spyOn(svc, 'run');
      const env = await shim.invoke(IPC_CHANNELS.aggRun, input({ cancelToken: 'run-token' }));
      expect(env.ok).toBe(true);
      expect(run).toHaveBeenCalledWith(expect.objectContaining({ cancelToken: 'run-token' }));
    });

    it.each([
      ['an empty stage list', { stages: [] }, 'stages'],
      ['a limit of 0', { limit: 0 }, 'limit'],
      ['a limit over the 10000 cap', { limit: 10_001 }, 'limit'],
      ['a fractional limit', { limit: 1.5 }, 'limit'],
      ['a fractional stage id', { stages: [stage(1.5, '$match', '{}')] }, 'stages.0.id'],
      ['an empty stage op', { stages: [stage(1, '', '{}')] }, 'stages.0.op'],
      ['an empty connectionId', { connectionId: '' }, 'connectionId'],
      ['a missing collection', { collection: undefined }, 'collection'],
    ])('rejects %s at the schema', async (_what, overrides, path) => {
      expectSchemaReject(await shim.invoke(IPC_CHANNELS.aggRun, input(overrides)), path);
    });

    it('answers VALIDATION from the service when every stage is disabled', async () => {
      const env = await shim.invoke(
        IPC_CHANNELS.aggRun,
        input({ stages: [stage(1, '$match', '{}', false)] }),
      );
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('VALIDATION');
    });

    it('answers VALIDATION naming the stage when a body is not EJSON', async () => {
      const env = await shim.invoke(
        IPC_CHANNELS.aggRun,
        input({ stages: [stage(4, '$match', '{not json')] }),
      );
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('VALIDATION');
      expect(env.error.details).toMatchObject({ stageId: 4, op: '$match' });
    });

    it('classifies a pipeline the server rejects as MONGO_ERROR', async () => {
      const env = await shim.invoke(
        IPC_CHANNELS.aggRun,
        input({ stages: [stage(1, '$group', '{}')] }),
      );
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('MONGO_ERROR');
    });

    it('refuses a write stage without allowWrite and says which stage', async () => {
      const env = await shim.invoke(
        IPC_CHANNELS.aggRun,
        input({ stages: [stage(1, '$match', '{}'), stage(2, '$out', '"run_blocked_out"')] }),
      );
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('VALIDATION');
      expect(env.error.details).toMatchObject({
        kind: 'writeStage',
        writeStageOp: '$out',
        stageId: 2,
        targetCollection: 'run_blocked_out',
      });
      expect(await exists('run_blocked_out')).toBe(false);
    });

    it('runs a write stage with allowWrite and leaves the copy behind', async () => {
      const env = await shim.invoke<AggResultWire>(
        IPC_CHANNELS.aggRun,
        input({
          stages: [stage(1, '$match', '{}'), stage(2, '$out', '"run_out_ok"')],
          allowWrite: true,
        }),
      );
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.data.rowsJson).toBe('[]');
      expect(await countOf('run_out_ok')).toBe(SEEDED.length);
    });

    it('answers CONFLICT for $out into the source collection and leaves the source intact', async () => {
      const env = await shim.invoke(
        IPC_CHANNELS.aggRun,
        input({
          stages: [stage(1, '$match', '{"kind":"fruit"}'), stage(2, '$out', JSON.stringify(SRC))],
          allowWrite: true,
        }),
      );
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('CONFLICT');
      expect(await countOf(SRC)).toBe(SEEDED.length);
    });

    it('answers READ_ONLY for a write stage on a read-only connection and writes nothing', async () => {
      const env = await shim.invoke(
        IPC_CHANNELS.aggRun,
        input({
          connectionId: RO,
          stages: [stage(1, '$match', '{}'), stage(2, '$out', '"ro_refused_out"')],
          allowWrite: true,
        }),
      );
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('READ_ONLY');
      expect(await exists('ro_refused_out')).toBe(false);
    });

    it('still runs a read pipeline on a read-only connection', async () => {
      const env = await shim.invoke<AggResultWire>(
        IPC_CHANNELS.aggRun,
        input({ connectionId: RO, stages: fruitNames }),
      );
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(names(env.data)).toEqual(['apple', 'banana', 'cherry']);
    });

    it('answers NOT_FOUND for an unknown connection', async () => {
      const env = await shim.invoke(IPC_CHANNELS.aggRun, input({ connectionId: 'no-such-conn' }));
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('NOT_FOUND');
    });
  });

  describe('agg:previewUpToStage', () => {
    it('returns the last stage id, an uncapped count and a sample capped by limit', async () => {
      const env = await shim.invoke<AggStagePreview>(
        IPC_CHANNELS.aggPreviewUpToStage,
        input({ stages: fruitNames, limit: 2 }),
      );
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.data.stageId).toBe(3);
      expect(env.data.count).toBe(3);
      expect(env.data.sample).toHaveLength(2);
    });

    it.each([
      ['a limit over the 50 cap', { limit: 51 }, 'limit'],
      ['a limit of 0', { limit: 0 }, 'limit'],
      ['an empty stage list', { stages: [] }, 'stages'],
      ['a fractional stage id', { stages: [stage(0.5, '$match', '{}')] }, 'stages.0.id'],
    ])('rejects %s at the schema', async (_what, overrides, path) => {
      expectSchemaReject(await shim.invoke(IPC_CHANNELS.aggPreviewUpToStage, input(overrides)), path);
    });

    it('answers NOT_FOUND for an unknown connection', async () => {
      const env = await shim.invoke(
        IPC_CHANNELS.aggPreviewUpToStage,
        input({ connectionId: 'no-such-conn' }),
      );
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('NOT_FOUND');
    });
  });

  describe('agg:cancel', () => {
    it('hands the token to the service and answers ok with no data, even for an unknown token', async () => {
      const cancel = vi.spyOn(svc, 'cancel');
      const env = await shim.invoke(IPC_CHANNELS.aggCancel, { token: 'never-registered' });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.data).toBeUndefined();
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(cancel).toHaveBeenCalledWith('never-registered');
    });

    it.each([
      ['an empty token', { token: '' }],
      ['a missing token', {}],
      ['a non-string token', { token: 7 }],
    ])('rejects %s at the schema', async (_what, payload) => {
      const cancel = vi.spyOn(svc, 'cancel');
      expectSchemaReject(await shim.invoke(IPC_CHANNELS.aggCancel, payload), 'token');
      expect(cancel).not.toHaveBeenCalled();
    });
  });

  describe('agg:runAndSave', () => {
    const save = (overrides: Record<string, unknown> = {}) =>
      input({
        stages: [stage(1, '$match', '{"kind":"fruit"}')],
        target: { dbName: DB, collection: 'saved_fruit', mode: '$out' },
        ...overrides,
      });

    it('writes the result with $out and reports how many documents landed', async () => {
      const env = await shim.invoke<AggResultWire & { writtenCount?: number }>(
        IPC_CHANNELS.aggRunAndSave,
        save(),
      );
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.data.writtenCount).toBe(3);
      expect(await exists('saved_fruit')).toBe(true);
      expect(await countOf('saved_fruit')).toBe(3);
      expect(await countOf(SRC)).toBe(SEEDED.length);
    });

    it('forwards the $merge options: whenNotMatched discard writes nothing, the default inserts', async () => {
      const discard = await shim.invoke<{ writtenCount?: number }>(
        IPC_CHANNELS.aggRunAndSave,
        save({
          target: {
            dbName: DB,
            collection: 'merged_discard',
            mode: '$merge',
            merge: { whenMatched: 'merge', whenNotMatched: 'discard' },
          },
        }),
      );
      expect(discard.ok && discard.data.writtenCount).toBe(0);

      const insert = await shim.invoke<{ writtenCount?: number }>(
        IPC_CHANNELS.aggRunAndSave,
        save({ target: { dbName: DB, collection: 'merged_insert', mode: '$merge' } }),
      );
      expect(insert.ok && insert.data.writtenCount).toBe(3);
    });

    it.each([
      ['a mode outside the enum', { target: { dbName: DB, collection: 'x', mode: '$append' } }, 'target.mode'],
      ['a missing target', { target: undefined }, 'target'],
      ['an empty target collection', { target: { dbName: DB, collection: '', mode: '$out' } }, 'target.collection'],
      [
        'a whenMatched outside the enum',
        { target: { dbName: DB, collection: 'x', mode: '$merge', merge: { whenMatched: 'bogus' } } },
        'target.merge.whenMatched',
      ],
    ])('rejects %s at the schema', async (_what, overrides, path) => {
      expectSchemaReject(await shim.invoke(IPC_CHANNELS.aggRunAndSave, save(overrides)), path);
    });

    it('answers VALIDATION from the service for a malformed target collection name', async () => {
      const env = await shim.invoke(
        IPC_CHANNELS.aggRunAndSave,
        save({ target: { dbName: DB, collection: '$bad', mode: '$out' } }),
      );
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('VALIDATION');
    });

    it('answers CONFLICT when $out would overwrite the source and leaves the source intact', async () => {
      const env = await shim.invoke(
        IPC_CHANNELS.aggRunAndSave,
        save({ target: { dbName: DB, collection: SRC, mode: '$out' } }),
      );
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('CONFLICT');
      expect(await countOf(SRC)).toBe(SEEDED.length);
    });

    it('answers READ_ONLY on a read-only connection and writes nothing', async () => {
      const env = await shim.invoke(
        IPC_CHANNELS.aggRunAndSave,
        save({
          connectionId: RO,
          target: { dbName: DB, collection: 'ro_refused_save', mode: '$out' },
        }),
      );
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('READ_ONLY');
      expect(await exists('ro_refused_save')).toBe(false);
    });
  });

  describe('agg:explain', () => {
    it.each(['queryPlanner', 'executionStats', 'allPlansExecution'] as const)(
      'returns a plan for verbosity %s',
      async (verbosity) => {
        const env = await shim.invoke<{ plan: unknown; verbosity: string; writeStageOmitted: boolean }>(
          IPC_CHANNELS.aggExplain,
          input({ stages: fruitNames, verbosity }),
        );
        expect(env.ok).toBe(true);
        if (!env.ok) return;
        expect(env.data.verbosity).toBe(verbosity);
        expect(env.data.writeStageOmitted).toBe(false);
        expect(env.data.plan).toBeTruthy();
      },
    );

    it('says when it left a write stage out of the plan', async () => {
      const env = await shim.invoke<{ writeStageOmitted: boolean }>(
        IPC_CHANNELS.aggExplain,
        input({
          stages: [stage(1, '$match', '{}'), stage(2, '$out', '"explain_never_written"')],
          verbosity: 'queryPlanner',
        }),
      );
      expect(env.ok && env.data.writeStageOmitted).toBe(true);
      expect(await exists('explain_never_written')).toBe(false);
    });

    it.each([
      ['a verbosity outside the enum', { verbosity: 'bogus' }],
      ['a missing verbosity', {}],
    ])('rejects %s at the schema', async (_what, overrides) => {
      expectSchemaReject(
        await shim.invoke(IPC_CHANNELS.aggExplain, input(overrides)),
        'verbosity',
      );
    });

    it('answers NOT_FOUND for an unknown connection', async () => {
      const env = await shim.invoke(
        IPC_CHANNELS.aggExplain,
        input({ connectionId: 'no-such-conn', verbosity: 'queryPlanner' }),
      );
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('NOT_FOUND');
    });
  });
});
