import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { SuggestionContext } from '../../src/features/fieldSuggestions/types';

// `recentValuesSource` and `invalidateRecentValuesCache` share module-level
// state. Reset modules between tests so each starts with a fresh cache.
async function loadModule(): Promise<typeof import('../../src/features/fieldSuggestions/sources/recentValuesSource')> {
  return import('../../src/features/fieldSuggestions/sources/recentValuesSource');
}

function ctx(
  field: string,
  overrides: Partial<SuggestionContext> = {},
): SuggestionContext & { target: { field: string } } {
  return {
    connectionId: 'c1',
    dbName: 'db',
    collection: 'coll',
    target: { field },
    ...overrides,
  };
}

describe('recentValuesSource', () => {
  let valuesForFieldSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    valuesForFieldSpy = vi.fn(async () => ({
      values: [{ value: 'shipped', valType: 'string', frequency: 3, lastUsedAt: '2026-01-01T00:00:00.000Z' }],
    }));
    installAtelierMock({
      recent: { valuesForField: valuesForFieldSpy as never } as never,
    });
  });

  afterEach(() => {
    uninstallAtelierMock();
  });

  it('maps the IPC result into value suggestions', async () => {
    const { recentValuesSource } = await loadModule();
    const out = await recentValuesSource(ctx('status'));
    expect(out).toEqual([
      { kind: 'value', value: 'shipped', display: 'shipped', source: 'recent', frequency: 3 },
    ]);
  });

  it('caches per (connection, db, collection, field) so a second call within TTL is a no-op', async () => {
    const { recentValuesSource } = await loadModule();
    await recentValuesSource(ctx('status'));
    await recentValuesSource(ctx('status'));
    expect(valuesForFieldSpy).toHaveBeenCalledTimes(1);
  });

  it('does not share a cache entry across fields', async () => {
    const { recentValuesSource } = await loadModule();
    await recentValuesSource(ctx('status'));
    await recentValuesSource(ctx('total'));
    expect(valuesForFieldSpy).toHaveBeenCalledTimes(2);
  });

  it('fails open to [] when the IPC call rejects', async () => {
    vi.resetModules();
    valuesForFieldSpy = vi.fn(async () => {
      throw new Error('boom');
    });
    installAtelierMock({
      recent: { valuesForField: valuesForFieldSpy as never } as never,
    });
    const { recentValuesSource } = await loadModule();
    await expect(recentValuesSource(ctx('status'))).resolves.toEqual([]);
  });

  it('invalidateRecentValuesCache with no args clears every entry', async () => {
    const { recentValuesSource, invalidateRecentValuesCache } = await loadModule();
    await recentValuesSource(ctx('status'));
    invalidateRecentValuesCache();
    await recentValuesSource(ctx('status'));
    expect(valuesForFieldSpy).toHaveBeenCalledTimes(2);
  });

  it('invalidateRecentValuesCache scoped to (conn, db, coll) leaves other collections cached', async () => {
    const { recentValuesSource, invalidateRecentValuesCache } = await loadModule();
    await recentValuesSource(ctx('status', { collection: 'orders' }));
    await recentValuesSource(ctx('status', { collection: 'invoices' }));
    expect(valuesForFieldSpy).toHaveBeenCalledTimes(2);

    invalidateRecentValuesCache('c1', 'db', 'orders');

    await recentValuesSource(ctx('status', { collection: 'orders' })); // refetch
    await recentValuesSource(ctx('status', { collection: 'invoices' })); // cached
    expect(valuesForFieldSpy).toHaveBeenCalledTimes(3);
  });
});
