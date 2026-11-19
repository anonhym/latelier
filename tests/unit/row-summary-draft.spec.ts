import { describe, it, expect } from 'vitest';
import {
  moveField,
  ROW_SUMMARY_MAX_FIELDS,
  rowSummaryProblem,
  summaryPairs,
  valueAtPath,
} from '../../src/features/rowSummary/rowSummaryDraft';

describe('rowSummaryProblem', () => {
  it('accepts one to four distinct fields', () => {
    expect(rowSummaryProblem(['a'])).toBeNull();
    expect(rowSummaryProblem(['a', 'b', 'c', 'd'])).toBeNull();
  });

  it('refuses none, more than four, _id, a repeat and an empty name', () => {
    expect(rowSummaryProblem([])).not.toBeNull();
    expect(rowSummaryProblem(['a', 'b', 'c', 'd', 'e'])).not.toBeNull();
    expect(rowSummaryProblem(['a', '_id'])).toContain('_id');
    expect(rowSummaryProblem(['a', 'a'])).toContain('twice');
    expect(rowSummaryProblem(['a', '  '])).not.toBeNull();
    expect(ROW_SUMMARY_MAX_FIELDS).toBe(4);
  });
});

describe('moveField', () => {
  it('moves an entry one place either way', () => {
    expect(moveField(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveField(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
  });

  it('leaves the list as it is at either end and for an index outside it, without mutating', () => {
    const input = ['a', 'b'];
    expect(moveField(input, 0, -1)).toEqual(['a', 'b']);
    expect(moveField(input, 1, 1)).toEqual(['a', 'b']);
    expect(moveField(input, 5, -1)).toEqual(['a', 'b']);
    expect(moveField(input, -1, 1)).toEqual(['a', 'b']);
    expect(moveField(input, 0, 1)).toEqual(['b', 'a']);
    expect(input).toEqual(['a', 'b']);
  });
});

describe('valueAtPath', () => {
  it('reads a top-level key, a nested path, and a key that itself contains a dot', () => {
    const doc = { a: 1, n: { m: { k: 2 } }, 'x.y': 3 };
    expect(valueAtPath(doc, 'a')).toBe(1);
    expect(valueAtPath(doc, 'n.m.k')).toBe(2);
    expect(valueAtPath(doc, 'x.y')).toBe(3);
  });

  it('answers undefined for a missing step, a non-object step and an inherited key', () => {
    expect(valueAtPath({ a: 1 }, 'a.b')).toBeUndefined();
    expect(valueAtPath({ a: { b: 1 } }, 'a.c')).toBeUndefined();
    expect(valueAtPath({ a: [1] }, 'a.0')).toBeUndefined();
    expect(valueAtPath({}, 'toString')).toBeUndefined();
    expect(valueAtPath({}, 'constructor.name')).toBeUndefined();
  });
});

describe('summaryPairs', () => {
  it('keeps the summary\'s order, skips what the document lacks, and never shows _id', () => {
    const doc = { _id: 1, a: 'A', b: 'B', c: { d: 'D' } };
    expect(summaryPairs(doc, ['c.d', 'zzz', '_id', 'a'])).toEqual([
      ['c.d', 'D'],
      ['a', 'A'],
    ]);
  });

  it('stops at four, counting only the fields the document has', () => {
    const doc = { b: 1, c: 2, d: 3, e: 4, f: 5 };
    expect(summaryPairs(doc, ['a', 'b', 'c', 'd', 'e', 'f']).map(([k]) => k)).toEqual(['b', 'c', 'd', 'e']);
  });
});
