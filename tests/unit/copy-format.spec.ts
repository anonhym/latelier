import { runInNewContext } from 'node:vm';
import { describe, it, expect } from 'vitest';
import { ObjectId, Long, Decimal128, Int32, Double, Binary, BSONRegExp, Timestamp, MinKey, MaxKey, Code, BSONSymbol } from 'bson';
import {
  COPY_FORMATS,
  COPY_FORMAT_LABELS,
  DEFAULT_COPY_FORMAT,
  MONGOSH_HINT,
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

  it('spells Double, BinData, Timestamp, MinKey and MaxKey as mongosh constructors', () => {
    const out = toMongoshLiteral({
      whole: new Double(2),
      neg: new Double(-0),
      nan: new Double(Number.NaN),
      inf: new Double(Number.NEGATIVE_INFINITY),
      big: new Double(1e300),
      frac: new Double(1.5),
      b: new Binary(new Uint8Array([1, 2]), 0),
      u: new Binary(new Uint8Array([1, 2]), 4),
      t: new Timestamp({ t: 5, i: 1 }),
      lo: new MinKey(),
      hi: new MaxKey(),
    });
    expect(out).toContain('whole: Double(2)');
    expect(out).toContain('neg: Double(-0)');
    expect(out).toContain('nan: Double(NaN)');
    expect(out).toContain('inf: Double(-Infinity)');
    expect(out).toContain('big: Double(1e+300)');
    expect(out).toContain('frac: 1.5');
    expect(out).toContain('b: BinData(0, "AQI=")');
    expect(out).toContain('u: BinData(4, "AQI=")');
    expect(out).toContain('t: Timestamp({ t: 5, i: 1 })');
    expect(out).toContain('lo: MinKey()');
    expect(out).toContain('hi: MaxKey()');
    expect(out).not.toContain('$');
  });

  it.each([
    ['a $numberDouble that is not text', { $numberDouble: 5 }],
    ['a $numberDouble that is not a number', { $numberDouble: '0x10' }],
    ['a $numberDouble that is empty', { $numberDouble: '' }],
    ['a $binary that is not an object', { $binary: 'x' }],
    ['a $binary with an extra key', { $binary: { base64: 'AQI=', subType: '00', more: 1 } }],
    ['a $binary whose subType is not hex', { $binary: { base64: 'AQI=', subType: 'zz' } }],
    ['a $binary whose subType is too long', { $binary: { base64: 'AQI=', subType: '000' } }],
    ['a $binary whose base64 is not base64', { $binary: { base64: 'AQ"I=', subType: '00' } }],
    ['a $binary whose base64 is not text', { $binary: { base64: 5, subType: '00' } }],
    ['a $binary whose subType is not text', { $binary: { base64: 'AQI=', subType: 0 } }],
    ['a $timestamp that is a list', { $timestamp: [1, 2] }],
    ['a $timestamp with an extra key', { $timestamp: { t: 1, i: 1, more: 1 } }],
    ['a $timestamp with a missing part', { $timestamp: { t: 1 } }],
    ['a $timestamp with a negative part', { $timestamp: { t: -1, i: 1 } }],
    ['a $timestamp with a fractional part', { $timestamp: { t: 1, i: 1.5 } }],
    ['a $timestamp with an oversized part', { $timestamp: { t: 2 ** 32, i: 1 } }],
    ['a $timestamp with a text part', { $timestamp: { t: '1', i: 1 } }],
    ['a $timestamp with a text i', { $timestamp: { t: 1, i: '1' } }],
    ['a $minKey that is not 1', { $minKey: 2 }],
    ['a $maxKey that is not 1', { $maxKey: 0 }],
  ])('keeps %s as an object', (_why, sentinel) => {
    const out = toMongoshLiteral({ x: sentinel });
    const key = Object.keys(sentinel)[0];
    const ctor = { $numberDouble: 'Double(', $binary: 'BinData(', $timestamp: 'Timestamp(', $minKey: 'MinKey(', $maxKey: 'MaxKey(' }[key];
    expect(out).not.toContain(`x: ${ctor}`);
    expect(out).toContain(key);
  });

  it('spells the edges: padded and empty base64, the smallest timestamp, +Infinity', () => {
    const out = toMongoshLiteral({
      one: new Binary(new Uint8Array([1]), 0),
      none: new Binary(new Uint8Array([]), 0),
      t: new Timestamp({ t: 0, i: 0 }),
      inf: new Double(Number.POSITIVE_INFINITY),
    });
    expect(out).toContain('one: BinData(0, "AQ==")');
    expect(out).toContain('none: BinData(0, "")');
    expect(out).toContain('t: Timestamp({ t: 0, i: 0 })');
    expect(out).toContain('inf: Double(Infinity)');
  });

  it('reads a document straight from the wire, whose sentinel slots arrive wrapped', () => {
    const wire = JSON.parse(
      ejsonStringify({ t: new Timestamp({ t: 5, i: 2 ** 32 - 1 }), hi: new MaxKey(), lo: new MinKey() }),
    ) as unknown;
    const out = toMongoshLiteral(wire);
    expect(out).toContain(`t: Timestamp({ t: 5, i: ${2 ** 32 - 1} })`);
    expect(out).toContain('hi: MaxKey()');
    expect(out).toContain('lo: MinKey()');
  });

  it.each([
    ['a wrapper that is not text', { $timestamp: { t: { $numberInt: 5 }, i: 1 } }],
    ['a wrapper with company', { $timestamp: { t: { $numberInt: '5', more: 1 }, i: 1 } }],
    ['a wrapper that is not a whole number', { $timestamp: { t: { $numberInt: '5.5' }, i: 1 } }],
    ['a wrapper past the safe integers', { $timestamp: { t: { $numberLong: '9007199254740993' }, i: 1 } }],
  ])('keeps a timestamp with %s as an object', (_why, sentinel) => {
    expect(toMongoshLiteral({ x: sentinel })).not.toContain('x: Timestamp(');
  });

  it('leaves Code, Symbol and DBRef as EJSON objects, as the hint says', () => {
    const out = toMongoshLiteral({ c: new Code('x'), s: new BSONSymbol('y') });
    expect(out).toContain('$code: "x"');
    expect(out).toContain('$symbol: "y"');
    for (const word of ['Code', 'Symbol', 'DBRef', 'undefined']) expect(MONGOSH_HINT).toContain(word);
  });

  it('quotes a key that is not a plain identifier, and keeps $-prefixed names bare', () => {
    const out = toMongoshLiteral({ 'a-b': 1, '1x': 2, ok_$1: 3, '': 4 });
    expect(out).toContain('"a-b": 1');
    expect(out).toContain('"1x": 2');
    expect(out).toContain('  ok_$1: 3');
    expect(out).toContain('"": 4');
  });

  it('writes a key named __proto__ in the computed form, which keeps it an own key', () => {
    // Built from JSON text: an object literal would set the prototype instead.
    const withProto = JSON.parse('{"__proto__": 1, "a": {"__proto__": {"x": 2}}}') as unknown;
    const out = toMongoshLiteral(withProto);
    expect(out).toContain('["__proto__"]: 1');
    expect(out).toContain('["__proto__"]: {');
    expect(out).not.toMatch(/^\s*__proto__:/m);
    // What mongosh evaluates keeps both fields.
    const back = runInNewContext(`(${out})`) as Record<string, unknown>;
    expect(Object.keys(back)).toEqual(['__proto__', 'a']);
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
