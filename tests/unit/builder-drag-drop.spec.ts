// Merge/replace on drop onto an existing condition row. Pure-function
// coverage of `mergeOrReplaceDragged`, independent of DOM event wiring (the
// row-level `onDragOver`/`onDrop` handlers in `BuilderPane.tsx` are covered
// end-to-end in `tests/component/builder-drag-merge-replace.spec.tsx`).
//
// Prior art: `tests/unit/filter-tree.spec.ts`'s `cond`/`raw` fixtures and
// `tests/unit/builder-compile.spec.ts`'s `condFromDragged` table.
import { describe, it, expect } from 'vitest';
import { condFromDragged, mergeOrReplaceDragged } from '../../src/pages/Workspace/builder';
import type { CondNode, RawNode } from '../../src/pages/Workspace/filterTree';

function cond(overrides: Partial<CondNode> = {}): CondNode {
  return { kind: 'cond', field: 'status', op: '$eq', valType: 'string', value: 'active', ...overrides };
}

function raw(json: string): RawNode {
  return { kind: 'raw', json };
}

describe('mergeOrReplaceDragged — merge', () => {
  it('same field, bare $eq → wraps into a one-element $in list, dragged value appended', () => {
    const target = cond({ field: 'status', op: '$eq', valType: 'string', value: 'active' });
    const result = mergeOrReplaceDragged(target, { field: 'status', value: 'archived' });
    expect(result).toEqual({
      kind: 'cond',
      field: 'status',
      op: '$in',
      valType: 'array',
      value: JSON.stringify(['active', 'archived']),
    });
  });

  it('same field, bare $eq, number valType → both sides wire-encoded as numbers', () => {
    const target = cond({ field: 'qty', op: '$eq', valType: 'number', value: '5' });
    const result = mergeOrReplaceDragged(target, { field: 'qty', value: 10 });
    expect(result).toEqual({
      kind: 'cond',
      field: 'qty',
      op: '$in',
      valType: 'array',
      value: JSON.stringify([5, 10]),
    });
  });

  it('same field, already $in → extends the existing list', () => {
    const target = cond({
      field: 'status',
      op: '$in',
      valType: 'array',
      value: JSON.stringify(['active', 'archived']),
    });
    const result = mergeOrReplaceDragged(target, { field: 'status', value: 'pending' });
    expect(result).toEqual({
      kind: 'cond',
      field: 'status',
      op: '$in',
      valType: 'array',
      value: JSON.stringify(['active', 'archived', 'pending']),
    });
  });

  it('same field, already $nin → extends the list and stays $nin', () => {
    const target = cond({
      field: 'status',
      op: '$nin',
      valType: 'array',
      value: JSON.stringify(['archived']),
    });
    const result = mergeOrReplaceDragged(target, { field: 'status', value: 'deleted' });
    expect(result.op).toBe('$nin');
    expect(JSON.parse(result.value)).toEqual(['archived', 'deleted']);
  });

  it('dropping a value already present in the list is a no-op on the array (deduped)', () => {
    const target = cond({
      field: 'status',
      op: '$in',
      valType: 'array',
      value: JSON.stringify(['active', 'archived']),
    });
    const result = mergeOrReplaceDragged(target, { field: 'status', value: 'active' });
    expect(JSON.parse(result.value)).toEqual(['active', 'archived']);
  });

  it('dedup compares wire-encoded values, not raw text — a matching $oid is not re-added', () => {
    const oid = '507f1f77bcf86cd799439011';
    const target = cond({
      field: '_id',
      op: '$in',
      valType: 'array',
      value: JSON.stringify([{ $oid: oid }]),
    });
    const result = mergeOrReplaceDragged(target, { field: '_id', value: { $oid: oid } });
    expect(JSON.parse(result.value)).toEqual([{ $oid: oid }]);
  });

  it('a fresh $eq wrapped in the merge produces the same element condFromDragged would', () => {
    // Sanity check tying the merge's element encoding back to the function
    // it's a companion to.
    const fresh = condFromDragged({ field: 'status', value: 'archived' });
    expect(fresh).toEqual({ kind: 'cond', field: 'status', op: '$eq', valType: 'string', value: 'archived' });
  });
});

describe('mergeOrReplaceDragged — replace', () => {
  it('same field, unmergeable op ($gt) → replaces with a fresh $eq', () => {
    const target = cond({ field: 'age', op: '$gt', valType: 'number', value: '18' });
    const result = mergeOrReplaceDragged(target, { field: 'age', value: 25 });
    expect(result).toEqual(condFromDragged({ field: 'age', value: 25 }));
  });

  it('same field, unmergeable op ($regex) → replaces', () => {
    const target = cond({ field: 'name', op: '$regex', valType: 'regex', value: 'foo' });
    const result = mergeOrReplaceDragged(target, { field: 'name', value: 'bar' });
    expect(result).toEqual(condFromDragged({ field: 'name', value: 'bar' }));
  });

  it('same field, unmergeable op ($exists) → replaces', () => {
    const target = cond({ field: 'name', op: '$exists', valType: 'boolean', value: 'true' });
    const result = mergeOrReplaceDragged(target, { field: 'name', value: 'bar' });
    expect(result).toEqual(condFromDragged({ field: 'name', value: 'bar' }));
  });

  it('same field, $all (array-shaped but not in the mergeable set) → replaces, not extends', () => {
    // $all is deliberately not one of the three mergeable ops (§ spec) even
    // though it shares the array-value shape with $in/$nin — pin that
    // distinction so a future refactor conflating MERGEABLE_DROP_OPS with
    // filterTree.ts's ARRAY_VALUE_OPS is caught here.
    const target = cond({ field: 'tags', op: '$all', valType: 'array', value: JSON.stringify(['a', 'b']) });
    const result = mergeOrReplaceDragged(target, { field: 'tags', value: 'c' });
    expect(result).toEqual(condFromDragged({ field: 'tags', value: 'c' }));
  });

  it('different field, even with a mergeable op → replaces field/value', () => {
    const target = cond({ field: 'status', op: '$eq', valType: 'string', value: 'active' });
    const result = mergeOrReplaceDragged(target, { field: 'name', value: 'bob' });
    expect(result).toEqual(condFromDragged({ field: 'name', value: 'bob' }));
  });

  it('raw-clause target → always replaces with a fresh structured condition', () => {
    const target = raw('{"status":{"$gt":1}}');
    const result = mergeOrReplaceDragged(target, { field: 'status', value: 'active' });
    expect(result).toEqual(condFromDragged({ field: 'status', value: 'active' }));
  });

  it('same field, $in row whose current text is not valid JSON → replaces rather than silently dropping it', () => {
    // Regression: `parseJsonArrayLenient` reads unparsable text the same as
    // an empty array, so merging on top of it used to discard the row's
    // existing (unparsed, mid-edit) content instead of preserving or
    // rejecting it. Falling to replace loses nothing that wasn't already
    // unparsable.
    const target = cond({ field: 'tags', op: '$in', valType: 'array', value: '[1, 2' });
    const result = mergeOrReplaceDragged(target, { field: 'tags', value: 3 });
    expect(result).toEqual(condFromDragged({ field: 'tags', value: 3 }));
  });

  it('same field, $in row whose current text parses but is not an array → replaces', () => {
    const target = cond({ field: 'tags', op: '$in', valType: 'array', value: '{"not":"an array"}' });
    const result = mergeOrReplaceDragged(target, { field: 'tags', value: 3 });
    expect(result).toEqual(condFromDragged({ field: 'tags', value: 3 }));
  });

  it('same field, $eq, current text is not a valid number → replaces rather than merging NaN as null', () => {
    // `buildScalarWire` silently converts unparsable "number" text to
    // `NaN` (`Number('abc')`), and
    // `JSON.stringify` then writes `NaN` as `null` — the merge used to
    // commit `[null, newValue]`, silently replacing the user's typed
    // text with `null` and losing it for good. `condValueProblem` only
    // checks real numbers for precision loss, so nothing else would have
    // caught this on print.
    const target = cond({ field: 'qty', op: '$eq', valType: 'number', value: 'abc' });
    const result = mergeOrReplaceDragged(target, { field: 'qty', value: 5 });
    expect(result).toEqual(condFromDragged({ field: 'qty', value: 5 }));
  });

  it('same field, $in row whose number elements include unparsable text → replaces', () => {
    // Same defect, reached through an already-array row instead of a bare
    // $eq: `coerceArrayElementWire`'s 'number' case does the same
    // `Number(el)` coercion per element.
    const target = cond({ field: 'qty', op: '$in', valType: 'number', value: '[1, "abc"]' });
    const result = mergeOrReplaceDragged(target, { field: 'qty', value: 5 });
    expect(result).toEqual(condFromDragged({ field: 'qty', value: 5 }));
  });
});
