import { api } from '../../../api/atelier';
import { lastRunSource } from './lastRunSource';
import { summarizeSchema } from '../../../pages/Workspace/schemaSummary';
import type { SchemaSampleEntry } from '@shared/types';
import type { FieldSource, FieldSuggestion } from '../types';

const DEFAULT_TTL_MS = 5 * 60 * 1000;
let ttlMs = DEFAULT_TTL_MS;

/**
 * Override the per-entry cache lifetime. Returns the previous value so
 * tests can stash and restore. Pass no arg to reset to the default.
 */
export function setSampleSchemaCacheTtl(nextMs?: number): number {
  const prev = ttlMs;
  ttlMs = nextMs ?? DEFAULT_TTL_MS;
  return prev;
}

interface CacheEntry {
  fetchedAt: number;
  suggestions: FieldSuggestion[];
  /** W17 — the same fetched sample, digested a second way. */
  structureEntries: SchemaSampleEntry[];
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();

function keyFor(connectionId: string, dbName: string, collection: string): string {
  return `${connectionId}:${dbName}:${collection}`;
}

/**
 * Pull a blended sample (recent + random) from main once per
 * collection+TTL, then digest it two ways — lastRunSource's path-extraction
 * into FieldSuggestion[], and summarizeSchema's per-field type histogram.
 * Failing fetches cache an empty result for the TTL window so we don't
 * hammer main on an unreachable collection.
 *
 * Both digestions ride one in-flight promise on purpose (W17 §1). Giving
 * each consumer its own would compile, pass every cache test, and silently
 * double the sample call.
 */
async function loadEntry(
  connectionId: string,
  dbName: string,
  collection: string,
): Promise<CacheEntry> {
  const key = keyFor(connectionId, dbName, collection);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < ttlMs) return hit;

  const pending = inflight.get(key);
  if (pending) return pending;

  const fetchPromise = (async () => {
    let entry: CacheEntry;
    try {
      const res = await api.meta.sampleSchema({ connectionId, dbName, collection });
      // Reuse lastRunSource's walker by faking a context with the sample
      // as recentDocs. Tag the suggestions as coming from 'sampleSchema'.
      const digested = lastRunSource({
        connectionId,
        dbName,
        collection,
        recentDocs: res.docs,
      }) as FieldSuggestion[];
      entry = {
        fetchedAt: Date.now(),
        suggestions: digested.map((s) => ({ ...s, source: 'sampleSchema' })),
        structureEntries: summarizeSchema(res.docs),
      };
    } catch {
      entry = { fetchedAt: Date.now(), suggestions: [], structureEntries: [] };
    } finally {
      inflight.delete(key);
    }
    cache.set(key, entry);
    return entry;
  })();

  inflight.set(key, fetchPromise);
  return fetchPromise;
}

export const sampleSchemaSource: FieldSource = async (ctx) =>
  (await loadEntry(ctx.connectionId, ctx.dbName, ctx.collection)).suggestions;

/**
 * W17 — the sampled per-field type histogram behind the Update drawer's
 * type warning. Shares this module's cache key, TTL and in-flight fetch with
 * `sampleSchemaSource`; costs no extra round trip inside the TTL window.
 */
export async function getStructureEntries(
  connectionId: string,
  dbName: string,
  collection: string,
): Promise<SchemaSampleEntry[]> {
  return (await loadEntry(connectionId, dbName, collection)).structureEntries;
}

/** Exposed for tests and for explicit refreshes after writes. */
export function invalidateSampleSchemaCache(
  connectionId?: string,
  dbName?: string,
  collection?: string,
): void {
  if (!connectionId) {
    cache.clear();
    return;
  }
  if (dbName && collection) {
    cache.delete(keyFor(connectionId, dbName, collection));
    return;
  }
  for (const k of [...cache.keys()]) {
    if (k.startsWith(`${connectionId}:`)) cache.delete(k);
  }
}
