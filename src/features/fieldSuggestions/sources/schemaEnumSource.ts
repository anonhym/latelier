import { api } from '../../../api/atelier';
import { isRecord, toDisplayValue } from '../../../utils/displayValue';
import type { ValueSource, ValueSuggestion } from '../types';

const DEFAULT_TTL_MS = 5 * 60 * 1000;
let ttlMs = DEFAULT_TTL_MS;

/** Override the per-entry cache lifetime. Returns the previous value so tests can stash and restore. */
export function setSchemaEnumCacheTtl(nextMs?: number): number {
  const prev = ttlMs;
  ttlMs = nextMs ?? DEFAULT_TTL_MS;
  return prev;
}

interface CacheEntry {
  fetchedAt: number;
  /** The validator's `$jsonSchema`, or null when there is none to read. */
  schema: Record<string, unknown> | null;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();
// Bumped by every invalidation. A fetch that started under an older
// generation still answers its own caller but never writes the cache, so a
// validator read just before "Edit rules" saved can't keep the old rules for
// a whole TTL.
let generation = 0;

function keyFor(connectionId: string, dbName: string, collection: string): string {
  return `${connectionId}:${dbName}:${collection}`;
}

/**
 * The validator travels as a canonical EJSON string. It is read with plain
 * `JSON.parse`, not `ejsonParse`: reviving `{"$numberInt":"5"}` into a BSON
 * `Int32` would leave `toDisplayValue` with an object it can't name, and the
 * numeric enum would vanish. The sentinel form is what the sampled docs carry
 * too.
 */
function jsonSchemaOf(validator: string | undefined): Record<string, unknown> | null {
  // Stryker disable next-line ConditionalExpression: without this guard
  // `JSON.parse(undefined)` throws and `loadEntry`'s catch caches the same
  // null. Kept so a collection with no rules isn't read as a failure.
  if (!validator) return null;
  const parsed = JSON.parse(validator) as { $jsonSchema?: unknown } | null;
  const schema = parsed?.$jsonSchema;
  return isRecord(schema) ? schema : null;
}

/**
 * One `meta:collectionDetails` per collection and TTL, shared by every field.
 * That call throws on a missing collection and also reads storage stats, so a
 * failure caches "no schema" for the TTL: the popover fails open, emptier.
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

  const startedIn = generation;
  // Held in an object so the fetch's own `finally` can compare against it.
  const self: { promise?: Promise<CacheEntry> } = {};
  self.promise = (async () => {
    let entry: CacheEntry;
    try {
      const details = await api.meta.collectionDetails({ connectionId, dbName, collection });
      entry = { fetchedAt: Date.now(), schema: jsonSchemaOf(details.options.validator) };
    } catch {
      entry = { fetchedAt: Date.now(), schema: null };
    } finally {
      if (inflight.get(key) === self.promise) inflight.delete(key);
    }
    if (startedIn === generation) cache.set(key, entry);
    return entry;
  })();

  inflight.set(key, self.promise);
  return self.promise;
}

/**
 * The `enum` a `$jsonSchema` declares for a dotted field path, or for the
 * elements of an array field (`items.enum`). Own properties only, so a field
 * named `__proto__` or `constructor` can't walk into the prototype chain.
 */
function enumAt(schema: Record<string, unknown> | null, field: string): unknown[] {
  let node: unknown = schema;
  for (const seg of field.split('.')) {
    if (!isRecord(node)) return [];
    const props = node.properties;
    // Stryker disable next-line LogicalOperator: with `&&`, a missing segment
    // reads `props[seg]` as undefined and the walk still ends in []. The own-
    // property check only matters for an inherited name (`constructor`,
    // `__proto__`), and nothing Object.prototype carries has an `enum` or
    // `properties` key, so even that ends in []. It stays as the explicit
    // guard against walking the prototype chain.
    if (!isRecord(props) || !Object.hasOwn(props, seg)) return [];
    node = props[seg];
  }
  if (!isRecord(node)) return [];
  if (Array.isArray(node.enum)) return node.enum;
  const items = node.items;
  if (isRecord(items) && Array.isArray(items.enum)) return items.enum;
  return [];
}

/**
 * Values the collection's validator allows for the field, when its
 * `$jsonSchema` declares an `enum`. These are the exact legal values, so they
 * carry a frequency that ranks them ahead of observed ones. A validator
 * written in query operators, without `$jsonSchema`, suggests nothing.
 */
export const schemaEnumSource: ValueSource = async (ctx) => {
  const field = ctx.target.field.trim();
  if (!field) return [];
  const { schema } = await loadEntry(ctx.connectionId, ctx.dbName, ctx.collection);
  const out: ValueSuggestion[] = [];
  for (const v of enumAt(schema, field)) {
    const dv = toDisplayValue(v);
    if (dv.type === 'object' || dv.type === 'array') continue;
    out.push({
      kind: 'value',
      value: dv.display,
      display: dv.display,
      type: dv.type,
      source: 'schemaEnum',
      frequency: 50,
    });
  }
  return out;
};

/** Drop cached validators, after "Edit rules" saved or a connection changed. */
export function invalidateSchemaEnumCache(
  connectionId?: string,
  dbName?: string,
  collection?: string,
): void {
  // Stryker disable next-line UpdateOperator: only the change matters, not its direction.
  generation++;
  const matches = (k: string): boolean => {
    if (!connectionId) return true;
    if (dbName && collection) return k === keyFor(connectionId, dbName, collection);
    return k.startsWith(`${connectionId}:`);
  };
  for (const map of [cache, inflight]) {
    for (const k of [...map.keys()]) {
      if (matches(k)) map.delete(k);
    }
  }
}
