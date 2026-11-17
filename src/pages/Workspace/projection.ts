// Formatting / parsing for the Fields control's projection input. Lives
// outside FieldsControl.tsx so the helpers can be unit-tested without
// bundling React, and so that module stays single-export-component for
// fast-refresh.

import { ejsonParse, isEjsonDocument } from '../../utils/ejson';
import type { BuilderState } from '@shared/types';
import { isRecord } from '../../utils/displayValue';
import { ownSet } from '../../utils/ownProperty';

export function formatProjection(projection: string[]): string {
  if (projection.length === 0) return '';
  return `{ ${projection.map((f) => `${f}: 1`).join(', ')} }`;
}

// Why a projection was refused. The two causes call for different user
// actions, so the Fields control can say which one happened (W14 §3):
//   - 'malformed'   — the text isn't a projection at all; fix the text.
//   - 'unmodelable' — a real projection BuilderState can't express (an
//                     exclusion, `$slice`). That is no longer a
//                     dead end: `isRawProjection` below decides whether the
//                     same text can go to the driver verbatim instead.
export type ProjectionFailure = 'malformed' | 'unmodelable';

export type ProjectionParse =
  | { ok: true; fields: string[] }
  | { ok: false; reason: ProjectionFailure };

// Accepts strict JSON `{"a":1,"b":1}`, mongo-shell `{a: 1, b: 1}`, or bare
// comma lists `a, b, c`. Refuses — rather than parsing lossily — anything
// with an explicit non-inclusion value (e.g. `{a: 0}`, `{a: false}`,
// `$slice`), so the caller keeps the user's draft text instead of silently
// dropping fields. BuilderState.projection only models inclusions.
export function parseProjection(text: string): ProjectionParse {
  // Blank needs no early return: `JSON.parse('')` throws, and the lenient
  // path below strips it to nothing and answers "no projection".
  const t = text.trim();
  try {
    const obj = JSON.parse(t) as unknown;
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const fields: string[] = [];
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        // Valid JSON, so whatever the value is it was typed deliberately —
        // 0 / false / {$slice} are projections we can't model, not typos.
        if (v !== 1 && v !== true) return { ok: false, reason: 'unmodelable' };
        fields.push(k);
      }
      return { ok: true, fields };
    }
  } catch {
    // Fall through to lenient parsing.
  }
  // Stryker disable next-line MethodExpression: dropping this .trim() is unobservable — `t` is already outer-trimmed, so the only string shaped "{" + whitespace + "}" is valid empty-object JSON handled above, and every per-field token gets its own .trim() in the split loop below (fuzzed 200k random {}/whitespace/field strings against both versions with zero diffs)
  const stripped = t.replace(/^\{|\}$/g, '').trim();
  if (!stripped) return { ok: true, fields: [] };
  const fields: string[] = [];
  for (const part of stripped.split(',')) {
    const [rawK, rawV] = part.split(':').map((s) => s.trim());
    if (!rawK) continue;
    const k = rawK.replace(/^["']|["']$/g, '');
    if (rawV === undefined || rawV === '1' || rawV === 'true') {
      fields.push(k);
    } else if (rawV === '') {
      // `{a: }` — a colon with nothing after it is a half-typed field, not a
      // projection this editor can't model.
      return { ok: false, reason: 'malformed' };
    } else {
      return { ok: false, reason: 'unmodelable' };
    }
  }
  // Nothing survived (`,,,`): not a field list by any reading.
  return fields.length > 0 ? { ok: true, fields } : { ok: false, reason: 'malformed' };
}

/**
 * W15 §2.1/§2.2 — can this text be a `builder.projectionRaw`?
 *
 * The escape hatch for everything the inclusion model refuses: `{"_id": 0}`,
 * `$slice`, mixed documents. The bar is exactly the filter's — it must parse
 * as an EJSON *document* — so the two raw fields have one rule between them
 * rather than two, and a raw projection is never stored in a state the driver
 * would reject. Arrays and scalars are out: `find` takes a document.
 *
 * "One rule between them" is now literal — the shape test was lifted into
 * `isEjsonDocument`, which `sortProblem` calls too.
 */
export function isRawProjection(text: string): boolean {
  return isEjsonDocument(text);
}

// `0`, `false`, or a boxed numeric zero (`{"$numberInt": "0"}` revives to an
// Int32) — the values that drop a field. A plain object's `valueOf` is itself,
// and a null-prototype one is not an `Object` instance, so neither matches.
export function isExclusion(v: unknown): boolean {
  return v === false || ((typeof v === 'number' || v instanceof Object) && v.valueOf() === 0);
}

// `{a: {$slice: n}}` trims an array but decides nothing about which fields
// come back, so it counts toward neither mode.
export function isSliceOnly(v: unknown): boolean {
  // A primitive has no own keys, so only `null` needs keeping away from
  // `Object.keys`, which throws on it.
  // Stryker disable next-line ArrayDeclaration: the null branch's array content only matters through `keys[0] === '$slice'` below, and no mutant literal is ever the string '$slice'
  const keys = v === null ? [] : Object.keys(v as object);
  return keys.length === 1 && keys[0] === '$slice';
}

// `1`, `true`, or a boxed numeric one: the plain "keep this field" values.
// Together with `isExclusion` these are the flags; anything else (`$slice`,
// `$elemMatch`, `$meta`, an expression) is an operator whose value only the
// projection text can edit.
export function isPlainKeep(v: unknown): boolean {
  return v === true || ((typeof v === 'number' || v instanceof Object) && v.valueOf() === 1);
}

export interface ProjectionClass {
  /** Keys whose value drops the field (`0`, `false`). */
  excluded: string[];
  /** Keys that name a field to return, leaving out the exclusions and `$slice`-only trims. */
  included: string[];
  /** Whether the projection returns only the named fields rather than everything but them. */
  inclusion: boolean;
}

/**
 * The one reading of a projection's entries, shared by `notFetchedFields` and
 * `projectionMode` so the Fields control and the views cannot disagree about
 * which fields a projection returns. `{_id: 1}` alone is an inclusion, and
 * `{_id: 0}` alone an exclusion; a `$slice`-only trim is neither.
 */
export function classifyProjection(entries: readonly (readonly [string, unknown])[]): ProjectionClass {
  const excluded = entries.filter(([, v]) => isExclusion(v)).map(([k]) => k);
  const included = entries.filter(([, v]) => !isExclusion(v) && !isSliceOnly(v)).map(([k]) => k);
  const inclusion = included.some((k) => k !== '_id') || (included.length > 0 && excluded.length === 0);
  return { excluded, included, inclusion };
}

export type ProjectionMode = 'none' | 'inclusion' | 'exclusion' | 'invalid';

export interface ProjectionInfo {
  mode: ProjectionMode;
  /** The projection's top-level entries in the order they are written; empty for `invalid`. */
  entries: [string, unknown][];
  /** Fields whose value is an operator or expression, not a 0/1 flag. */
  locked: string[];
}

/**
 * Classifies the committed projection (W14 §11.3). `invalid` is a raw
 * projection the app cannot read, which the list must leave alone rather than
 * overwrite. A `$slice`-only projection is `none`, with its row locked.
 */
export function projectionMode(builder: BuilderState): ProjectionInfo {
  const raw = builder.projectionRaw?.trim();
  if (raw && !isRawProjection(raw)) return { mode: 'invalid', entries: [], locked: [] };
  const entries: [string, unknown][] = raw
    ? Object.entries(ejsonParse<Record<string, unknown>>(raw))
    : builder.projection.map((f): [string, unknown] => [f, 1]);
  const { excluded, inclusion } = classifyProjection(entries);
  const mode: ProjectionMode = inclusion ? 'inclusion' : excluded.length > 0 ? 'exclusion' : 'none';
  const locked = entries.filter(([, v]) => !isPlainKeep(v) && !isExclusion(v)).map(([k]) => k);
  return { mode, entries, locked };
}

export type FieldHider = (key: string) => boolean;

// The key itself and every dotted ancestor: `a.b.c` is covered by `a.b` and `a`.
export function selfAndAncestors(key: string): string[] {
  const parts = key.split('.');
  return parts.map((_, i) => parts.slice(0, i + 1).join('.'));
}

interface FetchRule {
  /** True for a top-level name the projection keeps off the wire. */
  hide: FieldHider;
  /** Top-level names an exclusion drops by name, whether or not anything holds them. */
  named: string[];
}

// The one rule behind `notFetchedFields` and `projectionHider`. Null when the
// projection keeps nothing off the wire or cannot be read.
function fetchRule(builder: BuilderState): FetchRule | null {
  // A projection the app cannot read has no entries, so it falls through to null.
  const { entries } = projectionMode(builder);
  const { excluded, inclusion } = classifyProjection(entries);
  if (inclusion) {
    // The modelled path's `_id: 1` (`compileFindOptions` sends it) needs no entry:
    // an inclusion keeps `_id` unless it is excluded.
    const fetched = new Set(entries.filter(([, v]) => !isExclusion(v)).map(([k]) => k.split('.')[0]));
    if (!excluded.includes('_id')) fetched.add('_id');
    return { hide: (key) => !fetched.has(key), named: [] };
  }
  // A dotted exclusion (`"a.b": 0`) trims inside `a` and never drops `a` itself.
  const named = excluded.filter((k) => !k.includes('.'));
  if (named.length === 0) return null;
  return { hide: (key) => named.includes(key), named };
}

/**
 * Which top-level fields the committed projection keeps the server from
 * returning, so the Fields control can name them "not fetched" instead of
 * letting them vanish from the list.
 *
 * `known` is every top-level name the caller can vouch for without asking
 * the server. An inclusion projection names what comes back, so its
 * complement is only as complete as `known`; an exclusion names what does
 * not, so its own top-level keys are reported whether or not `known` has
 * them. A dotted exclusion (`"a.b": 0`) trims inside `a` and never drops
 * `a` itself. A raw projection the app cannot read reports nothing —
 * `projectionProblem` is what speaks for that one.
 */
export function notFetchedFields(builder: BuilderState, known: readonly string[]): string[] {
  const rule = fetchRule(builder);
  if (!rule) return [];
  return [...known.filter(rule.hide), ...rule.named.filter((k) => !known.includes(k))];
}

/**
 * The known fields a view must not draw because the committed projection keeps
 * them off the wire (W14 §11.4). Takes an optional builder so a surface that
 * has none (a script tab's result views) hides nothing instead of crashing.
 */
export function projectedOutFields(
  builder: BuilderState | undefined,
  known: readonly string[],
  leftover: readonly string[] = [],
): string[] {
  const out = builder ? notFetchedFields(builder, known).filter((f) => known.includes(f)) : [];
  return [...out, ...leftover.filter((f) => known.includes(f) && !out.includes(f))];
}

/**
 * Whether a document's top-level key is kept off the wire by the committed
 * projection, for display only; null when nothing is. Answers for any key, so a
 * view that redacts each document does not depend on the 50-document sample the
 * column list is derived from: an exclusion hides its named fields wherever
 * they turn up, and an inclusion hides every key it does not fetch.
 * `leftover` is a saved tab's hidden list the migration could not write into
 * the projection (an operator stood in the way): those stay hidden until the
 * projection can say so itself.
 */
export function projectionHider(
  builder: BuilderState | undefined,
  leftover: readonly string[] = [],
): FieldHider | null {
  const hide = builder ? (fetchRule(builder)?.hide ?? null) : null;
  if (leftover.length === 0) return hide;
  return (key) => leftover.includes(key) || (hide?.(key) ?? false);
}

/**
 * The names `hide` takes out of the documents in hand, each once. Scans every
 * document: the JSON view's "N fields hidden" note and the Tree's preview list
 * are only right if a field first seen on a late row counts too.
 */
export function hiddenFieldNames(documents: readonly unknown[], hide: FieldHider | null): string[] {
  if (!hide) return [];
  const names = new Set<string>();
  for (const doc of documents) {
    if (!isRecord(doc)) continue;
    for (const key of Object.keys(doc)) if (hide(key)) names.add(key);
  }
  return [...names];
}

/**
 * Whether the committed projection keeps a dotted path off the wire, for a
 * column that reads into the documents (a computed column). An exclusion
 * drops the path and everything under it; an inclusion drops what none of its
 * entries covers. A path above a kept entry is only partly returned, so it
 * stays. Null when nothing is dropped.
 */
export function projectionPathHider(builder: BuilderState | undefined): FieldHider | null {
  if (!builder) return null;
  // A projection the app cannot read has no entries, so it falls through to null.
  const { entries } = projectionMode(builder);
  const { excluded, inclusion } = classifyProjection(entries);
  if (!inclusion) {
    if (excluded.length === 0) return null;
    return (path) => selfAndAncestors(path).some((p) => excluded.includes(p));
  }
  const kept = entries.filter(([, v]) => !isExclusion(v)).map(([k]) => k);
  const idOut = excluded.includes('_id');
  return (path) => {
    if (path.split('.')[0] === '_id') return idOut;
    return !kept.some((k) => path === k || path.startsWith(`${k}.`) || k.startsWith(`${path}.`));
  };
}

/**
 * A copy of `doc` without the top-level fields `hide` names, for display only.
 * Every action on the document (Copy, Edit, Delete) is handed the original,
 * never this copy: hiding a field must not change what is sent to Mongo or the
 * clipboard. Only top-level paths are handled.
 */
export function redactHidden(doc: unknown, hide: FieldHider | null): unknown {
  if (!hide || !isRecord(doc)) return doc;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    // A plain assignment to `__proto__` would hit the prototype setter and
    // drop a document's own field of that name.
    if (!hide(key)) ownSet(out, key, value);
  }
  return out;
}
