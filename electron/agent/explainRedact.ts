/**
 * Makes a `queryPlanner` explain safe to hand to an Agent (X27 §8, plan R11).
 * An Agent never sees a host, and a sharded explain is full of them
 * (`serverInfo`, `connectionString`, `shardName`). The plan itself is kept;
 * the connection details and everything that would run the query are not.
 */

/** The top-level members of a plan: `stages` is where an aggregation keeps its `$cursor` plan. Everything else (`serverInfo`, `command`, `$clusterTime`, ...) is dropped. */
const KEPT_TOP_LEVEL: readonly string[] = ['explainVersion', 'queryPlanner', 'stages', 'splitPipeline', 'mergeType', 'shards'];

/** Dropped at every depth. A field of the Agent's own query that bears one of these names loses its entry in `parsedQuery`; that is the price of a rule with no exceptions. */
const DROPPED_KEYS: ReadonlySet<string> = new Set([
  'serverInfo',
  'serverParameters',
  'connectionString',
  'host',
  'hostAndPort',
  'shardName',
  'command',
  'executionStats',
  'allPlansExecution',
]);

/** Deeper than any real plan; beyond it a branch is dropped rather than walked. */
export const MAX_EXPLAIN_DEPTH = 64;

function isPlain(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function redact(value: unknown, depth: number): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) {
    return depth >= MAX_EXPLAIN_DEPTH ? [] : value.map((item) => redact(item, depth + 1));
  }
  // A BSON value (Long, ObjectId, Date, ...) is a leaf.
  if (!isPlain(value)) return value;
  if (depth >= MAX_EXPLAIN_DEPTH) return {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (DROPPED_KEYS.has(key)) continue;
    // `fromEntries`-style definition keeps a `__proto__` key an own property rather than a prototype swap.
    Object.defineProperty(out, key, {
      value: redact((value as Record<string, unknown>)[key], depth + 1),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

/**
 * A sharded aggregation explain keys `shards` by shard name. The names go
 * with the hosts: the entries are kept, as a list.
 */
function unkeyShards(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  return Object.keys(value).map((name) => (value as Record<string, unknown>)[name]);
}

export function redactExplain(explain: unknown): Record<string, unknown> {
  if (typeof explain !== 'object' || explain === null || Array.isArray(explain)) return {};
  const source = explain as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  for (const key of KEPT_TOP_LEVEL) {
    if (!Object.hasOwn(source, key)) continue;
    kept[key] = key === 'shards' ? unkeyShards(source[key]) : source[key];
  }
  return redact(kept, 0) as Record<string, unknown>;
}
