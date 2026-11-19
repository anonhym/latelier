import { describe, it, expect } from 'vitest';
import { EJSON, Binary, Decimal128, Int32, Double, Long, ObjectId, UUID } from 'bson';
import {
  findValueMatch,
  isSuppressed,
  MAX_MATCH_DEPTH,
  MAX_NEVER_PAIRS,
  orientPair,
  pairKey,
  pairLabel,
  pendingValuesFor,
  readNeverList,
  withNeverPair,
  type FieldRef,
} from '../../src/utils/referenceDiscovery';

const ID = '507f1f77bcf86cd799439011';
const UUID_TEXT = '00112233-4455-6677-8899-aabbccddeeff';

/** A document as the wire delivers it: canonical EJSON, parsed once, never revived. */
function wire(doc: Record<string, unknown>): unknown {
  return JSON.parse(EJSON.stringify(doc, { relaxed: false }));
}

const f = (dbName: string, collection: string, field: string): FieldRef => ({ dbName, collection, field });
const TAB = { connectionId: 'c1', dbName: 'shop', collection: 'customers' };
const ORIGIN = {
  connectionId: 'c1',
  dbName: 'shop',
  collection: 'orders',
  fieldPath: 'customerId',
  distinctive: [ID],
};

describe('pendingValuesFor', () => {
  it('returns the copied values the paste carries', () => {
    expect(pendingValuesFor(ORIGIN, TAB, `{ _id: ObjectId("${ID}") }`)).toEqual([ID]);
  });

  it('matches a hex id without regard to case', () => {
    expect(pendingValuesFor(ORIGIN, TAB, ID.toUpperCase())).toEqual([ID]);
  });

  it('keeps only the values that appear', () => {
    const other = 'ffffffffffffffffffffffff';
    expect(pendingValuesFor({ ...ORIGIN, distinctive: [other, ID] }, TAB, ID)).toEqual([ID]);
  });

  it('starts nothing without a Copy Origin', () => {
    expect(pendingValuesFor(null, TAB, ID)).toBeNull();
  });

  it('starts nothing when the copy came from no single field', () => {
    expect(pendingValuesFor({ ...ORIGIN, fieldPath: undefined }, TAB, ID)).toBeNull();
  });

  it('starts nothing for another Connection', () => {
    expect(pendingValuesFor({ ...ORIGIN, connectionId: 'c2' }, TAB, ID)).toBeNull();
  });

  it('starts nothing for the same Collection', () => {
    expect(pendingValuesFor(ORIGIN, { ...TAB, collection: 'orders' }, ID)).toBeNull();
  });

  it('starts for the same Collection name in another Database', () => {
    expect(pendingValuesFor(ORIGIN, { ...TAB, dbName: 'archive', collection: 'orders' }, ID)).toEqual([ID]);
  });

  it('starts for another Collection in the same Database', () => {
    expect(pendingValuesFor(ORIGIN, { ...TAB, dbName: 'shop' }, ID)).toEqual([ID]);
  });

  it('starts nothing when the paste carries no copied value', () => {
    expect(pendingValuesFor(ORIGIN, TAB, '{ name: "x" }')).toBeNull();
  });

  it('reads no more than the scan cap of the paste', () => {
    expect(pendingValuesFor(ORIGIN, TAB, `${' '.repeat(256 * 1024)}${ID}`)).toBeNull();
  });
});

describe('findValueMatch', () => {
  it('finds a string at a top-level field', () => {
    expect(findValueMatch([{ _id: 1, email: 'alice@example.com' }], ['alice@example.com'])).toBe('email');
  });

  it('finds an ObjectId, case-insensitively', () => {
    const doc = wire({ _id: new ObjectId(ID), ref: new ObjectId(ID) });
    expect(findValueMatch([doc], [ID])).toBe('_id');
    expect(findValueMatch([wire({ ref: new ObjectId(ID) })], [ID])).toBe('ref');
  });

  it('finds Int32, Double, Long and Decimal128 by their decimal text', () => {
    const doc = wire({ a: new Int32(1234567), b: new Double(1234567.5), c: new Long('12345678901'), d: Decimal128.fromString('99999999.25') });
    expect(findValueMatch([doc], ['1234567'])).toBe('a');
    expect(findValueMatch([doc], ['1234567.5'])).toBe('b');
    expect(findValueMatch([doc], ['12345678901'])).toBe('c');
    expect(findValueMatch([doc], ['99999999.25'])).toBe('d');
  });

  it('finds a plain JSON number by its text', () => {
    expect(findValueMatch([{ n: 1234567 }], ['1234567'])).toBe('n');
  });

  it('finds a UUID, and a Binary by its base64', () => {
    const bin = Binary.createFromHexString('00112233445566778899aabbccddeeff', Binary.SUBTYPE_UUID);
    const doc = wire({ ref: bin });
    expect(findValueMatch([doc], [UUID_TEXT])).toBe('ref');
    expect(findValueMatch([doc], [bin.toString('base64')])).toBe('ref');
    expect(findValueMatch([wire({ ref: new UUID(UUID_TEXT) })], [UUID_TEXT])).toBe('ref');
  });

  it('reads a UUID only from a subtype 4 Binary of 16 bytes', () => {
    const generic = wire({ ref: Binary.createFromHexString('00112233445566778899aabbccddeeff', Binary.SUBTYPE_DEFAULT) });
    expect(findValueMatch([generic], [UUID_TEXT])).toBeNull();
    const short = wire({ ref: new Binary(Buffer.from('0011', 'hex'), Binary.SUBTYPE_UUID) });
    expect(findValueMatch([short], [UUID_TEXT])).toBeNull();
    const notBase64 = { ref: { $binary: { base64: '!!!!', subType: '04' } } };
    expect(findValueMatch([notBase64], [UUID_TEXT])).toBeNull();
    expect(findValueMatch([notBase64], ['!!!!'])).toBe('ref');
  });

  it('ignores a malformed Binary or sentinel', () => {
    expect(findValueMatch([{ a: { $binary: 'AAAAAAAA' } }], ['AAAAAAAA'])).toBeNull();
    expect(findValueMatch([{ a: { $binary: { subType: '04' } } }], ['AAAAAAAA'])).toBeNull();
    expect(findValueMatch([{ a: { $binary: null } }], ['AAAAAAAA'])).toBeNull();
    expect(findValueMatch([{ a: { $oid: 5 } }], ['5'])).toBeNull();
  });

  it('does not match a value that only contains the text', () => {
    expect(findValueMatch([{ note: 'see alice@example.com today' }], ['alice@example.com'])).toBeNull();
  });

  it('does not match a string that differs only in case, unless it is a hex id', () => {
    expect(findValueMatch([{ name: 'ALICE-0001' }], ['alice-0001'])).toBeNull();
  });

  it('does not read booleans, null, dates or other values as text', () => {
    expect(findValueMatch([{ a: true, b: null, c: { $date: '2026-01-01T00:00:00Z' }, d: [] }], ['true', 'null', '2026-01-01T00:00:00Z'])).toBeNull();
    expect(findValueMatch([{ a: { $date: { $numberLong: '1234567' } } }], ['1234567'])).toBeNull();
  });

  it('gives the path through nested objects', () => {
    expect(findValueMatch([{ a: { b: { c: 'needle-value' } } }], ['needle-value'])).toBe('a.b.c');
  });

  it('gives an array field its own path, with no index', () => {
    expect(findValueMatch([{ tags: ['x', 'needle-value'] }], ['needle-value'])).toBe('tags');
    expect(findValueMatch([{ items: [{ sku: 'a' }, { sku: 'needle-value' }] }], ['needle-value'])).toBe('items.sku');
  });

  it('prefers _id, then the first field in document order', () => {
    expect(findValueMatch([{ a: 'needle-value', _id: 'needle-value' }], ['needle-value'])).toBe('_id');
    expect(findValueMatch([{ a: 'needle-value', b: 'needle-value' }], ['needle-value'])).toBe('a');
  });

  it('does not name _id for a match inside an embedded _id', () => {
    expect(findValueMatch([{ _id: { k: 'needle-value' } }], ['needle-value'])).toBe('_id.k');
  });

  it('takes the first document that holds a match', () => {
    expect(findValueMatch([{ x: 'no' }, { y: 'needle-value' }, { z: 'needle-value' }], ['needle-value'])).toBe('y');
  });

  it('accepts any of several values', () => {
    expect(findValueMatch([{ a: 'second-value' }], ['first-value', 'second-value'])).toBe('a');
  });

  it('looks no deeper than the depth limit', () => {
    const nest = (levels: number): unknown => {
      let node: unknown = 'needle-value';
      for (let i = 0; i < levels - 1; i += 1) node = { k: node };
      return node;
    };
    const atLimit = { top: nest(MAX_MATCH_DEPTH) };
    const beyond = { top: nest(MAX_MATCH_DEPTH + 1) };
    expect(findValueMatch([atLimit], ['needle-value'])).toBe(`top${'.k'.repeat(MAX_MATCH_DEPTH - 1)}`);
    expect(findValueMatch([beyond], ['needle-value'])).toBeNull();
  });

  it('counts an array as one level on the way down', () => {
    let node: unknown = 'needle-value';
    for (let i = 0; i < MAX_MATCH_DEPTH - 1; i += 1) node = [node];
    expect(findValueMatch([{ f: node }], ['needle-value'])).toBe('f');
    expect(findValueMatch([{ f: [node] }], ['needle-value'])).toBeNull();
  });

  it('finds nothing without values, without documents, or in a non-document', () => {
    expect(findValueMatch([{ a: 'needle-value' }], [])).toBeNull();
    expect(findValueMatch([], ['needle-value'])).toBeNull();
    expect(findValueMatch([null, 'needle-value', ['needle-value'], 7], ['needle-value'])).toBeNull();
  });

  it('reads a field literally named like a prototype key', () => {
    const doc = JSON.parse('{"__proto__": "needle-value"}') as unknown;
    expect(findValueMatch([doc], ['needle-value'])).toBe('__proto__');
  });
});

describe('orientPair', () => {
  it('points from the copied field to the field it was found in', () => {
    const origin = f('shop', 'orders', 'customerEmail');
    const matched = f('shop', 'customers', 'email');
    expect(orientPair(origin, matched)).toEqual({ source: origin, target: matched });
  });

  it('keeps the copied field as the source when it is found in an _id', () => {
    const origin = f('shop', 'orders', 'customerId');
    const matched = f('shop', 'customers', '_id');
    expect(orientPair(origin, matched)).toEqual({ source: origin, target: matched });
  });

  it('turns a copied _id found in another field around', () => {
    const origin = f('shop', 'customers', '_id');
    const matched = f('shop', 'orders', 'customerId');
    expect(orientPair(origin, matched)).toEqual({ source: matched, target: origin });
  });

  it('suggests nothing for two _ids', () => {
    expect(orientPair(f('shop', 'a', '_id'), f('shop', 'b', '_id'))).toBeNull();
  });
});

describe('pairKey and pairLabel', () => {
  const pair = { source: f('shop', 'orders', 'customerId'), target: f('crm', 'customers', '_id') };

  it('spells the Connection, then each side in full', () => {
    expect(pairKey('c1', pair)).toBe('c1|shop.orders.customerId->crm.customers._id');
  });

  it('differs by Connection and by direction', () => {
    expect(pairKey('c2', pair)).not.toBe(pairKey('c1', pair));
    expect(pairKey('c1', { source: pair.target, target: pair.source })).not.toBe(pairKey('c1', pair));
  });

  it('labels the rule without the Database', () => {
    expect(pairLabel(pair)).toBe('orders.customerId → customers._id');
  });
});

describe('isSuppressed', () => {
  const source = f('shop', 'orders', 'customerId');
  const base = { key: 'k', source, never: [] as string[], declined: false, rules: [] as { sourceDb: string; sourceCollection: string; sourceField: string }[] };

  it('lets a fresh pair through', () => {
    expect(isSuppressed(base)).toBe(false);
  });

  it('suppresses a pair marked Never, and only that pair', () => {
    expect(isSuppressed({ ...base, never: ['other', 'k'] })).toBe(true);
    expect(isSuppressed({ ...base, never: ['other'] })).toBe(false);
  });

  it('suppresses a pair declined for this copy', () => {
    expect(isSuppressed({ ...base, declined: true })).toBe(true);
  });

  it('suppresses when a rule already covers the source field, to any target', () => {
    expect(isSuppressed({ ...base, rules: [{ sourceDb: 'shop', sourceCollection: 'orders', sourceField: 'customerId' }] })).toBe(true);
  });

  it('is not suppressed by a rule for another field, Collection or Database', () => {
    const rule = { sourceDb: 'shop', sourceCollection: 'orders', sourceField: 'customerId' };
    expect(isSuppressed({ ...base, rules: [{ ...rule, sourceField: 'other' }] })).toBe(false);
    expect(isSuppressed({ ...base, rules: [{ ...rule, sourceCollection: 'invoices' }] })).toBe(false);
    expect(isSuppressed({ ...base, rules: [{ ...rule, sourceDb: 'archive' }] })).toBe(false);
  });
});

describe('the Never list', () => {
  it('reads only strings from what is stored', () => {
    expect(readNeverList(['a', 5, null, 'b'])).toEqual(['a', 'b']);
    expect(readNeverList(null)).toEqual([]);
    expect(readNeverList('a')).toEqual([]);
    expect(readNeverList({ 0: 'a' })).toEqual([]);
  });

  it('appends a pair once, last', () => {
    expect(withNeverPair(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(withNeverPair(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a']);
  });

  it('drops the oldest pair when it is full', () => {
    const full = Array.from({ length: MAX_NEVER_PAIRS }, (_, i) => `k${i}`);
    const next = withNeverPair(full, 'new');
    expect(next).toHaveLength(MAX_NEVER_PAIRS);
    expect(next[0]).toBe('k1');
    expect(next.at(-1)).toBe('new');
    expect(withNeverPair(full.slice(0, MAX_NEVER_PAIRS - 1), 'new')).toHaveLength(MAX_NEVER_PAIRS);
  });
});
