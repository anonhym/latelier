import { describe, it, expect } from 'vitest';
import { ObjectId, Long, Decimal128, Int32, Double, Binary, BSONRegExp, Timestamp } from 'bson';
import {
  COPY_FORMATS,
  COPY_FORMAT_LABELS,
  DEFAULT_COPY_FORMAT,
  formatDocsForCopy,
  toMongoshLiteral,
} from '../../src/utils/copyFormat';
import { ejsonStringify } from '../../src/utils/ejson';

const OID = '507f1f77bcf86cd799439011';
const doc = {
  _id: new ObjectId(OID),
  qty: new Int32(7),
  big: Long.fromString('9007199254740993'),
  price: Decimal128.fromString('1.50'),
  at: new Date('2025-01-31T10:00:00.000Z'),
  ratio: new Double(0.5),
  name: 'alpha',
};

describe('formatDocsForCopy', () => {
  it('defaults to readable EJSON and names its three formats', () => {
    expect(DEFAULT_COPY_FORMAT).toBe('readable');
    expect(COPY_FORMATS).toEqual(['readable', 'canonical', 'mongosh']);
    expect(COPY_FORMAT_LABELS).toEqual({
      readable: 'EJSON (readable)',
      canonical: 'Canonical EJSON',
      mongosh: 'mongosh',
    });
  });

  it('readable unwraps ints, doubles and dates but keeps a 64-bit integer exact', () => {
    expect(JSON.parse(formatDocsForCopy([doc], 'readable'))).toEqual({
      _id: { $oid: OID },
      qty: 7,
      big: { $numberLong: '9007199254740993' },
      price: { $numberDecimal: '1.50' },
      at: { $date: '2025-01-31T10:00:00.000Z' },
      ratio: 0.5,
      name: 'alpha',
    });
  });

  it('canonical keeps every wrapper', () => {
    const parsed = JSON.parse(formatDocsForCopy([doc], 'canonical'));
    expect(parsed.qty).toEqual({ $numberInt: '7' });
    expect(parsed.ratio).toEqual({ $numberDouble: '0.5' });
    expect(parsed.at).toEqual({ $date: { $numberLong: '1738317600000' } });
    expect(formatDocsForCopy([doc], 'canonical')).toBe(ejsonStringify(doc, 2));
  });

  it('writes one document bare and several as an array, in every format', () => {
    for (const format of COPY_FORMATS) {
      expect(formatDocsForCopy([doc], format).trimStart().startsWith('{')).toBe(true);
      expect(formatDocsForCopy([doc, doc], format).trimStart().startsWith('[')).toBe(true);
    }
    expect(formatDocsForCopy([], 'readable')).toBe('[]');
  });

  it('indents with two spaces', () => {
    expect(formatDocsForCopy([{ a: 'x' }], 'readable')).toBe('{\n  "a": "x"\n}');
  });
});

describe('toMongoshLiteral', () => {
  it('spells the types the shell has constructors for, with unquoted keys', () => {
    expect(toMongoshLiteral(doc)).toBe(
      [
        '{',
        `  _id: ObjectId("${OID}"),`,
        '  qty: 7,',
        '  big: NumberLong("9007199254740993"),',
        '  price: NumberDecimal("1.50"),',
        '  at: ISODate("2025-01-31T10:00:00.000Z"),',
        '  ratio: 0.5,',
        '  name: "alpha"',
        '}',
      ].join('\n'),
    );
  });

  it('prints a regex as a literal', () => {
    expect(toMongoshLiteral({ r: new BSONRegExp('^ac.me', 'im') })).toBe('{\n  r: /^ac.me/im\n}');
  });

  it.each([
    ['an unescaped slash', new BSONRegExp('a/b', 'i')],
    ['an empty pattern', new BSONRegExp('', 'i')],
    ['a flag the shell has no spelling for', new BSONRegExp('abc', 'x')],
    ['a pattern JavaScript cannot read', new BSONRegExp('(?i)abc', '')],
    ['a line break', new BSONRegExp('a\nb', '')],
  ])('keeps a regex with %s as its EJSON object', (_why, re) => {
    const out = toMongoshLiteral({ r: re });
    expect(out).toContain('$regularExpression');
    expect(out).not.toMatch(/r: \//);
  });

  it('leaves the types without a constructor as EJSON objects', () => {
    const out = toMongoshLiteral({
      b: new Binary(new Uint8Array([1, 2]), 0),
      t: new Timestamp({ t: 5, i: 1 }),
      whole: new Double(2),
    });
    expect(out).toContain('$binary: {');
    expect(out).toContain('$timestamp: {');
    expect(out).toContain('$numberDouble: "2.0"');
  });

  it('quotes a key that is not a plain identifier, and keeps $-prefixed names bare', () => {
    const out = toMongoshLiteral({ 'a-b': 1, '1x': 2, ok_$1: 3, '': 4 });
    expect(out).toContain('"a-b": 1');
    expect(out).toContain('"1x": 2');
    expect(out).toContain('  ok_$1: 3');
    expect(out).toContain('"": 4');
  });

  it('keeps a key named __proto__ as an own key', () => {
    const withProto = JSON.parse('{"__proto__": 1, "a": 2}') as unknown;
    expect(toMongoshLiteral(withProto)).toContain('__proto__: 1');
  });

  it('prints empty and nested containers', () => {
    expect(toMongoshLiteral({})).toBe('{}');
    expect(toMongoshLiteral([])).toBe('[]');
    expect(toMongoshLiteral({ a: [1, { b: null }], c: {} })).toBe(
      '{\n  a: [\n    1,\n    {\n      b: null\n    }\n  ],\n  c: {}\n}',
    );
  });

  it('keeps a $date that is not a date as an object', () => {
    expect(toMongoshLiteral(JSON.parse('{"x":{"$date":"not a date"}}'))).not.toContain('ISODate');
  });

  it('escapes strings the JSON way', () => {
    expect(toMongoshLiteral({ s: 'a"b\n' })).toBe('{\n  s: "a\\"b\\n"\n}');
  });

  it('prints a regex with each option on its own, and with none', () => {
    for (const options of ['', 'i', 'm', 's', 'u', 'ims', 'imsu']) {
      expect(toMongoshLiteral({ r: new BSONRegExp('ab', options) })).toBe(`{\n  r: /ab/${options}\n}`);
    }
  });

  it('keeps a regex with a JavaScript-only flag as its EJSON object', () => {
    // `g` is a flag JavaScript accepts and MongoDB does not: it must not pass for an option.
    const out = toMongoshLiteral({ r: { $regularExpression: { pattern: 'ab', options: 'g' } } });
    expect(out).toContain('$regularExpression');
  });

  it.each([
    ['an $oid that is not text', { $oid: 5 }],
    ['a $numberLong that is not text', { $numberLong: 5 }],
    ['a $numberDecimal that is not text', { $numberDecimal: 5 }],
    ['a $date that is not text', { $date: 5 }],
    ['a $date that is a list', { $date: ['5'] }],
    ['a $regularExpression that is not an object', { $regularExpression: 'x' }],
    ['a $regularExpression that is null', { $regularExpression: null }],
    ['a regex whose pattern is not text', { $regularExpression: { pattern: 5, options: 'i' } }],
    ['a regex whose options are not text', { $regularExpression: { pattern: 'ab', options: [] } }],
    ['a regex with no options key', { $regularExpression: { pattern: 'ab' } }],
  ])('keeps %s as an object', (_why, sentinel) => {
    const out = toMongoshLiteral({ x: sentinel });
    expect(out).not.toMatch(/ObjectId\(|NumberLong\(|NumberDecimal\(|ISODate\(|x: \//);
    expect(out).toContain(Object.keys(sentinel)[0]);
  });

  it('keeps a sentinel key that has company as an ordinary object', () => {
    const out = toMongoshLiteral({ x: { $oid: OID, extra: 1 } });
    expect(out).not.toContain('ObjectId(');
    expect(out).toContain(`$oid: "${OID}"`);
    expect(out).toContain('extra: 1');
  });

  it('formatDocsForCopy picks the mongosh literal for the mongosh format', () => {
    expect(formatDocsForCopy([{ _id: new ObjectId(OID) }], 'mongosh')).toBe(`{\n  _id: ObjectId("${OID}")\n}`);
  });
});
