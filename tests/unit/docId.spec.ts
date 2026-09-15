import { describe, it, expect } from 'vitest';
import {
  getDocId,
  getFullDocId,
  buildIdFilter,
  isInlineEditable,
  stripIdForDuplicate,
} from '../../src/pages/Workspace/views/docId';

describe('getDocId', () => {
  it('takes the last 8 chars of an $oid', () => {
    const doc = { _id: { $oid: '507f1f77bcf86cd799439011' } };
    expect(getDocId(doc)).toBe('99439011');
  });

  it('returns "(no _id)" when _id is missing or null', () => {
    expect(getDocId({})).toBe('(no _id)');
    expect(getDocId({ _id: null })).toBe('(no _id)');
  });

  it('renders a readable JSON form for a custom-object _id, not "[object Object]"', () => {
    // Reviewer-bot finding: a non-$oid record `_id` fell through to
    // `String(id)`, which stringifies any plain object to "[object Object]".
    const doc = { _id: { a: 1, b: 2 } };
    const result = getDocId(doc);
    expect(result).not.toBe('[object Object]');
    expect(result).toBe(JSON.stringify({ a: 1, b: 2 }).slice(0, 12));
  });

  it('still uses plain stringification for a primitive (non-record) _id', () => {
    expect(getDocId({ _id: 'abc123' })).toBe('abc123');
    expect(getDocId({ _id: 42 })).toBe('42');
  });

  it('falls back to a truncated JSON form for non-record input', () => {
    expect(getDocId('not a doc')).toBe(JSON.stringify('not a doc').slice(0, 12));
  });
});

describe('getFullDocId', () => {
  it('returns the full $oid unmodified', () => {
    const doc = { _id: { $oid: '507f1f77bcf86cd799439011' } };
    expect(getFullDocId(doc)).toBe('507f1f77bcf86cd799439011');
  });

  it('JSON-stringifies a custom-object _id', () => {
    const doc = { _id: { a: 1, b: 2 } };
    expect(getFullDocId(doc)).toBe(JSON.stringify({ a: 1, b: 2 }).slice(0, 24));
  });
});

// T2.6 — shared `{_id}` filter for inline edit + EditDrawer (no drift between
// the two write surfaces).
describe('buildIdFilter', () => {
  it('builds a JSON.stringify (not ejsonStringify) filter for an ObjectId sentinel _id', () => {
    const doc = { _id: { $oid: '507f1f77bcf86cd799439011' } };
    expect(buildIdFilter(doc)).toBe(JSON.stringify({ _id: doc._id }));
    expect(JSON.parse(buildIdFilter(doc)!)).toEqual({ _id: { $oid: '507f1f77bcf86cd799439011' } });
  });

  it('builds a filter for a plain string _id', () => {
    expect(buildIdFilter({ _id: 'abc123' })).toBe(JSON.stringify({ _id: 'abc123' }));
  });

  it('builds a filter for a custom-object _id', () => {
    const doc = { _id: { a: 1, b: 2 } };
    expect(buildIdFilter(doc)).toBe(JSON.stringify({ _id: { a: 1, b: 2 } }));
  });

  it('returns null when the document has no _id', () => {
    expect(buildIdFilter({ sku: 'x' })).toBeNull();
  });

  it('returns null for non-record input', () => {
    expect(buildIdFilter('not a doc')).toBeNull();
    expect(buildIdFilter(null)).toBeNull();
  });
});

describe('isInlineEditable', () => {
  it('allows a plain string value on a non-_id field', () => {
    expect(isInlineEditable('pending', 'status')).toBe(true);
  });

  it('never allows editing _id, even when its value is a string', () => {
    expect(isInlineEditable('abc123', '_id')).toBe(false);
  });

  it('rejects EJSON sentinel objects (number/date/long/decimal/objectid/binary) to avoid silent BSON-type corruption', () => {
    expect(isInlineEditable({ $numberInt: '5' }, 'qty')).toBe(false);
    expect(isInlineEditable({ $numberDouble: '5.5' }, 'qty')).toBe(false);
    expect(isInlineEditable({ $numberLong: '5' }, 'qty')).toBe(false);
    expect(isInlineEditable({ $numberDecimal: '5.5' }, 'qty')).toBe(false);
    expect(isInlineEditable({ $date: '2026-01-01T00:00:00Z' }, 'createdAt')).toBe(false);
    expect(isInlineEditable({ $oid: '507f1f77bcf86cd799439011' }, 'userId')).toBe(false);
    expect(isInlineEditable({ $binary: { base64: 'AA==', subType: '00' } }, 'blob')).toBe(false);
  });

  it('rejects boolean, null, array, and plain-object values in v1', () => {
    expect(isInlineEditable(true, 'active')).toBe(false);
    expect(isInlineEditable(null, 'note')).toBe(false);
    expect(isInlineEditable([1, 2], 'tags')).toBe(false);
    expect(isInlineEditable({ city: 'Springfield' }, 'address')).toBe(false);
  });

  it('rejects a plain number too — canonical EJSON never round-trips a bare JS number', () => {
    expect(isInlineEditable(42, 'qty')).toBe(false);
  });
});

describe('stripIdForDuplicate', () => {
  it('returns the document EJSON with _id removed', () => {
    const doc = {
      _id: { $oid: '507f1f77bcf86cd799439011' },
      name: 'alpha',
      qty: { $numberInt: '5' },
    };
    const result = stripIdForDuplicate(doc);
    // the int32 arrives as a plain number now. It re-parses to the same
    // int32, which is the rule that made the drawer safe to relax.
    expect(JSON.parse(result)).toEqual({ name: 'alpha', qty: 5 });
  });

  it('preserves a BSON-typed sibling field across the strip', () => {
    const doc = { _id: 1, price: { $numberDecimal: '9.99' } };
    const result = stripIdForDuplicate(doc);
    expect(JSON.parse(result)).toEqual({ price: { $numberDecimal: '9.99' } });
  });

  it('falls back to "{}" for non-record input', () => {
    expect(stripIdForDuplicate('not a doc')).toBe('{}');
    expect(stripIdForDuplicate(null)).toBe('{}');
    expect(stripIdForDuplicate(42)).toBe('{}');
  });
});
