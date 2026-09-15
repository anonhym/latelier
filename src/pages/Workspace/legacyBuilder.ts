/**
 * FROZEN — W13-2, spec §8.
 *
 * Pins the pre-W13 filter compiler and the pre-`queryRaw` saved-payload
 * shape so a find saved before `queryRaw` existed — whose filter lives only
 * in `builder.conditions` — still hydrates correctly once W13-5
 * deletes `conditions`/`logic` from the live `BuilderState`. Without this,
 * every such saved find would silently load as `{}`: the user's filter gone,
 * no error, no way to notice.
 *
 * Read-only. Never used for editing, never extended — except
 * `LegacySavedFindPayload`, which is the read boundary this shim exists to
 * serve. `legacyCompileFilter` is a standalone copy of the filter half of
 * `compileMql` (as it stood pre-W13), not a delegation into it: `builder.ts`
 * loses that half once W13-5 lands, and a delegating shim would break with it.
 */

// ─── Legacy shapes ───────────────────────────────────────────────────────────

export type LegacyValType =
  | 'string' | 'number' | 'long' | 'decimal' | 'boolean' | 'date' | 'null' | 'regex' | 'objectid' | 'array';

export interface LegacyCond {
  id: number;
  field: string;
  op: string;
  valType: LegacyValType;
  value: string;
}

export interface LegacyBuilderState {
  conditions: LegacyCond[];
  logic: 'AND' | 'OR';
  projection: string[];
  sort: string;
  limit: string;
}

/**
 * Stored find-payload shape as it may exist on disk from before `queryRaw`
 * existed. Distinct from the live `SavedFindPayload` on purpose: the read
 * boundary must not drift when the live type changes shape.
 */
export interface LegacySavedFindPayload {
  kind: 'find';
  builder: LegacyBuilderState;
  queryRaw?: string;
  description?: string;
}

// ─── legacyCompileFilter — frozen copy of pre-W13 compileMql's filter half ──

const SIMPLE_OPS = new Set<string>(['$eq', '$ne', '$gt', '$gte', '$lt', '$lte']);
const ARRAY_VALUE_OPS = new Set<string>(['$in', '$nin', '$all']);
const BITS_OPS = new Set<string>(['$bitsAllClear', '$bitsAnyClear', '$bitsAllSet', '$bitsAnySet']);

function parseJsonArray(raw: string): unknown[] {
  try {
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function buildTypedValue(cond: LegacyCond): unknown {
  const { valType, value } = cond;
  switch (valType) {
    case 'string':
      return value;
    case 'number':
      return Number(value);
    case 'long':
      return { $numberLong: value.trim() };
    case 'decimal':
      return { $numberDecimal: value.trim() };
    case 'boolean':
      return value === 'true';
    case 'date':
      return { $date: value };
    case 'null':
      return null;
    case 'regex':
      return { $regex: value };
    case 'objectid':
      return { $oid: value };
    case 'array':
      try {
        return JSON.parse(value) as unknown;
      } catch {
        return [];
      }
    default:
      return value;
  }
}

function isEjsonWrapped(el: unknown, key: string): boolean {
  return typeof el === 'object' && el !== null && key in el;
}

function coerceArrayElement(el: unknown, valType: LegacyValType): unknown {
  switch (valType) {
    case 'objectid':
      return typeof el === 'string' ? { $oid: el } : el;
    case 'long':
      return isEjsonWrapped(el, '$numberLong') ? el : { $numberLong: String(el).trim() };
    case 'decimal':
      return isEjsonWrapped(el, '$numberDecimal') ? el : { $numberDecimal: String(el).trim() };
    case 'date':
      return typeof el === 'string' ? { $date: el } : el;
    case 'number':
      return typeof el === 'number' ? el : Number(el);
    case 'boolean':
      return typeof el === 'boolean' ? el : el === 'true';
    case 'string':
      return String(el);
    default:
      return el;
  }
}

function buildCondValue(cond: LegacyCond): unknown {
  const { op, value, valType } = cond;
  if (op === '$exists') return true;
  if (SIMPLE_OPS.has(op)) return buildTypedValue(cond);
  if (ARRAY_VALUE_OPS.has(op)) {
    return parseJsonArray(value).map((el) => coerceArrayElement(el, valType));
  }
  if (op === '$regex') return value;
  if (op === '$type') {
    const n = Number(value);
    return Number.isFinite(n) && value.trim() !== '' ? n : value;
  }
  if (op === '$mod') {
    const arr = parseJsonArray(value);
    return arr.length === 2 ? arr : [0, 0];
  }
  if (op === '$size' || BITS_OPS.has(op)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return buildTypedValue(cond);
}

function buildCondObject(cond: LegacyCond): Record<string, unknown> {
  return { [cond.field]: { [cond.op]: buildCondValue(cond) } };
}

/**
 * Pre-W13 filter compile: `state.conditions` + `state.logic` → an MQL
 * filter string. Mirrors `compileMql`'s filter half exactly (as of W13),
 * frozen — this is the only thing standing between a pre-`queryRaw` saved
 * find and `{}` once W13-5 deletes the live compiler's filter half.
 */
export function legacyCompileFilter(state: LegacyBuilderState): string {
  const activeConds = state.conditions.filter((c) => c.field.trim() !== '');

  let filter: unknown;
  if (activeConds.length === 0) {
    filter = {};
  } else if (activeConds.length === 1 && activeConds[0]) {
    filter = buildCondObject(activeConds[0]);
  } else {
    const op = state.logic === 'OR' ? '$or' : '$and';
    filter = { [op]: activeConds.map(buildCondObject) };
  }

  return JSON.stringify(filter);
}
