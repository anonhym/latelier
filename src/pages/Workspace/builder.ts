import type { BuilderState, CollectionTabState, MqlOp, ValType } from '@shared/types';
import { toDisplayValue, type DisplayType } from '../../utils/displayValue';
import { isEjsonDocument, isValidEjson } from '../../utils/ejson';
import {
  buildScalarWire,
  coerceArrayElementWire,
  parseJsonArrayLenient,
  type CondNode,
  type FilterNode,
} from './filterTree';
import { isRawProjection } from './projection';
import { ownGet, ownSet } from '../../utils/ownProperty';

export const FIELD_OPS: Record<ValType, MqlOp[]> = {
  string:   ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$regex', '$exists', '$type'],
  number:   ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$exists', '$type', '$mod',
             '$bitsAllClear', '$bitsAnyClear', '$bitsAllSet', '$bitsAnySet'],
  // $mod/$bits route through Number() coercion, which would reintroduce the
  // precision loss long/decimal exist to avoid — omitted deliberately.
  long:     ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$exists', '$type'],
  decimal:  ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$exists', '$type'],
  boolean:  ['$eq', '$ne', '$exists', '$type'],
  date:     ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$exists', '$type'],
  null:     ['$eq', '$ne', '$exists', '$type'],
  regex:    ['$regex', '$exists', '$type'],
  objectid: ['$eq', '$ne', '$in', '$nin', '$exists', '$type'],
  array:    ['$in', '$nin', '$all', '$exists', '$type', '$size'],
};

export function isApplicableOp(op: string, valType: ValType): boolean {
  return (FIELD_OPS[valType] as readonly string[]).includes(op);
}

export function valTypeFromDisplayType(dt: DisplayType | undefined): ValType {
  switch (dt) {
    case 'objectid': return 'objectid';
    case 'date':     return 'date';
    case 'long':     return 'long';
    case 'decimal':  return 'decimal';
    case 'number':   return 'number';
    case 'boolean':  return 'boolean';
    case 'null':     return 'null';
    case 'regex':    return 'regex';
    case 'array':    return 'array';
    default:         return 'string';
  }
}

/** Prefers the caller's current op if still applicable to the new valType. */
export function opForValType(valType: ValType, currentOp: string): MqlOp {
  const ops = FIELD_OPS[valType] ?? FIELD_OPS.string;
  if ((ops as readonly string[]).includes(currentOp)) return currentOp as MqlOp;
  return ops[0] ?? '$eq';
}

const SIMPLE_OPS = new Set<string>(['$eq', '$ne', '$gt', '$gte', '$lt', '$lte']);
const ARRAY_VALUE_OPS = new Set<string>(['$in', '$nin', '$all']);
const BITS_OPS = new Set<string>(['$bitsAllClear', '$bitsAnyClear', '$bitsAllSet', '$bitsAnySet']);

/** Ops the compiler can handle; others flag the row as needing raw JSON. */
export function isCompilableOp(op: string): boolean {
  return (
    SIMPLE_OPS.has(op) ||
    ARRAY_VALUE_OPS.has(op) ||
    BITS_OPS.has(op) ||
    op === '$exists' ||
    op === '$regex' ||
    op === '$type' ||
    op === '$mod' ||
    op === '$size'
  );
}

export type SortDir = 1 | -1;

function normalizeSortDir(v: unknown): SortDir | undefined {
  if (v === 1) return 1;
  if (v === -1) return -1;
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v > 0) return 1;
    if (v < 0) return -1;
    return undefined;
  }
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'asc' || s === 'ascending' || s === '1') return 1;
    if (s === 'desc' || s === 'descending' || s === '-1') return -1;
  }
  return undefined;
}

/** Parses `{"name":1,"age":-1}`. Unparseable/unmodeled shapes drop silently to `{}`. */
export function parseSortString(raw: string): Record<string, SortDir> {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, SortDir> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const dir = normalizeSortDir(v);
    if (dir !== undefined) ownSet(out, k, dir);
  }
  return out;
}

/** not-present → asc → desc → cleared; replaces any existing multi-field sort. */
export function cycleSortField(currentRaw: string, field: string): string {
  const current = parseSortString(currentRaw);
  const dir = ownGet(current, field);
  if (dir === undefined) return JSON.stringify({ [field]: 1 });
  if (dir === 1) return JSON.stringify({ [field]: -1 });
  return '';
}

export function sortFieldPatch(
  state: CollectionTabState,
  field: string,
): Partial<CollectionTabState> {
  const builder = { ...state.builder, sort: cycleSortField(state.builder.sort, field) };
  return { builder };
}

export interface CompiledFindOptions {
  sort?: string;
  projection?: string;
  limit: number | null;
}

export function compileFindOptions(state: BuilderState): CompiledFindOptions {
  let sort: string | undefined;
  if (state.sort.trim()) {
    sort = state.sort.trim();
  }

  let projection: string | undefined;
  const raw = state.projectionRaw?.trim();
  if (raw) {
    // Used verbatim, unvalidated — projectionProblem is the gate. Falling
    // back to undefined here would silently return every field instead.
    projection = raw;
  } else if (state.projection.length > 0) {
    const projObj: Record<string, number> = { _id: 1 };
    for (const f of state.projection) {
      ownSet(projObj, f, 1);
    }
    projection = JSON.stringify(projObj);
  }

  // Mongo treats `.limit(0)` as unlimited; collapse non-finite/zero/negative to null.
  const parsedLimit = state.limit.trim() ? Number.parseInt(state.limit.trim(), 10) : null;
  const limit =
    parsedLimit !== null && Number.isFinite(parsedLimit) && parsedLimit > 0
      ? parsedLimit
      : null;

  return { sort, projection, limit };
}

/** Shared by the Run button and useQueryRunner so sort-validity can't drift between them. */
export function sortProblem(raw: string): string | null {
  if (raw.trim() === '') return null;
  if (!isValidEjson(raw)) return "Can't parse this sort. Expected EJSON like { field: 1 }.";
  if (!isEjsonDocument(raw)) return 'A sort must be a document, like { field: 1 }.';
  return null;
}

export type SortClass =
  | 'none'
  | 'mapped'
  | 'partial'
  | 'hidden'
  | 'absent'
  | 'unrepresentable'
  | 'invalid';

/**
 * How much of a sort string the table header's per-column arrows can draw.
 * `shownFields`/`schemaFields` distinguish "hidden" (unhide the column) from
 * "absent" (no column could show it) from "unrepresentable" (no key mapped).
 */
export function classifySort(
  raw: string,
  shownFields?: ReadonlySet<string>,
  schemaFields?: ReadonlySet<string>,
): SortClass {
  if ((raw ?? '').trim() === '') return 'none';
  if (sortProblem(raw) !== null) return 'invalid';
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'invalid';
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'unrepresentable';
  const total = Object.keys(parsed).length;
  if (total === 0) return 'none';
  const mapped = Object.keys(parseSortString(raw));
  const drawn = shownFields ? mapped.filter((k) => shownFields.has(k)).length : mapped.length;
  if (drawn === 0) {
    if (mapped.length === 0) return 'unrepresentable';
    if (!schemaFields) return 'hidden';
    return mapped.some((k) => schemaFields.has(k)) ? 'hidden' : 'absent';
  }
  return drawn === total ? 'mapped' : 'partial';
}

/** `0`/`-3`/`abc` compile to no-limit; `5xyz` compiles to `5` (parseInt stops at the junk). */
export function limitWarning(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return `"${text}" is not a positive number — running with no limit.`;
  }
  if (String(parsed) !== text) {
    return `Running with limit ${parsed} — the rest of "${text}" is ignored.`;
  }
  return null;
}

export function projectionProblem(state: BuilderState): string | null {
  const raw = state.projectionRaw?.trim();
  if (!raw || isRawProjection(raw)) return null;
  return 'Can\'t parse this projection. Expected EJSON like { "_id": 0 }.';
}

/** First unrunnable clause of the query, or null. Order matches the command's clause order. */
export function findProblem(state: CollectionTabState): string | null {
  return (
    filterProblem(state.queryRaw) ??
    sortProblem(state.builder.sort) ??
    projectionProblem(state.builder)
  );
}

export function filterProblem(queryRaw: string): string | null {
  if (!isValidEjson(queryRaw)) {
    return 'Can\'t parse this filter. Expected EJSON like { "status": "active" }.';
  }
  if (!isEjsonDocument(queryRaw)) {
    return 'A filter must be a document, like { "status": "active" }.';
  }
  return null;
}

/** True at the "no filter, default sort/limit/projection" starting point — gates auto-run-on-open. */
export function isDefaultQueryState(state: CollectionTabState): boolean {
  const filter = state.queryRaw.trim();
  const isDefaultFilter = filter === '' || filter === '{}';
  return (
    isDefaultFilter &&
    state.builder.sort === '' &&
    state.builder.limit === '' &&
    state.builder.projection.length === 0 &&
    !state.builder.projectionRaw?.trim()
  );
}

/**
 * The filter a tab's `run()` would actually send right now, or `null` if
 * none is runnable. Callers MUST NOT widen `null` to `{}` — delete-all reads
 * this to decide whether it has a filter to act on at all.
 */
export function currentFilterJson(state: CollectionTabState): string | null {
  const raw = state.queryRaw.trim();
  if (raw === '' || !isEjsonDocument(raw)) return null;
  return raw;
}

/**
 * True when an empty result is because the collection itself is empty
 * rather than because the committed filter matched nothing: no filter, on
 * the first page, and the run didn't error. `ResultViewer`'s `EmptyState`
 * uses this to decide between "This collection is empty" (with an Import
 * CTA) and "No matching documents".
 */
export function isUnfilteredFirstPage(state: CollectionTabState): boolean {
  const filter = state.queryRaw.trim();
  return (filter === '' || filter === '{}') && state.page === 0 && !state.lastRun?.error;
}

/**
 * `{ skip, limit }` for one page, treating `userLimit` as a hard cap across
 * pages. Past the cap `limit` is `0` — callers MUST short-circuit rather than
 * send that to Mongo, which reads `limit: 0` as unlimited.
 */
export function effectivePageLimit(
  userLimit: number | null,
  page: number,
  pageSize: number,
): { skip: number; limit: number } {
  const skip = page * pageSize;
  if (userLimit === null) return { skip, limit: pageSize };
  const remaining = Math.max(0, userLimit - skip);
  return { skip, limit: Math.min(pageSize, remaining) };
}

export const DRAGGED_FIELD_MIME = 'application/x-atelier-field';

export interface DraggedField {
  field: string;
  value: unknown;
}

/** Builds a `$eq` CondNode from a dragged field/value, inferring ValType from the value's shape. */
export function condFromDragged(dragged: DraggedField): CondNode {
  const { field, value } = dragged;
  const dv = toDisplayValue(value);
  const valType = valTypeFromDisplayType(dv.type);

  let valueStr: string;
  if (valType === 'null') {
    valueStr = '';
  } else if (
    valType === 'objectid' ||
    valType === 'date' ||
    valType === 'number' ||
    valType === 'long' ||
    valType === 'decimal'
  ) {
    valueStr = dv.display;
  } else if (valType === 'boolean') {
    valueStr = String(value);
  } else if (valType === 'regex' && value && typeof value === 'object' && '$regex' in value) {
    const r = (value as Record<string, unknown>).$regex;
    valueStr = typeof r === 'string' ? r : '';
  } else if (valType === 'array') {
    valueStr = JSON.stringify(value);
  } else if (typeof value === 'string') {
    valueStr = value;
  } else {
    valueStr = JSON.stringify(value);
  }

  return { kind: 'cond', field, op: '$eq', valType, value: valueStr };
}

/** Ops a drop onto an existing cond row can merge into, rather than replace. */
const MERGEABLE_DROP_OPS = new Set<string>(['$eq', '$in', '$nin']);

function isJsonArray(raw: string): boolean {
  try {
    return Array.isArray(JSON.parse(raw));
  } catch {
    return false;
  }
}

/**
 * Drop onto an existing row: same field + mergeable op extends it as an
 * `$in`/`$nin` list (values normalized via buildScalarWire/coerceArrayElementWire,
 * duplicates skipped); anything else falls back to `condFromDragged`'s replace.
 */
export function mergeOrReplaceDragged(target: FilterNode, dragged: DraggedField): CondNode {
  if (target.kind !== 'cond' || target.field !== dragged.field || !MERGEABLE_DROP_OPS.has(target.op)) {
    return condFromDragged(dragged);
  }
  if (target.op !== '$eq' && !isJsonArray(target.value)) {
    return condFromDragged(dragged);
  }

  const fresh = condFromDragged(dragged);
  const newElement = buildScalarWire(fresh.valType, fresh.value);

  const current: unknown[] =
    target.op === '$eq'
      ? [buildScalarWire(target.valType, target.value)]
      : parseJsonArrayLenient(target.value).map((el) =>
          target.valType === 'array' ? el : coerceArrayElementWire(el, target.valType),
        );

  // Unparsable "number" text silently becomes NaN → JSON.stringify → null;
  // fall back to replace rather than merge a corrupted value into the list.
  if (target.valType === 'number' && current.some((el) => typeof el !== 'number' || !Number.isFinite(el))) {
    return condFromDragged(dragged);
  }

  const alreadyPresent = current.some((el) => JSON.stringify(el) === JSON.stringify(newElement));
  const nextArray = alreadyPresent ? current : [...current, newElement];

  return {
    kind: 'cond',
    field: target.field,
    op: target.op === '$nin' ? '$nin' : '$in',
    valType: 'array',
    value: JSON.stringify(nextArray),
  };
}

export function emptyBuilder(): BuilderState {
  return {
    projection: [],
    sort: '',
    limit: '',
  };
}
