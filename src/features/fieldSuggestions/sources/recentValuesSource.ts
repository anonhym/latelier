import { api } from '../../../api/atelier';
import type { ValueSource, ValueSuggestion } from '../types';

const DEFAULT_TTL_MS = 5 * 60 * 1000;
let ttlMs = DEFAULT_TTL_MS;

/** Override the per-entry cache lifetime. Returns the previous value so tests can stash and restore. */
export function setRecentValuesCacheTtl(nextMs?: number): number {
  const prev = ttlMs;
  ttlMs = nextMs ?? DEFAULT_TTL_MS;
  return prev;
}

interface CacheEntry {
  fetchedAt: number;
  suggestions: ValueSuggestion[];
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();

function keyFor(connectionId: string, dbName: string, collection: string, field: string): string {
  return `${connectionId}:${dbName}:${collection}:${field}`;
}

/**
 * Values recorded for this `(conn, db, coll, field)` in earlier runs
 * (Source 2, X02 "Value suggestions"). Fails open to `[]` — a lookup
 * failure here must never block the value popover, only leave it emptier.
 * Same shape as `sampleSchemaSource`: one in-flight promise per key so two
 * popover opens inside the TTL window don't double the round trip.
 */
async function loadEntry(
  connectionId: string,
  dbName: string,
  collection: string,
  field: string,
): Promise<CacheEntry> {
  const key = keyFor(connectionId, dbName, collection, field);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < ttlMs) return hit;

  const pending = inflight.get(key);
  if (pending) return pending;

  const fetchPromise = (async () => {
    let entry: CacheEntry;
    try {
      const res = await api.recent.valuesForField({ connectionId, dbName, collection, field });
      entry = {
        fetchedAt: Date.now(),
        suggestions: res.values.map((v): ValueSuggestion => ({
          kind: 'value',
          value: v.value,
          display: v.value,
          source: 'recent',
          frequency: v.frequency,
        })),
      };
    } catch {
      entry = { fetchedAt: Date.now(), suggestions: [] };
    } finally {
      inflight.delete(key);
    }
    cache.set(key, entry);
    return entry;
  })();

  inflight.set(key, fetchPromise);
  return fetchPromise;
}

export const recentValuesSource: ValueSource = async (ctx) =>
  (await loadEntry(ctx.connectionId, ctx.dbName, ctx.collection, ctx.target.field)).suggestions;

/** Exposed for tests and for the invalidation after a successful find records new values. */
export function invalidateRecentValuesCache(
  connectionId?: string,
  dbName?: string,
  collection?: string,
): void {
  if (!connectionId) {
    cache.clear();
    return;
  }
  if (dbName && collection) {
    for (const k of [...cache.keys()]) {
      if (k.startsWith(`${connectionId}:${dbName}:${collection}:`)) cache.delete(k);
    }
    return;
  }
  for (const k of [...cache.keys()]) {
    if (k.startsWith(`${connectionId}:`)) cache.delete(k);
  }
}
