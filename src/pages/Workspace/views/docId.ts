import { isRecord } from '../../../utils/displayValue';
import { ejsonParse, ejsonStringify, ejsonStringifyReadable } from '../../../utils/ejson';

/**
 * Short, human-scannable row identifier — last 8 chars of an `$oid`, or a
 * truncated stringification for non-ObjectId `_id`s. Used as the visible
 * label in the Tree view's collapsed row and (T2.5) the Table's expand
 * gutter.
 *
 * Extracted from `TreeView.tsx` (T2.5) so both Tree and Table views share the
 * identical docId scheme — expansion state (`state.expandedRows`) is keyed
 * by `getFullDocId`, not this short form, but the short form is what the
 * two views must agree on to render corresponding rows the same way.
 */
export function getDocId(doc: unknown): string {
  if (!isRecord(doc)) return JSON.stringify(doc).slice(0, 12);
  const id = doc._id;
  if (id === null || id === undefined) return '(no _id)';
  if (isRecord(id) && typeof id.$oid === 'string') {
    return id.$oid.slice(-8);
  }
  // A custom-object `_id` (not `$oid`-shaped) needs JSON, not `String()` —
  // `String({...})` is always the useless "[object Object]".
  // Matches `getFullDocId`'s treatment of the same case; primitive
  // `_id`s (string/number) keep the plainer `String()` form.
  if (isRecord(id)) return JSON.stringify(id).slice(0, 12);
  return String(id).slice(0, 12);
}

/**
 * Full row identifier used as the key into `state.expandedRows`. Stable
 * across the Tree and Table views so expanding a document in one view shows
 * it expanded in the other (AC2).
 */
export function getFullDocId(doc: unknown): string {
  if (!isRecord(doc)) return JSON.stringify(doc).slice(0, 24);
  const id = doc._id;
  if (id === null || id === undefined) return '(no _id)';
  if (isRecord(id) && typeof id.$oid === 'string') {
    return id.$oid;
  }
  return JSON.stringify(id).slice(0, 24);
}

/**
 * Build the `{_id}` filter shared by inline cell edits (T2.6) and single
 * document deletes — one source of truth so the write surfaces cannot drift.
 * The Document Editor holds revived BSON rather than sentinels, so it builds
 * its filter with `ejsonStringify` in `documentDiff.ts` instead.
 *
 * `JSON.stringify`, NOT `ejsonStringify` — `doc._id` is already a canonical
 * EJSON sentinel from `parseFindResult` (plain `JSON.parse`, not bson
 * `EJSON.parse` — see `electron/preload.ts`), so it never holds a live
 * ObjectId/Long/Decimal128/etc. instance. `JSON.stringify` around it
 * reproduces canonical EJSON verbatim; the backend `EJSON.parse`s it
 * straight back to the real BSON type. Do NOT "fix" this to `ejsonStringify`
 * — proven in tests/integration/document-service.spec.ts ("DocumentService.
 * updateOne — ObjectId _id filter built from a JSON.parse'd sentinel").
 *
 * Returns `null` when there is no `_id` (missing, or `doc` isn't a record)
 * — callers MUST refuse the write in that case rather than falling through
 * to `{}`, which would touch an ARBITRARY document.
 */
export function buildIdFilter(doc: unknown): string | null {
  if (!isRecord(doc)) return null;
  if (doc._id === undefined) return null;
  return JSON.stringify({ _id: doc._id });
}

/**
 * Whether a Table cell's value is safe for the v1 inline single-field editor
 * (T2.6). Only a plain JS `string` qualifies: numbers/dates/ObjectId/Long/
 * Decimal/Binary all arrive over the wire as canonical-EJSON sentinel
 * *objects* (`parseFindResult` is a plain `JSON.parse`, not a BSON-aware
 * revive — see `electron/preload.ts`), so letting the user retype one as
 * text and `$set` it back would silently flip the field's BSON type
 * (e.g. int32 -> double). Booleans, null, arrays, and plain objects are also
 * out of scope for v1 — all of these route through the Document Editor,
 * which preserves type. `_id` is never inline-editable regardless
 * of its value's shape.
 *
 * Deliberately doesn't know about column *kind* (field vs. computed
 * accessor) — callers must additionally gate on `col.kind === 'field'`
 * before offering the affordance, since `$set` needs a real field path, not
 * a computed column's display label.
 */
export function isInlineEditable(value: unknown, fieldPath: string): boolean {
  if (fieldPath === '_id') return false;
  return typeof value === 'string';
}

/**
 * EJSON body for "Duplicate document" — the source document's canonical
 * EJSON with `_id` stripped, so the Document Editor's insert mode lets
 * Mongo assign a fresh `_id` instead of colliding with the original on
 * insert.
 *
 * Round-trips through `ejsonParse` -> delete -> `ejsonStringify` (rather
 * than deleting the key from the raw JS object and reusing `JSON.stringify`)
 * so a BSON-typed `_id` — or any BSON-typed sibling field — survives the
 * strip without corruption. Falls back to `'{}'` (the insert mode's own
 * empty-document default) on any failure, including non-record input.
 */
export function stripIdForDuplicate(doc: unknown): string {
  // Guard on the raw input, not the revived value — a revived BSON scalar
  // (e.g. a bare number canonicalizes to a live `Int32` instance) is still
  // `typeof 'object'` and would otherwise slip past an isRecord check done
  // only after the round-trip.
  if (!isRecord(doc)) return '{}';
  try {
    const revived = ejsonParse<Record<string, unknown>>(ejsonStringify(doc, 2));
    if (!isRecord(revived)) return '{}';
    delete revived._id;
    // the drawer this feeds is something a person reads and edits, so
    // the sentinels that have a lossless plainer form lose them here.
    return ejsonStringifyReadable(revived, 2);
  } catch {
    return '{}';
  }
}
