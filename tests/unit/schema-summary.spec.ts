import { describe, it, expect } from 'vitest';
import {
  checkFieldType,
  inferType,
  summarizeSchema,
} from '../../src/pages/Workspace/schemaSummary';
import type { SchemaSampleEntry } from '@shared/types';

describe('summarizeSchema', () => {
  it('aggregates field paths and BSON-shaped types from a sample', () => {
    const docs = [
      { _id: { $oid: 'a' }, name: 'A', count: 1 },
      { _id: { $oid: 'b' }, name: 'B', count: 2 },
      { _id: { $oid: 'c' }, name: 'C' },
    ];
    const out = summarizeSchema(docs);
    const byPath = Object.fromEntries(out.map((e) => [e.path, e]));
    expect(byPath._id).toBeDefined();
    expect(byPath._id!.types).toEqual({ objectid: 3 });
    expect(byPath.name!.types).toEqual({ string: 3 });
    expect(byPath.count!.frequency).toBeCloseTo(2 / 3);
  });

  it('puts _id first regardless of frequency', () => {
    const docs = [{ _id: 1, b: 2, a: 3 }];
    const out = summarizeSchema(docs);
    expect(out[0]!.path).toBe('_id');
  });

  it('records null and missing as distinct outcomes', () => {
    const docs = [
      { x: 'a' },
      { x: null },
      {}, // x absent — shouldn't count as a type, only lowers frequency
    ];
    const out = summarizeSchema(docs);
    const x = out.find((e) => e.path === 'x')!;
    expect(x.types).toEqual({ string: 1, null: 1 });
    expect(x.frequency).toBeCloseTo(2 / 3);
  });

  it('walks one level of nested documents', () => {
    const docs = [
      { addr: { city: 'NYC', zip: '10001' } },
      { addr: { city: 'LA' } },
    ];
    const paths = summarizeSchema(docs).map((e) => e.path).sort();
    expect(paths).toContain('addr');
    expect(paths).toContain('addr.city');
    expect(paths).toContain('addr.zip');
  });

  it('walks one level into array elements', () => {
    const docs = [
      { items: [{ qty: 1 }, { qty: 2 }] },
      { items: [{ qty: 3 }] },
    ];
    const out = summarizeSchema(docs);
    const itemsQty = out.find((e) => e.path === 'items.qty');
    expect(itemsQty).toBeDefined();
    // Both documents have items.qty as a number → type:number = 2 (one per
    // doc, not per element) and frequency = 1.0.
    expect(itemsQty!.types).toEqual({ number: 2 });
    expect(itemsQty!.frequency).toBe(1);
  });

  it('caps frequency at 100% even when nested arrays repeat the same field many times', () => {
    const docs = [
      { items: [{ qty: 1 }, { qty: 2 }, { qty: 3 }, { qty: 4 }, { qty: 5 }] },
      { items: [{ qty: 6 }] },
    ];
    const out = summarizeSchema(docs);
    const itemsQty = out.find((e) => e.path === 'items.qty');
    expect(itemsQty!.frequency).toBe(1);
    expect(itemsQty!.types).toEqual({ number: 2 });
  });

  it('counts a path once per document even when present at multiple shapes in one array', () => {
    const docs = [
      { items: [{ qty: 1 }, { qty: '2' }, { qty: null }] },
    ];
    const out = summarizeSchema(docs);
    const itemsQty = out.find((e) => e.path === 'items.qty');
    // Frequency reflects "doc has the path", not "type-count sum".
    expect(itemsQty!.frequency).toBe(1);
    // But each *type* present in this doc is recorded once.
    expect(itemsQty!.types).toEqual({ number: 1, string: 1, null: 1 });
  });

  it('classifies EJSON wrappers without recursing into them', () => {
    const docs = [
      {
        when: { $date: '2026-01-01T00:00:00Z' },
        amount: { $numberDecimal: '1.5' },
        big: { $numberLong: '9999' },
      },
    ];
    const out = summarizeSchema(docs);
    const byPath = Object.fromEntries(out.map((e) => [e.path, e]));
    expect(byPath.when!.types).toEqual({ date: 1 });
    expect(byPath.amount!.types).toEqual({ decimal: 1 });
    expect(byPath.big!.types).toEqual({ long: 1 });
    // Should not have recursed into $date / $numberDecimal etc.
    expect(out.some((e) => e.path.includes('$'))).toBe(false);
  });

  it('types a sentinel key mixed with other keys as a sub-document, not as BSON', () => {
    // `{"$oid": …, "extra": true}` is not an exact wrapper, so bson's revival
    // rule leaves it a plain sub-document and it is stored as one. Typing it
    // `objectid` would disagree with what is actually written.
    const docs = [{ a: { $oid: '507f1f77bcf86cd799439011', extra: true } }];
    const out = summarizeSchema(docs);
    expect(out.find((e) => e.path === 'a')!.types).toEqual({ object: 1 });
  });
});

/**
 * W17 §2 — the dominance check behind the Update drawer's type warning.
 * Silence is the default: it warns only when one type holds ≥90% of a
 * field's own histogram and the new value is something else.
 */
describe('checkFieldType', () => {
  const entry = (path: string, types: Record<string, number>): SchemaSampleEntry => ({
    path,
    frequency: 1,
    types,
  });
  const byPath = (entries: SchemaSampleEntry[]) => new Map(entries.map((e) => [e.path, e]));

  it('returns null for a field with no sampled entry', () => {
    expect(checkFieldType(byPath([entry('sku', { string: 10 })]), 'missing', 'number')).toBeNull();
  });

  it('returns null when a 100%-share type agrees with the value', () => {
    expect(checkFieldType(byPath([entry('sku', { string: 10 })]), 'sku', 'string')).toBeNull();
  });

  it('warns with percent 100 when a 100%-share type disagrees', () => {
    expect(checkFieldType(byPath([entry('ref', { objectid: 10 })]), 'ref', 'string')).toEqual({
      field: 'ref',
      expectedType: 'objectid',
      actualType: 'string',
      percent: 100,
    });
  });

  it('names the dominant type on a 92/8 split when the value is the minority one', () => {
    const entries = byPath([entry('qty', { number: 92, string: 8 })]);
    expect(checkFieldType(entries, 'qty', 'string')).toEqual({
      field: 'qty',
      expectedType: 'number',
      actualType: 'string',
      percent: 92,
    });
  });

  it('returns null on a 60/40 split regardless of the value type', () => {
    const entries = byPath([entry('mixed', { number: 60, string: 40 })]);
    expect(checkFieldType(entries, 'mixed', 'string')).toBeNull();
    expect(checkFieldType(entries, 'mixed', 'number')).toBeNull();
    expect(checkFieldType(entries, 'mixed', 'date')).toBeNull();
  });

  it('reads the cutoff off the unrounded share: 0.895 displays as 90% but does not warn', () => {
    // 179/200 = 0.895 — Math.round gives 90, so a cutoff written against the
    // displayed integer would warn here. The fraction is what decides.
    const entries = byPath([entry('edge', { number: 179, string: 21 })]);
    expect(checkFieldType(entries, 'edge', 'string')).toBeNull();
  });

  it('shares one type vocabulary with inferType, sentinels included', () => {
    // The regression this guards: EditDrawer must read {"$oid": …} as
    // `objectid`, not as `object`, or a correct edit warns.
    const entries = byPath([entry('ref', { objectid: 10 })]);
    expect(inferType({ $oid: '507f1f77bcf86cd799439011' })).toBe('objectid');
    expect(
      checkFieldType(entries, 'ref', inferType({ $oid: '507f1f77bcf86cd799439011' })),
    ).toBeNull();
    // …and $regularExpression, the sentinel Canonical EJSON actually emits.
    expect(inferType({ $regularExpression: { pattern: 'a', options: '' } })).toBe('regex');
  });

  it('agrees with bson revival on a sentinel key that is not the whole object', () => {
    const value = { $oid: '507f1f77bcf86cd799439011', extra: true };
    // ejsonParse leaves this a plain object, so it is written as a
    // sub-document — `object` is the only truthful classification.
    expect(inferType(value)).toBe('object');
    // …and a sub-document is out of scope for the warning, so a field
    // sampled as `number` must not be told its value is an `objectid`.
    expect(checkFieldType(byPath([entry('qty', { number: 10 })]), 'qty', inferType(value))).toEqual({
      field: 'qty',
      expectedType: 'number',
      actualType: 'object',
      percent: 100,
    });
  });
});
