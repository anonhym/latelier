import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IPC_CHANNELS } from '@shared/ipc';
import type {
  SavedAggregationPayload,
  SavedFindPayload,
  SavedQuery,
  SavedQuerySummary,
} from '@shared/types';
import { createRouter } from '../../electron/ipc/router';
import { registerSavedChannels } from '../../electron/ipc/handlers/saved';
import { SavedQueryRepo } from '../../electron/db/repositories/SavedQueryRepo';
import { SavedQueryService } from '../../electron/services/SavedQueryService';
import { createTempDb, insertConnectionRow, type TempDb } from '../helpers/db';
import { createIpcShim } from '../helpers/ipcShim';
import { testSenderCheck } from '../helpers/ipcSender';

/**
 * Drives `saved:*` through the real router, zod validators, service and a
 * temp SQLite file. The service spec skips the router and the registration
 * spec stubs the service, so neither proves that `saved.ts` maps every field
 * of the payload onto the service call or that a failure crosses as a typed
 * code. The NOT_FOUND that `saved:create` answers when the connection does
 * not exist (the repo maps the SQLite foreign-key failure to a typed error) is
 * pinned by the connection-not-found fix (#431), so it is not repeated here.
 */
const CONN_A = 'saved-conn-a';
const CONN_B = 'saved-conn-b';

function findPayload(overrides: Partial<SavedFindPayload> = {}): SavedFindPayload {
  return {
    kind: 'find',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    ...overrides,
  };
}

function aggregationPayload(
  overrides: Partial<SavedAggregationPayload> = {},
): SavedAggregationPayload {
  return {
    kind: 'aggregation',
    stages: [{ id: 1, op: '$match', body: '{"status":"open"}', enabled: true }],
    ...overrides,
  };
}

const createInput = (overrides: Record<string, unknown> = {}) => ({
  connectionId: CONN_A,
  dbName: 'shop',
  collection: 'orders',
  kind: 'find',
  name: 'open orders',
  payload: findPayload(),
  ...overrides,
});

describe('saved:* channels via router', () => {
  let tmp: TempDb;
  let shim: ReturnType<typeof createIpcShim>;

  /** Creates a saved query through the channel and returns it, failing loudly if the channel did not. */
  async function create(overrides: Record<string, unknown> = {}): Promise<SavedQuery> {
    const env = await shim.invoke<SavedQuery>(IPC_CHANNELS.savedCreate, createInput(overrides));
    if (!env.ok) throw new Error(`saved:create failed: ${env.error.code} ${env.error.message}`);
    return env.data;
  }

  beforeEach(() => {
    tmp = createTempDb();
    insertConnectionRow(tmp.db, CONN_A);
    insertConnectionRow(tmp.db, CONN_B);
    shim = createIpcShim();
    registerSavedChannels(
      createRouter(shim.ipcMain, testSenderCheck),
      new SavedQueryService(new SavedQueryRepo(tmp.db)),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    tmp.cleanup();
  });

  describe('saved:list', () => {
    it('answers an empty list for no payload at all', async () => {
      const env = await shim.invoke<SavedQuerySummary[]>(IPC_CHANNELS.savedList);
      expect(env).toEqual({ ok: true, data: [] });
    });

    it('filters by connection and kind', async () => {
      await create({ name: 'a-find' });
      await create({ name: 'a-agg', kind: 'aggregation', payload: { kind: 'aggregation', stages: [] } });
      await create({ connectionId: CONN_B, name: 'b-find' });
      const env = await shim.invoke<SavedQuerySummary[]>(IPC_CHANNELS.savedList, {
        connectionId: CONN_A,
        kind: 'find',
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.data.map((q) => q.name)).toEqual(['a-find']);
    });

    it('filters by database and collection', async () => {
      await create({ name: 'orders-q' });
      await create({ name: 'users-q', collection: 'users' });
      // Same collection name in another database, so only dbName tells it from users-q.
      await create({ name: 'other-db-q', dbName: 'crm', collection: 'users' });
      const env = await shim.invoke<SavedQuerySummary[]>(IPC_CHANNELS.savedList, {
        dbName: 'shop',
        collection: 'users',
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.data.map((q) => q.name)).toEqual(['users-q']);
    });

    it('returns summaries that carry the payload description and no payload', async () => {
      await create({ payload: findPayload({ description: 'the open ones' }) });
      const env = await shim.invoke<SavedQuerySummary[]>(IPC_CHANNELS.savedList);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.data).toHaveLength(1);
      expect(env.data[0]).toMatchObject({ name: 'open orders', description: 'the open ones' });
      expect(env.data[0]).not.toHaveProperty('payload');
    });

    it('rejects an unknown kind with VALIDATION', async () => {
      const env = await shim.invoke(IPC_CHANNELS.savedList, { kind: 'bogus' });
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('VALIDATION');
    });
  });

  describe('saved:get', () => {
    it('answers NOT_FOUND for an unknown id', async () => {
      const env = await shim.invoke(IPC_CHANNELS.savedGet, { id: 'no-such-query' });
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('NOT_FOUND');
    });

    it('rejects an empty id with VALIDATION', async () => {
      const env = await shim.invoke(IPC_CHANNELS.savedGet, { id: '' });
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('VALIDATION');
    });
  });

  describe('saved:create', () => {
    it.each([
      ['find', findPayload({ queryRaw: '{"status":"open"}', description: 'd' })],
      ['aggregation', aggregationPayload({ description: 'd' })],
    ] as const)(
      'stores every field of the %s payload, which saved:get reads back',
      async (kind, payload) => {
        const created = await create({ kind, name: 'round trip', payload });
        const env = await shim.invoke<SavedQuery>(IPC_CHANNELS.savedGet, { id: created.id });
        expect(env.ok).toBe(true);
        if (!env.ok) return;
        expect(env.data).toMatchObject({
          id: created.id,
          connectionId: CONN_A,
          dbName: 'shop',
          collection: 'orders',
          kind,
          name: 'round trip',
        });
        expect(env.data.payload).toEqual(payload);
      },
    );

    it.each([
      ['an empty name', { name: '' }],
      ['a kind outside the enum', { kind: 'view' }],
      ['a payload that is not an object', { payload: 'x' }],
      ['an empty connectionId', { connectionId: '' }],
      ['an empty dbName', { dbName: '' }],
      ['an empty collection', { collection: '' }],
      ['a missing collection', { collection: undefined }],
    ])('rejects %s with VALIDATION', async (_what, overrides) => {
      const env = await shim.invoke(IPC_CHANNELS.savedCreate, createInput(overrides));
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('VALIDATION');
    });

    it('answers CONFLICT for the same name twice in one scope', async () => {
      await create();
      const env = await shim.invoke(IPC_CHANNELS.savedCreate, createInput());
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('CONFLICT');
    });

    it('accepts the same name in another collection', async () => {
      const first = await create();
      const env = await shim.invoke<SavedQuery>(
        IPC_CHANNELS.savedCreate,
        createInput({ collection: 'users' }),
      );
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.data.collection).toBe('users');
      expect(env.data.name).toBe(first.name);
      expect(env.data.id).not.toBe(first.id);
    });
  });

  describe('saved:update', () => {
    it('renames and replaces the payload, leaving the scope alone', async () => {
      const created = await create();
      const payload = findPayload({ queryRaw: '{"a":1}' });
      const env = await shim.invoke<SavedQuery>(IPC_CHANNELS.savedUpdate, {
        id: created.id,
        patch: { name: 'renamed', payload },
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.data).toMatchObject({
        id: created.id,
        name: 'renamed',
        payload,
        dbName: 'shop',
        collection: 'orders',
        kind: 'find',
      });
      const read = await shim.invoke<SavedQuery>(IPC_CHANNELS.savedGet, { id: created.id });
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      expect(read.data.name).toBe('renamed');
      expect(read.data.payload).toEqual(payload);
    });

    it('replaces only the payload when the patch carries only a payload', async () => {
      // AggregationTab's Save sends exactly this shape: it must not rename the pipeline.
      const created = await create({
        kind: 'aggregation',
        name: 'pipeline',
        payload: aggregationPayload(),
      });
      const payload = aggregationPayload({
        stages: [{ id: 1, op: '$limit', body: '5', enabled: true }],
      });
      const env = await shim.invoke<SavedQuery>(IPC_CHANNELS.savedUpdate, {
        id: created.id,
        patch: { payload },
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.data.name).toBe('pipeline');
      expect(env.data.payload).toEqual(payload);
      const read = await shim.invoke<SavedQuery>(IPC_CHANNELS.savedGet, { id: created.id });
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      expect(read.data.name).toBe('pipeline');
      expect(read.data.payload).toEqual(payload);
    });

    it('renames without touching the payload when the patch carries only a name', async () => {
      const payload = findPayload({ queryRaw: '{"a":1}', description: 'keep me' });
      const created = await create({ payload });
      const env = await shim.invoke<SavedQuery>(IPC_CHANNELS.savedUpdate, {
        id: created.id,
        patch: { name: 'renamed' },
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.data.name).toBe('renamed');
      expect(env.data.payload).toEqual(payload);
      const read = await shim.invoke<SavedQuery>(IPC_CHANNELS.savedGet, { id: created.id });
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      expect(read.data.name).toBe('renamed');
      expect(read.data.payload).toEqual(payload);
    });

    it('accepts an empty patch, which today changes updated_at and nothing else', async () => {
      // No renderer call sends this; it is pinned so tightening it becomes a deliberate change.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const created = await create();
      vi.setSystemTime(new Date('2026-01-01T00:00:05.000Z'));
      const env = await shim.invoke<SavedQuery>(IPC_CHANNELS.savedUpdate, {
        id: created.id,
        patch: {},
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.data).toEqual({ ...created, updatedAt: '2026-01-01T00:00:05.000Z' });
      const read = await shim.invoke<SavedQuery>(IPC_CHANNELS.savedGet, { id: created.id });
      expect(read).toEqual({ ok: true, data: env.data });
    });

    it('answers NOT_FOUND for an unknown id', async () => {
      const env = await shim.invoke(IPC_CHANNELS.savedUpdate, {
        id: 'no-such-query',
        patch: { name: 'x' },
      });
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('NOT_FOUND');
    });

    it('rejects an empty patch.name with VALIDATION', async () => {
      const created = await create();
      const env = await shim.invoke(IPC_CHANNELS.savedUpdate, {
        id: created.id,
        patch: { name: '' },
      });
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('VALIDATION');
    });

    it.each([
      ['an empty id', { id: '' }],
      ['a payload that is not an object', { patch: { payload: 'x' } }],
    ])('rejects %s with VALIDATION', async (_what, overrides) => {
      const created = await create();
      const env = await shim.invoke(IPC_CHANNELS.savedUpdate, {
        id: created.id,
        patch: { name: 'x' },
        ...overrides,
      });
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('VALIDATION');
    });

    it('answers CONFLICT when the new name is taken in the scope', async () => {
      await create({ name: 'first' });
      const second = await create({ name: 'second' });
      const env = await shim.invoke(IPC_CHANNELS.savedUpdate, {
        id: second.id,
        patch: { name: 'first' },
      });
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('CONFLICT');
    });
  });

  describe('saved:delete', () => {
    it('removes the query and returns no data', async () => {
      const created = await create();
      const del = await shim.invoke(IPC_CHANNELS.savedDelete, { id: created.id });
      expect(del).toStrictEqual({ ok: true, data: undefined });
      const after = await shim.invoke(IPC_CHANNELS.savedGet, { id: created.id });
      expect(after.ok).toBe(false);
      if (after.ok) return;
      expect(after.error.code).toBe('NOT_FOUND');
    });

    it('answers NOT_FOUND for an unknown id', async () => {
      const env = await shim.invoke(IPC_CHANNELS.savedDelete, { id: 'no-such-query' });
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('NOT_FOUND');
    });

    it('rejects an empty id with VALIDATION', async () => {
      const env = await shim.invoke(IPC_CHANNELS.savedDelete, { id: '' });
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('VALIDATION');
    });
  });

  describe('saved:duplicate', () => {
    it('copies the query under a new id and name', async () => {
      const created = await create({ payload: findPayload({ queryRaw: '{"a":1}' }) });
      const env = await shim.invoke<SavedQuery>(IPC_CHANNELS.savedDuplicate, {
        id: created.id,
        newName: 'open orders copy',
      });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.data.id).not.toBe(created.id);
      expect(env.data).toMatchObject({
        name: 'open orders copy',
        connectionId: CONN_A,
        dbName: 'shop',
        collection: 'orders',
        kind: 'find',
        payload: created.payload,
      });
      const read = await shim.invoke<SavedQuery>(IPC_CHANNELS.savedGet, { id: env.data.id });
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      expect(read.data.name).toBe('open orders copy');
      expect(read.data.payload).toEqual(created.payload);
    });

    it('answers NOT_FOUND for an unknown id', async () => {
      const env = await shim.invoke(IPC_CHANNELS.savedDuplicate, {
        id: 'no-such-query',
        newName: 'copy',
      });
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('NOT_FOUND');
    });

    it.each([
      ['an empty newName', { newName: '' }],
      ['an empty id', { id: '', newName: 'copy' }],
    ])('rejects %s with VALIDATION', async (_what, overrides) => {
      const created = await create();
      const env = await shim.invoke(IPC_CHANNELS.savedDuplicate, { id: created.id, ...overrides });
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('VALIDATION');
    });

    it('answers CONFLICT when newName is already taken in the scope', async () => {
      const created = await create();
      const env = await shim.invoke(IPC_CHANNELS.savedDuplicate, {
        id: created.id,
        newName: created.name,
      });
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('CONFLICT');
    });
  });
});
