// An earlier revision widened `recent:clear`'s input from `{ connectionId?, collection? }` to
// `{ id?, connectionId?, dbName?, collection?, kind? }`. Every other test on
// that path calls `svc.clear(...)` directly, so `ClearInputSchema` — the piece
// that actually changed — was never parsed by anything. A dropped field there
// silently widens a scoped clear into a connection-wide one, which on this
// channel means deleting history nobody asked to lose.
// recent:list and recent:get are covered the same way: their zod schemas run for real, the service is a spy.
import { describe, it, expect, vi } from 'vitest';
import { createRouter } from '../../electron/ipc/router';
import { registerRecentChannels } from '../../electron/ipc/handlers/recent';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { RecentQueryService } from '../../electron/services/RecentQueryService';
import type { RecentFieldValueService } from '../../electron/services/RecentFieldValueService';
import { NotFoundError } from '../../electron/errors';
import { createIpcShim } from '../helpers/ipcShim';
import { testSenderCheck } from '../helpers/ipcSender';

function setup() {
  const list = vi.fn<(filter: unknown) => unknown[]>(() => [{ id: 'r1' }]);
  const get = vi.fn((id: string) => ({ id }));
  const clear = vi.fn(() => ({ deleted: 1 }));
  const listForField = vi.fn(() => []);
  const recordMany = vi.fn(() => ({ recorded: 1 }));
  const clearAll = vi.fn(() => ({ deleted: 1 }));
  const shim = createIpcShim();
  registerRecentChannels(
    createRouter(shim.ipcMain, testSenderCheck),
    { list, get, clear } as unknown as RecentQueryService,
    { listForField, recordMany, clearAll } as unknown as RecentFieldValueService,
  );
  return { shim, list, get, clear, listForField, recordMany, clearAll };
}

describe('recent:list', () => {
  it('asks the service for an unfiltered list when called with no payload', async () => {
    const { shim, list } = setup();

    const res = await shim.invoke(IPC_CHANNELS.recentList);

    expect(res).toEqual({ ok: true, data: [{ id: 'r1' }] });
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith({});
  });

  it('forwards the whole filter to the service', async () => {
    const { shim, list } = setup();
    const filter = { connectionId: 'c1', kind: 'find', limit: 10 };

    const res = await shim.invoke(IPC_CHANNELS.recentList, filter);

    expect(res.ok).toBe(true);
    expect(list).toHaveBeenCalledWith(filter);
  });

  it('forwards a scope narrowed to database and collection', async () => {
    const { shim, list } = setup();
    const filter = { connectionId: 'c1', dbName: 'shop', collection: 'orders', kind: 'aggregation' };

    const res = await shim.invoke(IPC_CHANNELS.recentList, filter);

    expect(res.ok).toBe(true);
    expect(list).toHaveBeenCalledWith(filter);
  });

  it.each([
    ['a kind outside find and aggregation', { kind: 'script' }],
    ['a zero limit', { limit: 0 }],
    ['a fractional limit', { limit: 1.5 }],
    ['an empty connectionId', { connectionId: '' }],
  ])('rejects %s with VALIDATION and never calls the service', async (_what, payload) => {
    const { shim, list } = setup();

    const res = await shim.invoke(IPC_CHANNELS.recentList, payload);

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('VALIDATION');
    expect(list).not.toHaveBeenCalled();
  });
});

describe('recent:get', () => {
  it('passes the id to the service and returns its row', async () => {
    const { shim, get } = setup();

    const res = await shim.invoke(IPC_CHANNELS.recentGet, { id: 'r1' });

    expect(res).toEqual({ ok: true, data: { id: 'r1' } });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('r1');
  });

  it.each([
    ['an empty id', { id: '' }],
    ['a missing id', {}],
  ])('rejects %s with VALIDATION and never calls the service', async (_what, payload) => {
    const { shim, get } = setup();

    const res = await shim.invoke(IPC_CHANNELS.recentGet, payload);

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('VALIDATION');
    expect(get).not.toHaveBeenCalled();
  });

  it('carries the service NotFoundError across as NOT_FOUND', async () => {
    const { shim, get } = setup();
    get.mockImplementation((id: string) => {
      throw new NotFoundError(`recent query ${id} not found`);
    });

    const res = await shim.invoke(IPC_CHANNELS.recentGet, { id: 'gone' });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('NOT_FOUND');
  });
});

describe('recent:clear input validation', () => {
  it('passes the full four-part scope through to the service', async () => {
    const { shim, clear } = setup();
    const scope = { connectionId: 'c1', dbName: 'shop', collection: 'orders', kind: 'find' };

    const res = await shim.invoke(IPC_CHANNELS.recentClear, scope);

    expect(res.ok).toBe(true);
    expect(clear).toHaveBeenCalledWith(scope);
  });

  it('passes a single id through for the per-row delete', async () => {
    const { shim, clear } = setup();

    const res = await shim.invoke(IPC_CHANNELS.recentClear, { id: 'r1' });

    expect(res.ok).toBe(true);
    expect(clear).toHaveBeenCalledWith({ id: 'r1' });
  });

  it('rejects an unknown kind rather than widening the clear', async () => {
    const { shim, clear } = setup();

    const res = await shim.invoke(IPC_CHANNELS.recentClear, {
      connectionId: 'c1',
      kind: 'everything',
    });

    expect(res.ok).toBe(false);
    expect(clear).not.toHaveBeenCalled();
  });
});

describe('recent:valuesForField / recordFieldValues / clearFieldValues input validation', () => {
  it('valuesForField passes the four-part scope and field through', async () => {
    const { shim, listForField } = setup();

    const res = await shim.invoke(IPC_CHANNELS.recentValuesForField, {
      connectionId: 'c1',
      dbName: 'shop',
      collection: 'orders',
      field: 'status',
    });

    expect(res.ok).toBe(true);
    expect(listForField).toHaveBeenCalledWith('c1', 'shop', 'orders', 'status', undefined);
  });

  it('valuesForField rejects a limit above 100', async () => {
    const { shim, listForField } = setup();

    const res = await shim.invoke(IPC_CHANNELS.recentValuesForField, {
      connectionId: 'c1',
      dbName: 'shop',
      collection: 'orders',
      field: 'status',
      limit: 500,
    });

    expect(res.ok).toBe(false);
    expect(listForField).not.toHaveBeenCalled();
  });

  it('recordFieldValues rejects an entry missing op', async () => {
    const { shim, recordMany } = setup();

    const res = await shim.invoke(IPC_CHANNELS.recentRecordFieldValues, {
      connectionId: 'c1',
      dbName: 'shop',
      collection: 'orders',
      entries: [{ field: 'status', value: 'shipped', valType: 'string' }],
    });

    expect(res.ok).toBe(false);
    expect(recordMany).not.toHaveBeenCalled();
  });

  it('recordFieldValues rejects an empty entries array', async () => {
    const { shim, recordMany } = setup();

    const res = await shim.invoke(IPC_CHANNELS.recentRecordFieldValues, {
      connectionId: 'c1',
      dbName: 'shop',
      collection: 'orders',
      entries: [],
    });

    expect(res.ok).toBe(false);
    expect(recordMany).not.toHaveBeenCalled();
  });

  it('recordFieldValues passes valid entries through to the service', async () => {
    const { shim, recordMany } = setup();
    const entries = [{ field: 'status', value: 'shipped', valType: 'string', op: '$eq' }];

    const res = await shim.invoke(IPC_CHANNELS.recentRecordFieldValues, {
      connectionId: 'c1',
      dbName: 'shop',
      collection: 'orders',
      entries,
    });

    expect(res.ok).toBe(true);
    expect(recordMany).toHaveBeenCalledWith('c1', 'shop', 'orders', entries);
  });

  it('clearFieldValues takes no input and calls the service', async () => {
    const { shim, clearAll } = setup();

    const res = await shim.invoke(IPC_CHANNELS.recentClearFieldValues, {});

    expect(res.ok).toBe(true);
    expect(clearAll).toHaveBeenCalled();
  });
});
