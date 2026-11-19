import { describe, it, expect } from 'vitest';
import { BSONRegExp, BSONSymbol, Binary, Code, DBRef, Decimal128, Double, Int32, Long, MaxKey, MinKey, ObjectId, Timestamp, UUID } from 'bson';
import {
  ARRAY_SEGMENT,
  MAX_DEPTH,
  MAX_PATHS,
  MAX_SEGMENT,
  SchemaAccumulator,
  bsonTypeOf,
  inferSchema,
} from '../../electron/agent/schemaInfer';

const byPath = (docs: unknown[]) => Object.fromEntries(inferSchema(docs).fields.map((f) => [f.path, f]));

describe('bsonTypeOf', () => {
  it.each<[string, unknown, string]>([
    ['Int32', new Int32(1), 'int'],
    ['Long', Long.fromNumber(1), 'long'],
    ['Double', new Double(1.5), 'double'],
    ['Decimal128', Decimal128.fromString('1'), 'decimal'],
    ['ObjectId', new ObjectId(), 'objectId'],
    ['Date', new Date(0), 'date'],
    ['Binary', new Binary(Buffer.from('a')), 'binData'],
    ['UUID', new UUID(), 'binData'],
    ['BSONRegExp', new BSONRegExp('a', 'i'), 'regex'],
    ['Timestamp', new Timestamp({ t: 1, i: 1 }), 'timestamp'],
    ['MinKey', new MinKey(), 'minKey'],
    ['MaxKey', new MaxKey(), 'maxKey'],
    ['Code', new Code('x'), 'javascript'],
    ['BSONSymbol', new BSONSymbol('x'), 'symbol'],
    ['DBRef', new DBRef('c', new ObjectId()), 'object'],
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
    ['string', 'a', 'string'],
    ['boolean', true, 'bool'],
    ['a JS number', 3, 'double'],
    ['a bigint', 3n, 'long'],
    ['an array', [], 'array'],
    ['a plain object', {}, 'object'],
    ['a null-prototype object', Object.create(null), 'object'],
    ['a function', () => 1, 'unknown'],
    ['a symbol', Symbol('s'), 'unknown'],
    ['a class instance with no BSON tag', new (class Foo {})(), 'unknown'],
    ['a class instance with an unlisted tag', Object.assign(new (class Foo {})(), { _bsontype: 'Nope' }), 'unknown'],
  ])('names %s', (_label, value, expected) => {
    expect(bsonTypeOf(value)).toBe(expected);
  });

  it('does not let a field called _bsontype turn a document into a BSON value', () => {
    expect(bsonTypeOf({ _bsontype: 'Int32', value: 5 })).toBe('object');
  });

  it('does not take a type name from an inherited or non-string tag', () => {
    expect(bsonTypeOf(Object.assign(new (class Foo {})(), { _bsontype: 7 }))).toBe('unknown');
    // `Int32` is in the table; a prototype-chain name such as `constructor` must not resolve through it.
    expect(bsonTypeOf(Object.assign(new (class Foo {})(), { _bsontype: 'constructor' }))).toBe('unknown');
    expect(bsonTypeOf(Object.assign(new (class Foo {})(), { _bsontype: '__proto__' }))).toBe('unknown');
  });
});

describe('inferSchema', () => {
  it('reports every top-level path with its type, its document count and its frequency', () => {
    const r = inferSchema([{ a: 1n, b: 'x' }, { a: 2n }, { a: 'str' }, {}]);
    expect(r.sampled).toBe(4);
    expect(r.fields).toEqual([
      { path: 'a', types: { long: 2, string: 1 }, docs: 3, frequency: 0.75 },
      { path: 'b', types: { string: 1 }, docs: 1, frequency: 0.25 },
    ]);
    expect(r.pathsTruncated).toBe(false);
  });

  it('walks nested documents with dotted paths', () => {
    const f = byPath([{ user: { name: 'a', geo: { lat: new Double(1) } } }]);
    expect(Object.keys(f)).toEqual(['user', 'user.geo', 'user.geo.lat', 'user.name']);
    expect(f.user!.types).toEqual({ object: 1 });
    expect(f['user.geo.lat']!.types).toEqual({ double: 1 });
  });

  it('puts array elements at path.[] and counts an element per occurrence but a document once', () => {
    const f = byPath([{ tags: ['a', 'b', 3n] }, { tags: [] }]);
    expect(f.tags).toMatchObject({ types: { array: 2 }, docs: 2, frequency: 1 });
    expect(f[`tags.${ARRAY_SEGMENT}`]).toEqual({ path: 'tags.[]', types: { long: 1, string: 2 }, docs: 1, frequency: 0.5 });
  });

  it('descends into objects held in arrays and arrays held in arrays', () => {
    const f = byPath([{ items: [{ sku: 'a', qty: new Int32(1) }, { sku: 'b' }], grid: [[1, 2], [3]] }]);
    expect(f['items.[].sku']).toMatchObject({ types: { string: 2 }, docs: 1 });
    expect(f['items.[].qty']).toMatchObject({ types: { int: 1 }, docs: 1 });
    expect(f['grid.[]']!.types).toEqual({ array: 2 });
    expect(f['grid.[].[]']!.types).toEqual({ double: 3 });
  });

  it('reports the BSON types of the matrix, by their $type names', () => {
    const f = byPath([
      {
        i: new Int32(1),
        l: Long.fromNumber(2),
        d: new Double(3.5),
        dec: Decimal128.fromString('1'),
        oid: new ObjectId(),
        at: new Date(0),
        bin: new Binary(Buffer.from('x')),
        re: new BSONRegExp('a'),
        ts: new Timestamp({ t: 1, i: 1 }),
        n: null,
        arr: [],
        obj: {},
      },
    ]);
    const typeOf = (path: string) => Object.keys(f[path]!.types)[0];
    expect(Object.fromEntries(Object.keys(f).map((p) => [p, typeOf(p)]))).toEqual({
      arr: 'array',
      at: 'date',
      bin: 'binData',
      d: 'double',
      dec: 'decimal',
      i: 'int',
      l: 'long',
      n: 'null',
      obj: 'object',
      oid: 'objectId',
      re: 'regex',
      ts: 'timestamp',
    });
  });

  it('sorts paths and the types of a path with localeCompare', () => {
    const f = inferSchema([{ b: 'x', a: true }, { b: 1n, a: 1n, B: 1n }]).fields;
    expect(f.map((x) => x.path)).toEqual(['a', 'b', 'B'].sort((x, y) => x.localeCompare(y)));
    expect(Object.keys(f.find((x) => x.path === 'b')!.types)).toEqual(['long', 'string']);
  });

  it('rounds the frequency to four places', () => {
    const docs = [{ a: 1n }, {}, {}];
    expect(inferSchema(docs).fields[0]!.frequency).toBe(0.3333);
    expect(inferSchema([{ a: 1n }, {}, {}, {}, {}, {}, {}]).fields[0]!.frequency).toBe(0.1429);
  });

  it('returns no fields, and no division by zero, for an empty sample', () => {
    expect(inferSchema([])).toEqual({ sampled: 0, fields: [], pathsTruncated: false });
  });

  it('ignores a sample entry that is not a document', () => {
    const r = inferSchema([null, 5, 'x', [1, 2], { a: 1n }]);
    expect(r.sampled).toBe(1);
    expect(r.fields.map((x) => x.path)).toEqual(['a']);
  });

  it('cuts each field name to 256 characters, in the middle of a path as well', () => {
    const long = 'k'.repeat(400);
    const f = inferSchema([{ [long]: { [long]: 1n } }]).fields;
    expect(f.map((x) => x.path)).toEqual(['k'.repeat(MAX_SEGMENT), `${'k'.repeat(MAX_SEGMENT)}.${'k'.repeat(MAX_SEGMENT)}`]);
    expect(inferSchema([{ [`${'k'.repeat(MAX_SEGMENT)}`]: 1n }]).fields[0]!.path).toHaveLength(MAX_SEGMENT);
  });

  it('keeps a __proto__ field an ordinary path and does not touch Object.prototype', () => {
    const doc = JSON.parse('{"__proto__": {"polluted": 1}, "constructor": 2}') as unknown;
    const r = inferSchema([doc]);
    expect(r.fields.map((x) => x.path)).toEqual(['constructor', '__proto__', '__proto__.polluted'].sort((a, b) => a.localeCompare(b)));
    expect(({} as { polluted?: number }).polluted).toBeUndefined();
  });

  it('stops descending at MAX_DEPTH, and still records the path that holds the deeper value', () => {
    let doc: Record<string, unknown> = { leaf: 1n };
    for (let i = 0; i < MAX_DEPTH + 5; i += 1) doc = { n: doc };
    const paths = inferSchema([doc]).fields.map((f) => f.path);
    expect(paths).toHaveLength(MAX_DEPTH);
    expect(paths.at(-1)).toBe(Array.from({ length: MAX_DEPTH }, () => 'n').join('.'));
    // One level inside the cap everything is still seen.
    let ok: Record<string, unknown> = { leaf: 1n };
    for (let i = 0; i < MAX_DEPTH - 2; i += 1) ok = { n: ok };
    expect(inferSchema([ok]).fields.some((f) => f.path.endsWith('.leaf'))).toBe(true);
  });

  it('caps the number of distinct paths, flags it, and keeps counting the paths it already has', () => {
    const wide = Object.fromEntries(Array.from({ length: MAX_PATHS + 10 }, (_, i) => [`f${i}`, 1n]));
    const r = inferSchema([wide, { f0: 2n }]);
    expect(r.fields).toHaveLength(MAX_PATHS);
    expect(r.pathsTruncated).toBe(true);
    expect(r.fields.find((f) => f.path === 'f0')).toMatchObject({ docs: 2 });
  });

  it('is not flagged when the paths fit exactly', () => {
    const exact = Object.fromEntries(Array.from({ length: MAX_PATHS }, (_, i) => [`f${i}`, 1n]));
    expect(inferSchema([exact]).pathsTruncated).toBe(false);
  });

  it('accepts documents one at a time and can be read more than once', () => {
    const acc = new SchemaAccumulator();
    acc.add({ a: 1n });
    expect(acc.result().sampled).toBe(1);
    acc.add({ a: 2n });
    expect(acc.result().fields[0]).toMatchObject({ docs: 2 });
  });
});

describe('what leaves the module', () => {
  const LEAVES = [
    'LEAF-secret-string',
    'ssn-123-45-6789',
    'p4ssw0rd-hunter2',
    'user@example.com',
    '4111111111111111',
    'a-very-private-note',
  ];

  it('never contains a value from any document', () => {
    const oid = new ObjectId('507f1f77bcf86cd799439011');
    const docs = [
      {
        _id: oid,
        name: LEAVES[0],
        profile: { ssn: LEAVES[1], password: LEAVES[2], contacts: [{ email: LEAVES[3] }, LEAVES[3]] },
        card: LEAVES[4],
        notes: [LEAVES[5], [LEAVES[5]]],
        amount: Decimal128.fromString('98765.4321'),
        big: Long.fromString('9007199254740993'),
        d: new Double(31337.5),
        at: new Date('2024-05-06T07:08:09.000Z'),
        re: new BSONRegExp('secret-pattern', 'i'),
        bin: new Binary(Buffer.from('binary-secret')),
        code: new Code('function secretCode() {}'),
        n: 424242,
      },
    ];
    const out = JSON.stringify(inferSchema(docs));
    for (const leaf of LEAVES) expect(out).not.toContain(leaf);
    for (const needle of ['507f1f77bcf86cd799439011', '98765', '9007199254740993', '31337', '2024-05-06', 'secret-pattern', 'binary-secret', 'secretCode', '424242']) {
      expect(out).not.toContain(needle);
    }
    // Field names are what is left.
    expect(out).toContain('profile.contacts.[].email');
  });

  it('holds only field names, a fixed set of type names, and numbers', () => {
    const r = inferSchema([{ a: 'v1', b: { c: [1n, 'v2'] }, d: new Date(0) }]);
    const allowedTypes = new Set(['int', 'long', 'double', 'decimal', 'objectId', 'date', 'binData', 'regex', 'timestamp', 'minKey', 'maxKey', 'javascript', 'symbol', 'null', 'undefined', 'string', 'bool', 'array', 'object', 'unknown']);
    for (const f of r.fields) {
      expect(Object.keys(f).sort((x, y) => x.localeCompare(y))).toEqual(['docs', 'frequency', 'path', 'types']);
      for (const [type, n] of Object.entries(f.types)) {
        expect(allowedTypes.has(type)).toBe(true);
        expect(typeof n).toBe('number');
      }
    }
  });
});
