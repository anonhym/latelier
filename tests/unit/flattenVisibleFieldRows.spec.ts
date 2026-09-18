import { describe, it, expect } from 'vitest';
import { flattenVisibleFieldRows } from '../../src/pages/Workspace/views/docFieldFlatten';

// Pure — no React, no DOM — so this runs in plain Node, unlike the
// roving-focus hook specs alongside it. Backs #20's field-tree navigation:
// `DocFieldTree`'s roving container needs the exact order `FieldNode`'s own
// recursion renders rows in, recomputed from `expandedPaths` on every call.
describe('flattenVisibleFieldRows', () => {
  it('lists top-level fields in document order, none expandable', () => {
    const rows = flattenVisibleFieldRows({ a: 1, b: 'x' }, 'doc1', new Set());
    expect(rows).toEqual([
      { path: 'doc1::a', expandable: false, fieldPath: 'a', value: 1 },
      { path: 'doc1::b', expandable: false, fieldPath: 'b', value: 'x' },
    ]);
  });

  it('marks object and array fields expandable but does not descend when collapsed', () => {
    const rows = flattenVisibleFieldRows(
      { obj: { x: 1 }, arr: [1, 2], leaf: 'v' },
      'doc1',
      new Set(),
    );
    expect(rows).toEqual([
      { path: 'doc1::obj', expandable: true, fieldPath: 'obj', value: { x: 1 } },
      { path: 'doc1::arr', expandable: true, fieldPath: 'arr', value: [1, 2] },
      { path: 'doc1::leaf', expandable: false, fieldPath: 'leaf', value: 'v' },
    ]);
  });

  it('splices an expanded object field\'s children in right after it', () => {
    const rows = flattenVisibleFieldRows(
      { obj: { x: 1, y: 2 }, leaf: 'v' },
      'doc1',
      new Set(['doc1::obj']),
    );
    expect(rows.map((r) => r.path)).toEqual([
      'doc1::obj',
      'doc1::obj.x',
      'doc1::obj.y',
      'doc1::leaf',
    ]);
    // #68 — the field menu's keyboard-open path needs `fieldPath`/`value`
    // straight off the flat row, dot-joined without the docId prefix.
    expect(rows.map((r) => r.fieldPath)).toEqual(['obj', 'obj.x', 'obj.y', 'leaf']);
    expect(rows.map((r) => r.value)).toEqual([{ x: 1, y: 2 }, 1, 2, 'v']);
  });

  it('splices an expanded array field\'s indices in right after it', () => {
    const rows = flattenVisibleFieldRows({ arr: ['a', 'b'] }, 'doc1', new Set(['doc1::arr']));
    expect(rows.map((r) => r.path)).toEqual(['doc1::arr', 'doc1::arr.0', 'doc1::arr.1']);
    expect(rows.map((r) => r.fieldPath)).toEqual(['arr', 'arr.0', 'arr.1']);
  });

  it('recurses into a doubly-nested expansion', () => {
    const rows = flattenVisibleFieldRows(
      { obj: { inner: { z: 1 } } },
      'doc1',
      new Set(['doc1::obj', 'doc1::obj.inner']),
    );
    expect(rows.map((r) => r.path)).toEqual([
      'doc1::obj',
      'doc1::obj.inner',
      'doc1::obj.inner.z',
    ]);
    expect(rows.map((r) => r.fieldPath)).toEqual(['obj', 'obj.inner', 'obj.inner.z']);
  });

  it('an expandedPaths entry for a non-expandable field is ignored', () => {
    const rows = flattenVisibleFieldRows({ leaf: 'v' }, 'doc1', new Set(['doc1::leaf']));
    expect(rows).toEqual([{ path: 'doc1::leaf', expandable: false, fieldPath: 'leaf', value: 'v' }]);
  });

  it('an empty document produces no rows', () => {
    expect(flattenVisibleFieldRows({}, 'doc1', new Set())).toEqual([]);
  });
});
