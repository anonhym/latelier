// T0.4 — pure, unit-testable helpers backing the bulk-selection action bar.
// Kept dependency-free of React so they're trivially unit-tested and reused
// by both `SelectionActionBar` and `Workspace.tsx`'s DeleteConfirm wiring.
import { ejsonStringify } from '../../utils/ejson';
import { isRecord } from '../../utils/displayValue';

/**
 * Ascending numeric order for a `Set<number>` of selected row indices.
 * `[...set].sort()` alone would sort lexicographically (`[1, 10, 2]`) —
 * always pass a numeric comparator.
 */
export function sortedIndices(indices: Set<number>): number[] {
  return [...indices].sort((a, b) => a - b);
}

/**
 * Resolve the selected `Set<number>` of row indices against the current
 * `documents` array, in ascending index order. Filters out indices that no
 * longer resolve to a document (defensive — selection is reset whenever the
 * `documents` reference changes, so this should normally be a no-op).
 */
export function selectedDocs(documents: unknown[], indices: Set<number>): unknown[] {
  return sortedIndices(indices)
    .map((i) => documents[i])
    .filter((doc) => doc !== undefined);
}

/**
 * Build the `{ _id: { $in: [...] } }` EJSON filter string for a "delete
 * selected" action, from the raw `_id` values already on the (EJSON-revived)
 * documents — the same shape `api.query.find` hands back at runtime (real
 * `ObjectId`/`Date`/etc. instances, not `{$oid:...}` sentinels).
 *
 * Uses `ejsonStringify` (canonical `EJSON.stringify`, `relaxed: false`) so
 * this is correct for both revived-BSON values and pre-sentinel-shaped
 * fixtures alike — a bare `JSON.stringify` would call `ObjectId.toJSON()`
 * and emit a bare hex string, which the server can't match against `_id`.
 *
 * Docs lacking an `_id` (e.g. an `{_id: 0}` projection) are excluded.
 * Returns `null` when none of the selected docs have an `_id` — callers
 * MUST treat `null` as "delete is unsafe" and never fall back to an
 * unfiltered `{}` delete.
 */
export function buildDeleteSelectedFilterJson(docs: unknown[]): string | null {
  const ids = docs
    .filter(isRecord)
    .map((doc) => doc._id)
    .filter((id) => id !== undefined && id !== null);
  if (ids.length === 0) return null;
  return ejsonStringify({ _id: { $in: ids } });
}

/**
 * Serialize selected documents for "Copy selected" — a bare EJSON object for
 * a single doc (matches the existing per-card copy in JsonView), a JSON
 * array for multiple. Preserves BSON sentinels via `ejsonStringify`.
 */
export function serializeSelectedForClipboard(docs: unknown[]): string {
  if (docs.length === 1) return ejsonStringify(docs[0], 2);
  return ejsonStringify(docs, 2);
}
