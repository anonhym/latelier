import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { SuggestionContext } from '../../src/features/fieldSuggestions/types';

// `sampleSchemaSource` and `invalidateSampleSchemaCache` share module-level
// state. Reset modules between tests so each starts with a fresh cache.
async function loadModule(): Promise<typeof import('../../src/features/fieldSuggestions/sources/sampleSchemaSource')> {
  return import('../../src/features/fieldSuggestions/sources/sampleSchemaSource');
}

function ctx(overrides: Partial<SuggestionContext> = {}): SuggestionContext {
  return {
    connectionId: 'c1',
    dbName: 'db',
    collection: 'coll',
    ...overrides,
  };
}

describe('invalidateSampleSchemaCache', () => {
  let sampleSchemaSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    sampleSchemaSpy = vi.fn(async () => ({ docs: [{ a: 1 }] as unknown[] }));
    installAtelierMock({
      meta: { sampleSchema: sampleSchemaSpy as never } as never,
    });
  });

  afterEach(() => {
    uninstallAtelierMock();
  });

  it('caches the result so a second call within TTL is a no-op', async () => {
    const { sampleSchemaSource } = await loadModule();
    await sampleSchemaSource(ctx());
    await sampleSchemaSource(ctx());
    expect(sampleSchemaSpy).toHaveBeenCalledTimes(1);
  });

  it('clears all entries when invalidate is called with no args', async () => {
    const { sampleSchemaSource, invalidateSampleSchemaCache } = await loadModule();
    await sampleSchemaSource(ctx());
    await sampleSchemaSource(ctx({ connectionId: 'c2' }));
    expect(sampleSchemaSpy).toHaveBeenCalledTimes(2);

    invalidateSampleSchemaCache();

    await sampleSchemaSource(ctx());
    await sampleSchemaSource(ctx({ connectionId: 'c2' }));
    expect(sampleSchemaSpy).toHaveBeenCalledTimes(4);
  });

  it('clears only entries for a single connection when given a connectionId', async () => {
    const { sampleSchemaSource, invalidateSampleSchemaCache } = await loadModule();
    await sampleSchemaSource(ctx({ connectionId: 'c1', collection: 'a' }));
    await sampleSchemaSource(ctx({ connectionId: 'c1', collection: 'b' }));
    await sampleSchemaSource(ctx({ connectionId: 'c2', collection: 'a' }));
    expect(sampleSchemaSpy).toHaveBeenCalledTimes(3);

    invalidateSampleSchemaCache('c1');

    // c1 entries are gone — both should refetch.
    await sampleSchemaSource(ctx({ connectionId: 'c1', collection: 'a' }));
    await sampleSchemaSource(ctx({ connectionId: 'c1', collection: 'b' }));
    // c2 entry is still cached — no refetch.
    await sampleSchemaSource(ctx({ connectionId: 'c2', collection: 'a' }));
    expect(sampleSchemaSpy).toHaveBeenCalledTimes(5);
  });

  it('clears only the matching collection when given connectionId+dbName+collection', async () => {
    const { sampleSchemaSource, invalidateSampleSchemaCache } = await loadModule();
    await sampleSchemaSource(ctx({ collection: 'a' }));
    await sampleSchemaSource(ctx({ collection: 'b' }));
    expect(sampleSchemaSpy).toHaveBeenCalledTimes(2);

    invalidateSampleSchemaCache('c1', 'db', 'a');

    await sampleSchemaSource(ctx({ collection: 'a' })); // refetch
    await sampleSchemaSource(ctx({ collection: 'b' })); // cached
    expect(sampleSchemaSpy).toHaveBeenCalledTimes(3);
  });
});

/**
 * W17 §1 — the same fetched sample is digested a second way, for the Update
 * drawer's type warning. The load-bearing property is that the second
 * digestion rides the *same* fetch: an implementation that gives each
 * accessor its own in-flight entry compiles, passes every test above, and
 * silently doubles the sample call.
 */
describe('getStructureEntries', () => {
  let sampleSchemaSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    sampleSchemaSpy = vi.fn(async () => ({
      docs: [{ sku: 'a', qty: 1 }, { sku: 'b', qty: 2 }] as unknown[],
    }));
    installAtelierMock({
      meta: { sampleSchema: sampleSchemaSpy as never } as never,
    });
  });

  afterEach(() => {
    uninstallAtelierMock();
  });

  it('digests the sample into per-field type histograms', async () => {
    const { getStructureEntries } = await loadModule();
    const entries = await getStructureEntries('c1', 'db', 'coll');
    const byPath = Object.fromEntries(entries.map((e) => [e.path, e]));
    expect(byPath.sku!.types).toEqual({ string: 2 });
    expect(byPath.qty!.types).toEqual({ number: 2 });
  });

  it('shares one fetch with sampleSchemaSource inside the TTL window', async () => {
    const { getStructureEntries, sampleSchemaSource } = await loadModule();
    const [entries, suggestions] = await Promise.all([
      getStructureEntries('c1', 'db', 'coll'),
      sampleSchemaSource(ctx()),
    ]);
    expect(sampleSchemaSpy).toHaveBeenCalledTimes(1);
    expect(entries.length).toBeGreaterThan(0);
    expect(suggestions.length).toBeGreaterThan(0);

    // Sequentially too — the cache hit must serve both shapes.
    await sampleSchemaSource(ctx());
    await getStructureEntries('c1', 'db', 'coll');
    expect(sampleSchemaSpy).toHaveBeenCalledTimes(1);
  });

  it('caches an empty array on a failed fetch, the same as the suggestion side', async () => {
    sampleSchemaSpy.mockRejectedValue(new Error('unreachable'));
    const { getStructureEntries } = await loadModule();
    expect(await getStructureEntries('c1', 'db', 'coll')).toEqual([]);
    await getStructureEntries('c1', 'db', 'coll');
    expect(sampleSchemaSpy).toHaveBeenCalledTimes(1);
  });

  it('keys the cache per collection, and clears with invalidateSampleSchemaCache', async () => {
    const { getStructureEntries, invalidateSampleSchemaCache } = await loadModule();
    await getStructureEntries('c1', 'db', 'a');
    await getStructureEntries('c1', 'db', 'b');
    expect(sampleSchemaSpy).toHaveBeenCalledTimes(2);

    invalidateSampleSchemaCache('c1', 'db', 'a');
    await getStructureEntries('c1', 'db', 'a'); // refetch
    await getStructureEntries('c1', 'db', 'b'); // cached
    expect(sampleSchemaSpy).toHaveBeenCalledTimes(3);
  });
});
