import { describe, it, expect } from 'vitest';
import {
  allExpandablePaths,
  expandablePathsBelow,
  flattenVisibleFieldRows,
  parentRowIndex,
} from '../../src/pages/Workspace/views/docFieldFlatten';

const DEEP = { a: { b: { c: { d: [{ e: 1 }, 2] } }, leaf: 1 }, top: 'x', list: [1, [2]] };

describe('expandablePathsBelow', () => {
  it('lists every object or array below the field, at every depth, and no leaves', () => {
    expect(expandablePathsBelow(DEEP.a, 'doc::a')).toEqual([
      'doc::a.b',
      'doc::a.b.c',
      'doc::a.b.c.d',
      'doc::a.b.c.d.0',
    ]);
  });

  it('does not include the field itself, and is empty for a scalar or an empty container', () => {
    expect(expandablePathsBelow('x', 'doc::top')).toEqual([]);
    expect(expandablePathsBelow({}, 'doc::e')).toEqual([]);
    expect(expandablePathsBelow({ n: 1 }, 'doc::e')).toEqual([]);
  });

  it('walks array indexes as path segments', () => {
    expect(expandablePathsBelow(DEEP.list, 'doc::list')).toEqual(['doc::list.1']);
  });

  it('escapes a dotted key so it cannot collide with a nested path', () => {
    expect(expandablePathsBelow({ 'x.y': { z: {} } }, 'doc::o')).toEqual(['doc::o.x\\.y', 'doc::o.x\\.y.z']);
  });
});

describe('allExpandablePaths', () => {
  it('covers every container in the document, each top-level one before its descendants', () => {
    expect(allExpandablePaths(DEEP, 'doc')).toEqual([
      'doc::a',
      'doc::a.b',
      'doc::a.b.c',
      'doc::a.b.c.d',
      'doc::a.b.c.d.0',
      'doc::list',
      'doc::list.1',
    ]);
  });

  it('is empty for a flat document', () => {
    expect(allExpandablePaths({ a: 1, b: 'x', c: null }, 'doc')).toEqual([]);
  });

  it('expanding it makes the whole document visible in the flat order', () => {
    const rows = flattenVisibleFieldRows(DEEP, 'doc', new Set(allExpandablePaths(DEEP, 'doc')));
    expect(rows.map((r) => r.fieldPath)).toContain('a.b.c.d.0.e');
  });
});

describe('parentRowIndex', () => {
  const all = new Set(allExpandablePaths(DEEP, 'doc'));
  const rows = flattenVisibleFieldRows(DEEP, 'doc', all);
  const indexOf = (fieldPath: string) => rows.findIndex((r) => r.fieldPath === fieldPath);

  it('is the enclosing field for a nested row', () => {
    expect(parentRowIndex(rows, indexOf('a.b.c'))).toBe(indexOf('a.b'));
    expect(parentRowIndex(rows, indexOf('a.leaf'))).toBe(indexOf('a'));
  });

  it('skips earlier siblings and their subtrees on the way up', () => {
    expect(parentRowIndex(rows, indexOf('a.leaf'))).toBe(indexOf('a'));
    expect(parentRowIndex(rows, indexOf('list.1'))).toBe(indexOf('list'));
  });

  it('is -1 for a top-level field and for an index outside the rows', () => {
    expect(parentRowIndex(rows, indexOf('top'))).toBe(-1);
    expect(parentRowIndex(rows, 0)).toBe(-1);
    expect(parentRowIndex(rows, 999)).toBe(-1);
  });

  it('does not take a dotted top-level name for the parent of a nested field', () => {
    const doc = { a: { b: 1 }, 'a.b': 2 };
    const flat = flattenVisibleFieldRows(doc, 'doc', new Set(['doc::a']));
    const dotted = flat.findIndex((r) => r.path === 'doc::a\\.b');
    expect(parentRowIndex(flat, dotted)).toBe(-1);
  });
});
