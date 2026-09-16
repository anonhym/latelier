import { describe, it, expect } from 'vitest';
import {
  resolveColumns,
  reorder,
  getValueAtPath,
  orderFields,
  deriveColumns,
} from '../../src/pages/Workspace/views/tableColumns';
import type { TableColumnConfig } from '@shared/types';

describe('orderFields', () => {
  const derived = ['_id', 'apple', 'banana', 'zebra'];

  it('returns derived order unchanged when no order is given', () => {
    expect(orderFields(derived, undefined)).toEqual(derived);
    expect(orderFields(derived, [])).toEqual(derived);
  });

  it('applies the explicit order, including hidden-equivalent fields (no hidden concept here)', () => {
    expect(orderFields(derived, ['zebra', '_id'])).toEqual([
      'zebra',
      '_id',
      'apple',
      'banana',
    ]);
  });

  it('drops stale order entries that no longer exist in derived', () => {
    expect(orderFields(derived, ['ghost', 'zebra'])).toEqual([
      'zebra',
      '_id',
      'apple',
      'banana',
    ]);
  });
});

describe('resolveColumns', () => {
  const derived = ['_id', 'apple', 'banana', 'zebra'];

  it('undefined config → derived order, all visible, no computed', () => {
    expect(resolveColumns(derived, undefined)).toEqual([
      { field: '_id', kind: 'field' },
      { field: 'apple', kind: 'field' },
      { field: 'banana', kind: 'field' },
      { field: 'zebra', kind: 'field' },
    ]);
  });

  it('honors an explicit order', () => {
    const config: TableColumnConfig = { order: ['zebra', '_id', 'apple'] };
    const result = resolveColumns(derived, config);
    expect(result.map((c) => c.field)).toEqual(['zebra', '_id', 'apple', 'banana']);
  });

  it('drops hidden columns from the resolved list', () => {
    const config: TableColumnConfig = { hidden: ['banana'] };
    const result = resolveColumns(derived, config);
    expect(result.map((c) => c.field)).toEqual(['_id', 'apple', 'zebra']);
  });

  it('appends newly-derived columns not yet in order', () => {
    const config: TableColumnConfig = { order: ['banana', '_id'] };
    // `apple` and `zebra` are not in `order` — they append, in their derived
    // (alphabetical) order, after the configured ones.
    const result = resolveColumns(derived, config);
    expect(result.map((c) => c.field)).toEqual(['banana', '_id', 'apple', 'zebra']);
  });

  it('keeps _id first when no explicit order is configured', () => {
    const result = resolveColumns(derived, { hidden: [] });
    expect(result[0].field).toBe('_id');
  });

  it('does not special-case _id when the user has explicitly reordered it', () => {
    const config: TableColumnConfig = { order: ['apple', 'banana', '_id', 'zebra'] };
    const result = resolveColumns(derived, config);
    expect(result.map((c) => c.field)).toEqual(['apple', 'banana', '_id', 'zebra']);
  });

  it('appends computed columns after derived/ordered field columns', () => {
    const config: TableColumnConfig = {
      computed: [{ id: 'c1', path: 'address.city', label: 'City' }],
    };
    const result = resolveColumns(derived, config);
    expect(result[result.length - 1]).toEqual({
      field: 'c1',
      kind: 'computed',
      path: 'address.city',
      label: 'City',
    });
  });

  it('a hidden field and a computed column can coexist', () => {
    const config: TableColumnConfig = {
      hidden: ['zebra'],
      computed: [{ id: 'c1', path: 'nested.value' }],
    };
    const result = resolveColumns(derived, config);
    expect(result.map((c) => c.field)).toEqual(['_id', 'apple', 'banana', 'c1']);
  });
});

describe('reorder', () => {
  it('moves an item forward (down the list)', () => {
    expect(reorder(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves an item backward (up the list)', () => {
    expect(reorder(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('is a no-op when from === to', () => {
    const list = ['a', 'b', 'c'];
    expect(reorder(list, 1, 1)).toEqual(['a', 'b', 'c']);
  });

  it('guards against an out-of-range `from`', () => {
    const list = ['a', 'b', 'c'];
    expect(reorder(list, -1, 1)).toEqual(list);
    expect(reorder(list, 5, 1)).toEqual(list);
  });

  it('guards against an out-of-range `to`', () => {
    const list = ['a', 'b', 'c'];
    expect(reorder(list, 0, -1)).toEqual(list);
    expect(reorder(list, 0, 5)).toEqual(list);
  });

  it('does not mutate the input array', () => {
    const list = ['a', 'b', 'c'];
    reorder(list, 0, 2);
    expect(list).toEqual(['a', 'b', 'c']);
  });
});

describe('getValueAtPath', () => {
  it('resolves a nested object path', () => {
    const doc = { address: { city: 'Springfield' } };
    expect(getValueAtPath(doc, 'address.city')).toBe('Springfield');
  });

  it('resolves a numeric array index segment', () => {
    const doc = { tags: ['a', 'b', 'c'] };
    expect(getValueAtPath(doc, 'tags.1')).toBe('b');
  });

  it('resolves a top-level (undotted) path', () => {
    const doc = { name: 'alpha' };
    expect(getValueAtPath(doc, 'name')).toBe('alpha');
  });

  it('returns undefined for a missing path', () => {
    const doc = { address: { city: 'Springfield' } };
    expect(getValueAtPath(doc, 'address.zip')).toBeUndefined();
  });

  it('returns undefined when an intermediate segment is missing', () => {
    const doc = { address: null };
    expect(getValueAtPath(doc, 'address.city')).toBeUndefined();
  });

  it('returns undefined for non-record input', () => {
    expect(getValueAtPath('not a doc', 'a.b')).toBeUndefined();
    expect(getValueAtPath(null, 'a.b')).toBeUndefined();
    expect(getValueAtPath(undefined, 'a.b')).toBeUndefined();
  });

  // Reviewer-bot finding: `Number(segment)` + `Number.isInteger` coerces
  // non-canonical strings into valid array indices (" " and "" → 0, "1e0" and
  // "0x1" → 1). Only a strict canonical-integer segment should resolve.
  describe('rejects non-canonical array index segments', () => {
    const doc = { tags: ['a', 'b', 'c'] };

    it.each([' ', '', '1e0', '0x1', '01'])('segment %j → undefined', (segment) => {
      expect(getValueAtPath(doc, `tags.${segment}`)).toBeUndefined();
    });

    it('still resolves canonical indices, including "0"', () => {
      expect(getValueAtPath(doc, 'tags.0')).toBe('a');
      expect(getValueAtPath(doc, 'tags.1')).toBe('b');
      expect(getValueAtPath(doc, 'tags.2')).toBe('c');
    });
  });
});

describe('deriveColumns field ordering', () => {
  // `nonId.sort()` with no compare function orders by UTF-16 code unit, which
  // puts every capitalised field ahead of every lowercase one: `Name`, `Zip`,
  // `age`. That reads as two separate alphabets in the column chooser. The
  // explicit `localeCompare` comparator is what interleaves them, and this
  // pins it — a revert to a bare `.sort()` fails here, not silently in the UI.
  it('alphabetises case-insensitively rather than by code unit', () => {
    expect(deriveColumns([{ _id: 1, Zip: 1, age: 1, Name: 1, _tag: 1 }])).toEqual([
      '_id',
      '_tag',
      'age',
      'Name',
      'Zip',
    ]);
  });

  it('keeps _id first whatever the other fields sort to', () => {
    expect(deriveColumns([{ Aa: 1, _id: 1 }])[0]).toBe('_id');
  });

  it('unions fields across documents without duplicating', () => {
    expect(deriveColumns([{ _id: 1, b: 1 }, { _id: 2, a: 1, b: 2 }])).toEqual(['_id', 'a', 'b']);
  });
});
