import { isRecord, toDisplayValue } from '../../../utils/displayValue';
import { ejsonParse, ejsonStringify, ejsonStringifyReadable } from '../../../utils/ejson';
import type { Kind } from '../documentFieldTypes';

const ID_CUT = 12;

/**
 * The full text a row's `_id` shows: its display value (what a Table cell
 * reads), never its EJSON wrapper. `(no _id)` when absent.
 */
export function getDocIdText(doc: unknown): string {
  if (!isRecord(doc)) return toDisplayValue(doc).display;
  const id = doc._id;
  if (id === null || id === undefined) return '(no _id)';
  return toDisplayValue(id).display;
}

/**
 * Short, human-scannable row identifier built from the `_id`'s display value:
 * an ObjectId as `…` plus its last eight hex digits, anything else as its
 * display text cut to twelve characters with an ellipsis. Shared by the
 * views' visible id and the accessible names of every row action.
 *
 * Expansion state (`state.expandedRows`) is keyed by `getFullDocId`, not this
 * short form, so changing how a row is *labelled* never moves a persisted key.
 */
export function getDocId(doc: unknown): string {
  const text = getDocIdText(doc);
  const id = isRecord(doc) ? doc._id : undefined;
  if (toDisplayValue(id).type === 'objectid') return `…${text.slice(-8)}`;
  return text.length > ID_CUT ? `${text.slice(0, ID_CUT)}…` : text;
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
 * A Table cell's raw wire value, revived the same way the Document Editor
 * revives a row (`JSON.stringify` -> `ejsonParse`): live BSON instances
 * (`Int32`, `Decimal128`, …) instead of the canonical-EJSON sentinel
 * *objects* the wire actually carries (`parseFindResult` is a plain
 * `JSON.parse`, not a BSON-aware revive — see `electron/preload.ts`).
 * `documentFieldTypes.ts`'s `kindOf` only recognizes the revived shapes, so
 * both `isInlineEditableKind` and the inline editor's own control-picking logic
 * go through this first — they'd otherwise see every sentinel as a generic
 * `'object'` and either refuse everything or, worse, misclassify one.
 * Falls back to the raw value on a parse failure, which `kindOf` then reads
 * as `'other'` — never inline-editable, same as any other exotic type.
 */
export function reviveTableValue(value: unknown): unknown {
  try {
    return ejsonParse<unknown>(JSON.stringify(value));
  } catch {
    return value;
  }
}

/**
 * W18 §8 (Quick Edit) — the kinds the Table's inline editor can write back
 * with `$set` without silently changing the field's BSON type. A bare
 * `number` is excluded on purpose: canonical EJSON never round-trips one, so
 * a wire value that revives to one isn't a real document field to begin
 * with.
 */
const INLINE_EDITABLE_KINDS: ReadonlySet<Kind> = new Set<Kind>([
  'string',
  'boolean',
  'int32',
  'long',
  'double',
  'decimal',
]);

/**
 * Whether a Table cell's value is safe for the inline single-field editor
 * (W18 §8), given its `kindOf(reviveTableValue(value))` — takes the kind
 * rather than the raw value so `TableCell` can reuse the revival it already
 * memoises instead of paying for a second one on every render. String,
 * boolean and the BSON numeric types (Int32/Int64/Double/Decimal128)
 * qualify — each keeps its loaded type through the guarded save
 * path (`documentDiff.ts`'s `buildUpdateRequest`), same as the Document
 * Editor's Fields view. Date, ObjectId, Binary, null, arrays and plain
 * objects are out of scope: those open the Document Editor on the field
 * instead. `_id` is never inline-editable regardless of its value's shape.
 *
 * Deliberately doesn't know about column *kind* (field vs. computed
 * accessor) — callers must additionally gate on `col.kind === 'field'`
 * before offering the affordance, since `$set` needs a real field path, not
 * a computed column's display label.
 */
export function isInlineEditableKind(kind: Kind, fieldPath: string): boolean {
  if (fieldPath === '_id') return false;
  return INLINE_EDITABLE_KINDS.has(kind);
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
    // Stryker disable next-line ConditionalExpression: of every BSON sentinel walkRevive recognizes, only `{ $undefined: true }` ever revives to a non-record top-level value (`null` — every other single-key sentinel, e.g. $oid/$code/$symbol/$minKey/$maxKey, revives to a live BSON class instance, which is still `isRecord`-true) — verified against bson directly. `delete null._id` right below always throws, so skipping this guard still lands in the outer `catch` and returns the identical `'{}'`.
    if (!isRecord(revived)) return '{}';
    delete revived._id;
    // the drawer this feeds is something a person reads and edits, so
    // the sentinels that have a lossless plainer form lose them here.
    return ejsonStringifyReadable(revived, 2);
  } catch {
    return '{}';
  }
}
