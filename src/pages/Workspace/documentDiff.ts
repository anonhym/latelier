import { ejsonParse, ejsonStringify, isPlainDocument } from '../../utils/ejson';
import { SELECTABLE_KINDS, kindOf, textOf, typeLabel, zeroValue } from './documentFieldTypes';

/**
 * The Document Editor's save, as pure functions (W18 §5, ADR 0012).
 *
 * Every function here takes *revived* documents — `ejsonParse` output, with
 * BSON values as live `Int32`/`ObjectId`/`Date` instances — so equality and
 * the wire format both go through `ejsonStringify` and a type change is a
 * change.
 */

type Doc = Record<string, unknown>;

export interface DocDiff {
  /** Dotted path → the draft's value at that path. */
  set: Record<string, unknown>;
  unset: string[];
}

export interface UpdateRequest {
  /** `_id` plus one compare-and-set guard per changed path. */
  filterJson: string;
  /** `_id` alone — the Overwrite path, which skips the guards. */
  idFilterJson: string;
  updateJson: string;
}

/**
 * A field name no update path can address: a `.` would be read as nesting, a
 * leading `$` as an operator, and an empty name leaves an empty segment.
 */
export function isUnsafeFieldName(name: string): boolean {
  return name === '' || name.includes('.') || name.startsWith('$');
}

/** Null-prototype, so a field named `__proto__` stays an ordinary key. */
function emptyDiff(): DocDiff {
  return { set: Object.create(null) as Record<string, unknown>, unset: [] };
}

function same(a: unknown, b: unknown): boolean {
  return ejsonStringify(a) === ejsonStringify(b);
}

function has(doc: Doc, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(doc, key);
}

/**
 * Diffs one sub-document level into `out`. Returns false, writing nothing,
 * when a change sits under a name no path can address, so the caller sends
 * this whole level instead.
 */
function diffLevel(a: Doc, b: Doc, prefix: string, out: DocDiff): boolean {
  const local = emptyDiff();
  for (const key of Object.keys(b)) {
    const path = prefix + key;
    if (has(a, key) && same(a[key], b[key])) continue;
    if (isUnsafeFieldName(key)) return false;
    if (!has(a, key) || !diffNested(a[key], b[key], path, local)) local.set[path] = b[key];
  }
  for (const key of Object.keys(a)) {
    if (has(b, key)) continue;
    if (isUnsafeFieldName(key)) return false;
    local.unset.push(prefix + key);
  }
  Object.assign(out.set, local.set);
  out.unset.push(...local.unset);
  return true;
}

/** Recurses when both sides are sub-documents; false means "send it whole". */
function diffNested(a: unknown, b: unknown, path: string, out: DocDiff): boolean {
  if (!isPlainDocument(a) || !isPlainDocument(b)) return false;
  return diffLevel(a as Doc, b as Doc, `${path}.`, out);
}

/**
 * What saving `draft` over `original` has to send. Nested changes come out as
 * dotted paths, arrays whole, and `_id` never. A top-level field has no
 * ancestor to fall back to, so an unsafe top-level name is emitted as-is;
 * `buildUpdateRequest` refuses it.
 */
export function diff(original: Doc, draft: Doc): DocDiff {
  const out = emptyDiff();
  for (const key of Object.keys(draft)) {
    if (key === '_id') continue;
    if (has(original, key) && same(original[key], draft[key])) continue;
    if (!has(original, key) || !diffNested(original[key], draft[key], key, out)) {
      out.set[key] = draft[key];
    }
  }
  for (const key of Object.keys(original)) {
    if (key !== '_id' && !has(draft, key)) out.unset.push(key);
  }
  return out;
}

export function isEmptyDiff(d: DocDiff): boolean {
  return Object.keys(d.set).length === 0 && d.unset.length === 0;
}

/** Is `field` (a top-level name) or anything under it in the diff? */
export function isEdited(d: DocDiff, field: string): boolean {
  const under = (p: string) => p === field || p.startsWith(`${field}.`);
  return Object.keys(d.set).some(under) || d.unset.some(under);
}

/** Own-property write that a `__proto__` key cannot turn into a prototype swap. */
function put(doc: Doc, key: string, value: unknown): void {
  Object.defineProperty(doc, key, { value, enumerable: true, writable: true, configurable: true });
}

function clone(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(clone);
  if (!isPlainDocument(v)) return v;
  const out: Doc = Object.create(null) as Doc;
  for (const [k, child] of Object.entries(v as Doc)) put(out, k, clone(child));
  return out;
}

/**
 * `{ $set, $unset }` applied to `doc`, the way the server applies it — the
 * inverse of `diff`, and what Reload uses to carry the user's edits onto a
 * fresh copy. Missing intermediate documents are created.
 */
export function applyDiff(doc: Doc, d: DocDiff): Doc {
  const out = clone(doc) as Doc;
  for (const [path, value] of Object.entries(d.set)) {
    const parts = path.split('.');
    const leaf = parts.pop()!;
    let node = out;
    for (const part of parts) {
      if (!has(node, part) || !isPlainDocument(node[part])) put(node, part, Object.create(null));
      node = node[part] as Doc;
    }
    put(node, leaf, clone(value));
  }
  for (const path of d.unset) {
    const parts = path.split('.');
    const leaf = parts.pop()!;
    let node: unknown = out;
    for (const part of parts) node = isPlainDocument(node) ? (node as Doc)[part] : undefined;
    if (isPlainDocument(node)) delete (node as Doc)[leaf];
  }
  return out;
}

/** The value at a dotted path, or null when the path isn't there. */
function lookup(doc: Doc, path: string): { value: unknown } | null {
  return getAtSegments(doc, path.split('.'));
}

/**
 * Segment-addressed counterparts of `lookup`/`applyDiff`'s path walk, for
 * the Fields view: a segment is one literal object key, however it's
 * spelled, so a field named `a.b` is one segment and never mistaken for
 * nesting. When the node being walked is an array, a segment is instead its
 * decimal index (`'0'`, `'1'`, …) — an element row's address (W18, arrays as
 * expandable element rows). `applyDiff` keeps its own dotted-string walk
 * unchanged — its paths always come out of `diff`, which sends an array
 * whole rather than by index, so splitting them on `.` never has to cross
 * one.
 */

/** A segment that addresses an array element: `'0'`, `'1'`, … — no leading zeros. */
export function arrayIndexOf(segment: string): number | null {
  return /^(0|[1-9]\d*)$/.test(segment) ? Number(segment) : null;
}

export function getAtSegments(doc: Doc, path: readonly string[]): { value: unknown } | null {
  let node: unknown = doc;
  for (const part of path) {
    if (Array.isArray(node)) {
      const idx = arrayIndexOf(part);
      if (idx === null || idx >= node.length) return null;
      node = node[idx];
    } else if (isPlainDocument(node) && has(node as Doc, part)) {
      node = (node as Doc)[part];
    } else {
      return null;
    }
  }
  return { value: node };
}

/**
 * `doc` with `value` written at `path`, creating missing intermediate
 * objects. An array along the way is never turned into an object — its
 * element is written (or, at exactly its current length, appended) in
 * place — and a missing intermediate object is still created the same way
 * `setAtSegments` always has. Never mutates `doc`.
 */
export function setAtSegments(doc: Doc, path: readonly string[], value: unknown): Doc {
  if (path.length === 0) throw new Error('setAtSegments needs at least one path segment');
  const out = clone(doc) as Doc;
  const parts = [...path];
  const leaf = parts.pop()!;
  let node: Doc | unknown[] = out;
  for (const part of parts) {
    if (Array.isArray(node)) {
      const idx = arrayIndexOf(part);
      if (idx === null || idx >= node.length) throw new Error(`setAtSegments: array index "${part}" out of range`);
      if (!isPlainDocument(node[idx]) && !Array.isArray(node[idx])) node[idx] = Object.create(null) as Doc;
      node = node[idx] as Doc | unknown[];
    } else {
      const child = (node as Doc)[part];
      if (!has(node as Doc, part) || (!isPlainDocument(child) && !Array.isArray(child))) {
        put(node as Doc, part, Object.create(null));
      }
      node = (node as Doc)[part] as Doc | unknown[];
    }
  }
  if (Array.isArray(node)) {
    const idx = arrayIndexOf(leaf);
    if (idx === null || idx > node.length) throw new Error(`setAtSegments: array index "${leaf}" out of range`);
    node[idx] = clone(value);
  } else {
    put(node, leaf, clone(value));
  }
  return out;
}

/**
 * `doc` with `path` removed. A missing intermediate object is a no-op; an
 * array element is spliced out, shifting later indices down. Never mutates
 * `doc`.
 */
export function deleteAtSegments(doc: Doc, path: readonly string[]): Doc {
  if (path.length === 0) throw new Error('deleteAtSegments needs at least one path segment');
  const out = clone(doc) as Doc;
  const parts = [...path];
  const leaf = parts.pop()!;
  let node: unknown = out;
  for (const part of parts) {
    if (Array.isArray(node)) {
      // Past the end reads `undefined` on its own; `-1` does the same for a
      // segment that isn't an index at all.
      node = node[arrayIndexOf(part) ?? -1];
    } else {
      node = isPlainDocument(node) ? (node as Doc)[part] : undefined;
    }
  }
  if (Array.isArray(node)) {
    // `splice` past the end is already a no-op, but `splice(null, 1)` would
    // remove element 0 — so only the not-an-index case needs refusing.
    const idx = arrayIndexOf(leaf);
    if (idx !== null) node.splice(idx, 1);
  } else if (isPlainDocument(node)) {
    delete (node as Doc)[leaf];
  }
  return out;
}

/**
 * The compare-and-set `updateOne` for saving `draft` over `original`, or
 * null when nothing changed and nothing should be sent.
 *
 * Guards come from `original`, never the draft: a path that existed must
 * still hold its loaded value, and an added one must still be absent. `$eq`
 * rather than a bare value, so a loaded regex is compared as a value instead
 * of being run as a pattern.
 */
export function buildUpdateRequest(original: Doc, draft: Doc): UpdateRequest | null {
  if (original._id === undefined) throw new Error('Cannot edit a document without an _id');
  for (const key of new Set([...Object.keys(original), ...Object.keys(draft)])) {
    if (isUnsafeFieldName(key) && !(has(original, key) && has(draft, key) && same(original[key], draft[key]))) {
      throw new Error(`The field "${key}" cannot be saved from here: its name is not a valid update path`);
    }
  }
  const d = diff(original, draft);
  if (isEmptyDiff(d)) return null;

  const filter: Doc = { _id: original._id };
  for (const path of [...Object.keys(d.set), ...d.unset]) {
    const loaded = lookup(original, path);
    put(filter, path, loaded ? { $eq: loaded.value } : { $exists: false });
  }
  const update: Doc = {};
  if (Object.keys(d.set).length > 0) update.$set = d.set;
  if (d.unset.length > 0) update.$unset = Object.fromEntries(d.unset.map((p) => [p, '']));
  return {
    filterJson: ejsonStringify(filter),
    idFilterJson: ejsonStringify({ _id: original._id }),
    updateJson: ejsonStringify(update),
  };
}

/** One line of the change strip (W18 §13.2): a path `diff` would send, and what it does to the value. */
export interface ChangeEntry {
  path: string;
  kind: 'changed' | 'added' | 'removed';
  before?: unknown;
  after?: unknown;
  /** Set when the value's BSON type differs from what was loaded. */
  typeChange?: { from: string; to: string; cleared: boolean };
}

function typeChangeOf(before: unknown, after: unknown): ChangeEntry['typeChange'] {
  const from = kindOf(before);
  const to = kindOf(after);
  if (from === to) return undefined;
  // "Cleared" is read off the values, not replayed from the selector: the
  // new value is the type's zero and prints differently from the old one.
  // ponytail: a user who then types the zero value by hand still reads "cleared".
  const cleared =
    from !== 'null' &&
    SELECTABLE_KINDS.includes(to as (typeof SELECTABLE_KINDS)[number]) &&
    same(after, zeroValue(to as (typeof SELECTABLE_KINDS)[number])) &&
    textOf(from, before) !== textOf(to, after);
  return { from: typeLabel(from, before), to: typeLabel(to, after), cleared };
}

/**
 * What Save will send, one entry per path of `diff(original, draft)` — built
 * from that same diff so the list and the write cannot disagree.
 */
export function changeList(original: Doc, draft: Doc): ChangeEntry[] {
  const d = diff(original, draft);
  const entries: ChangeEntry[] = [];
  for (const [path, after] of Object.entries(d.set)) {
    const before = lookup(original, path);
    entries.push(
      before
        ? { path, kind: 'changed', before: before.value, after, typeChange: typeChangeOf(before.value, after) }
        : { path, kind: 'added', after },
    );
  }
  for (const path of d.unset) entries.push({ path, kind: 'removed', before: lookup(original, path)?.value });
  return entries;
}

/** Two update paths clash when they are the same or one sits under the other. */
function touches(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
}

export type ChangedBy = 'both' | 'yours' | 'theirs';

export interface ConflictRow {
  path: string;
  /** The draft's value at `path`; null when it is absent there. */
  yours: { value: unknown } | null;
  /** The server's current value at `path`; null when it is absent there. */
  theirs: { value: unknown } | null;
  changedBy: ChangedBy;
}

/**
 * W18 §13.3: every path the user or the server changed since `original`.
 * `both` = the same path (or one under the other) changed on both sides to
 * different values — the only rows that need a choice. A path the user and
 * the server changed to the same value is `yours`: nothing to decide.
 */
export function classifyConflict(original: Doc, draft: Doc, server: Doc): ConflictRow[] {
  const pathsOf = (d: DocDiff) => [...Object.keys(d.set), ...d.unset];
  const mine = pathsOf(diff(original, draft));
  const theirs = pathsOf(diff(original, server));
  const row = (path: string, changedBy: ChangedBy): ConflictRow => ({
    path,
    yours: lookup(draft, path),
    theirs: lookup(server, path),
    changedBy,
  });
  const rows: ConflictRow[] = [];
  for (const p of mine) {
    const clash = theirs.some((t) => touches(p, t));
    const r = row(p, 'yours');
    const differs = !r.yours || !r.theirs || !same(r.yours.value, r.theirs.value);
    rows.push(clash && differs ? { ...r, changedBy: 'both' } : r);
  }
  for (const t of theirs) if (!mine.some((p) => touches(p, t))) rows.push(row(t, 'theirs'));
  return rows;
}

/**
 * The draft to save over `server` once the conflict is decided: the user's
 * diff, minus every `both` path the user gave to the server. The caller makes
 * `server` the new `original`, so the guards are fresh.
 */
export function resolveConflict(
  original: Doc,
  draft: Doc,
  server: Doc,
  choices: ReadonlyMap<string, 'mine' | 'theirs'>,
): Doc {
  const taken = new Set(
    classifyConflict(original, draft, server)
      .filter((r) => r.changedBy === 'both' && choices.get(r.path) === 'theirs')
      .map((r) => r.path),
  );
  const d = diff(original, draft);
  const set = emptyDiff().set;
  for (const [path, value] of Object.entries(d.set)) if (!taken.has(path)) put(set as Doc, path, value);
  return applyDiff(server, { set, unset: d.unset.filter((p) => !taken.has(p)) });
}

export type JsonDraftResult = { ok: true; doc: Doc } | { ok: false; error: string };

/**
 * Parses the JSON view's Canonical EJSON text into a draft document (W18
 * §4). Two refusals `diff` itself would otherwise swallow silently: `diff`
 * skips `_id` in both directions (it is never a legal update path), so an
 * `_id` typed differently in the JSON text would simply be dropped rather
 * than saved — this catches that and names it, instead of the change
 * vanishing without a word.
 */
export function parseJsonDraft(text: string, originalId: unknown): JsonDraftResult {
  let parsed: unknown;
  try {
    parsed = ejsonParse(text);
  } catch {
    return { ok: false, error: 'Invalid EJSON' };
  }
  if (!isPlainDocument(parsed)) return { ok: false, error: 'Enter a JSON document' };
  const doc = parsed as Doc;
  const hadId = originalId !== undefined;
  const hasId = has(doc, '_id');
  // Both absent compares equal (`undefined` both sides), so only a present,
  // differing `_id` or one side missing it counts as a change.
  const idChanged = hadId !== hasId || !same(originalId, doc._id);
  if (idChanged) return { ok: false, error: 'The _id field cannot be changed here' };
  return { ok: true, doc };
}
