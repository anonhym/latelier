import type { SchemaSampleEntry } from '@shared/types';
import { isExactSentinel } from '../../utils/ejson';

/**
 * Walk a sample of EJSON-shaped documents and aggregate field paths and their
 * BSON-shaped type histograms. Output is sorted with `_id` first, then by
 * descending frequency, then alphabetically — matches Compass's IA roughly.
 *
 * Frequency = fraction of documents in which the field appears, regardless
 * of how many times the field repeats inside an array. Type histograms also
 * count once per document so percentages add up to the field's frequency.
 */
export function summarizeSchema(docs: unknown[]): SchemaSampleEntry[] {
  const counts = new Map<string, { types: Map<string, number>; total: number }>();
  for (const doc of docs) {
    if (!isObject(doc)) continue;
    // Per-document de-dupe guards: a path is counted at most once per doc,
    // and a (path, type) pair is also counted at most once per doc — so
    // `items.qty` doesn't get +5 from a 5-element array of objects.
    walk('', doc, counts, new Set(), new Set());
  }
  const total = docs.length || 1;
  const out: SchemaSampleEntry[] = [];
  for (const [path, info] of counts.entries()) {
    out.push({
      path,
      frequency: info.total / total,
      types: Object.fromEntries(info.types.entries()),
    });
  }
  out.sort((a, b) => {
    if (a.path === '_id') return -1;
    if (b.path === '_id') return 1;
    if (a.frequency !== b.frequency) return b.frequency - a.frequency;
    return a.path.localeCompare(b.path);
  });
  return out;
}

function walk(
  prefix: string,
  value: unknown,
  acc: Map<string, { types: Map<string, number>; total: number }>,
  seenPaths: Set<string>,
  seenPathTypes: Set<string>,
): void {
  if (!isObject(value)) return;
  for (const [key, v] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const t = inferType(v);
    let info = acc.get(path);
    if (!info) {
      info = { types: new Map(), total: 0 };
      acc.set(path, info);
    }
    if (!seenPaths.has(path)) {
      info.total += 1;
      seenPaths.add(path);
    }
    const typeKey = `${path}::${t}`;
    if (!seenPathTypes.has(typeKey)) {
      info.types.set(t, (info.types.get(t) ?? 0) + 1);
      seenPathTypes.add(typeKey);
    }
    // Recurse into plain objects — but skip EJSON wrappers (they are not
    // user-meaningful sub-documents).
    if (isObject(v) && !isEjsonWrapper(v)) {
      walk(path, v, acc, seenPaths, seenPathTypes);
    } else if (Array.isArray(v) && v.length > 0 && isObject(v[0])) {
      // Inspect array elements one level deep to capture nested document
      // shapes (common pattern: items[].productId, items[].qty). Each
      // element shares the same `seenPaths` set so an N-element array
      // contributes at most one bump per nested field path.
      for (const item of v) {
        if (isObject(item) && !isEjsonWrapper(item)) {
          walk(path, item, acc, seenPaths, seenPathTypes);
        }
      }
    }
  }
}

/** 0-1. A type must hold at least this share of a field's own histogram
 *  before disagreeing with it counts as a warning (W17 §2). */
const DOMINANT_SHARE = 0.9;

export interface TypeWarning {
  field: string;
  expectedType: string;
  actualType: string;
  /** 0-100, rounded, of `expectedType` among this field's typed occurrences. */
  percent: number;
}

/**
 * W17 — does `actualType` disagree with what `field` usually holds?
 *
 * Returns null unless one sampled type holds ≥90% of that field's own type
 * histogram and the new value is something else. Silence covers three
 * different cases on purpose: the field was never sampled (nothing to compare
 * against — absence of data is not disagreement), the field is genuinely mixed
 * in real data (a fourth type is not obviously wrong), and the value agrees.
 *
 * `actualType` must come from `inferType`, not from `displayValue.ts` —
 * `entry.types`'s keys are `inferType`'s vocabulary and the check is an
 * equality.
 */
export function checkFieldType(
  entriesByPath: ReadonlyMap<string, SchemaSampleEntry>,
  field: string,
  actualType: string,
): TypeWarning | null {
  const entry = entriesByPath.get(field);
  if (!entry) return null;

  let total = 0;
  let topType = '';
  let topCount = 0;
  for (const [type, count] of Object.entries(entry.types)) {
    total += count;
    if (count > topCount) {
      topCount = count;
      topType = type;
    }
  }
  if (total === 0) return null;

  // The cutoff reads the unrounded fraction. A 0.895 share displays as 90%
  // but is not dominant, and must not warn.
  const share = topCount / total;
  if (share < DOMINANT_SHARE) return null;
  if (topType === actualType) return null;

  return {
    field,
    expectedType: topType,
    actualType,
    percent: Math.round(share * 100),
  };
}

export function inferType(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  if (t === 'string') return 'string';
  if (t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  if (isObject(v)) {
    // A sentinel is only a sentinel when it is the *whole* object. bson's
    // revival rule (`isExactSentinel`) is the authority: it leaves
    // `{"$oid": "…", "extra": true}` as a plain sub-document, so that value
    // is written as a sub-document and must be typed as one. Testing
    // `'$oid' in v` alone labels it `objectid` and disagrees with what
    // actually gets stored.
    if (!isExactSentinel(v)) return 'object';
    if ('$oid' in v) return 'objectid';
    if ('$date' in v) return 'date';
    if ('$numberInt' in v || '$numberDouble' in v) return 'number';
    if ('$numberLong' in v) return 'long';
    if ('$numberDecimal' in v) return 'decimal';
    if ('$regex' in v || '$regularExpression' in v) return 'regex';
    if ('$binary' in v) return 'binary';
    if ('$timestamp' in v) return 'timestamp';
    return 'object';
  }
  return t;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isEjsonWrapper(v: Record<string, unknown>): boolean {
  for (const k of Object.keys(v)) {
    if (k.startsWith('$')) return true;
  }
  return false;
}
