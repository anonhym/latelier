import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  ObjectId,
  Long,
  Decimal128,
  Binary,
  Int32,
  Double,
  BSONRegExp,
  BSONSymbol,
  MinKey,
  MaxKey,
  Timestamp,
} from 'bson';
import { ejsonParse, ejsonStringify, isPlainDocument } from '../../electron/mongo/ejson';
import { ejsonParse as ejsonParseRenderer } from '../../src/utils/ejson';

// BSON leaf values built from real driver constructors, not hand-shaped
// EJSON sentinels — see feedback_probe_bson_with_real_values.md: a
// hand-built `{$numberDouble:"2"}` and `new Double(2)` can disagree.
//
// Long/Decimal128 cover their documented boundaries (Long.MIN_VALUE/
// MAX_VALUE, Decimal128's max/min magnitude and its NaN/Infinity/-0
// special values) alongside the general-purpose generators — each verified
// via a real round-trip probe (not assumed) to actually revive to the same
// constructor before being added here.
const regexPatternChar = fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789 ._-");
// Deliberately excludes regex metacharacters: an arbitrary printable string
// is often not a *valid* regex source, and validateRegexPattern rejects it —
// that would fail the property for reasons unrelated to what it tests.
const safeRegexPattern = fc
  .array(regexPatternChar, { minLength: 1, maxLength: 20 })
  .map((chars) => chars.join(''));
// BSONRegExp's own constructor only accepts these six option letters (not
// JS's 'g'/'y') — see bson's regexp.ts validateOptions.
const regexFlags = fc.subarray([...'imxlsu']).map((flags) => flags.join(''));

const longExtreme = fc.oneof(
  fc.constant(Long.MIN_VALUE),
  fc.constant(Long.MAX_VALUE),
  fc.bigInt({ min: -(2n ** 63n), max: 2n ** 63n - 1n }).map((n) => Long.fromString(n.toString())),
);

const decimal128Extreme = fc.oneof(
  fc.float({ noNaN: true }).map((n) => Decimal128.fromString(n.toString())),
  fc.constantFrom('NaN', 'Infinity', '-Infinity', '-0', '0').map((s) => Decimal128.fromString(s)),
  fc.constantFrom(
    '9999999999999999999999999999999999E+6111', // max magnitude
    '1E-6176', // min (subnormal) magnitude
  ).map((s) => Decimal128.fromString(s)),
);

const binaryVaried = fc.oneof(
  fc
    .record({
      bytes: fc.uint8Array({ maxLength: 4096 }),
      // 0x04 (UUID) excluded here — the driver's UUID subtype requires
      // exactly 16 bytes, unlike every other subtype, so it needs its own
      // generator below rather than an arbitrary-length byte array.
      subType: fc.constantFrom(0x00, 0x01, 0x03, 0x05, 0x80, 0xff),
    })
    .map(({ bytes, subType }) => new Binary(bytes, subType)),
  fc.uint8Array({ minLength: 16, maxLength: 16 }).map((bytes) => new Binary(bytes, 0x04)),
);

const bsonLeaf = fc.oneof(
  fc.string(),
  fc.boolean(),
  fc.constant(null),
  fc.date({ noInvalidDate: true }).map((d) => new Date(Math.floor(d.getTime()))),
  fc.constant(null).map(() => new ObjectId()),
  longExtreme,
  decimal128Extreme,
  binaryVaried,
  fc.integer({ min: -(2 ** 31), max: 2 ** 31 - 1 }).map((n) => new Int32(n)),
  fc.float({ noNaN: true }).map((n) => new Double(n)),
  fc.tuple(safeRegexPattern, regexFlags).map(([pattern, flags]) => new BSONRegExp(pattern, flags)),
  fc.string({ minLength: 1 }).map((s) => new BSONSymbol(s)),
  fc.constant(null).map(() => new MinKey()),
  fc.constant(null).map(() => new MaxKey()),
  fc
    .record({ t: fc.integer({ min: 0, max: 0xffffffff }), i: fc.integer({ min: 0, max: 0xffffffff }) })
    .map(({ t, i }) => new Timestamp({ t, i })),
);

const bsonDoc = fc.dictionary(fc.string({ minLength: 1, maxLength: 12 }), bsonLeaf, { maxKeys: 8 });

function expectBsonEqual(revived: unknown, original: unknown): void {
  if (original instanceof Date) {
    expect(revived).toBeInstanceOf(Date);
    expect((revived as Date).getTime()).toBe(original.getTime());
  } else if (original instanceof ObjectId) {
    expect(revived).toBeInstanceOf(ObjectId);
    expect((revived as ObjectId).toHexString()).toBe(original.toHexString());
  } else if (original instanceof Long) {
    expect(revived).toBeInstanceOf(Long);
    expect(String(revived)).toBe(String(original));
  } else if (original instanceof Decimal128) {
    expect(revived).toBeInstanceOf(Decimal128);
    expect(String(revived)).toBe(String(original));
  } else if (original instanceof Timestamp) {
    expect(revived).toBeInstanceOf(Timestamp);
    expect(String(revived)).toBe(String(original));
  } else if (original instanceof Binary) {
    expect(revived).toBeInstanceOf(Binary);
    expect((revived as Binary).sub_type).toBe(original.sub_type);
    expect(Buffer.from((revived as Binary).buffer).equals(Buffer.from(original.buffer))).toBe(true);
  } else if (original instanceof Int32) {
    expect(revived).toBeInstanceOf(Int32);
    expect((revived as Int32).valueOf()).toBe(original.valueOf());
  } else if (original instanceof Double) {
    expect(revived).toBeInstanceOf(Double);
    expect((revived as Double).valueOf()).toBe(original.valueOf());
  } else if (original instanceof BSONRegExp) {
    expect(revived).toBeInstanceOf(BSONRegExp);
    expect((revived as BSONRegExp).pattern).toBe(original.pattern);
    expect((revived as BSONRegExp).options).toBe(original.options);
  } else if (original instanceof BSONSymbol) {
    expect(revived).toBeInstanceOf(BSONSymbol);
    expect((revived as BSONSymbol).valueOf()).toBe(original.valueOf());
  } else if (original instanceof MinKey) {
    expect(revived).toBeInstanceOf(MinKey);
  } else if (original instanceof MaxKey) {
    expect(revived).toBeInstanceOf(MaxKey);
  } else {
    expect(revived).toEqual(original);
  }
}

describe('ejson property: round-trip', () => {
  it('ejsonParse(ejsonStringify(doc)) preserves every BSON leaf value', () => {
    fc.assert(
      fc.property(bsonDoc, (doc) => {
        const back = ejsonParse<Record<string, unknown>>(ejsonStringify(doc));
        for (const key of Object.keys(doc)) {
          expectBsonEqual(back[key], doc[key]);
        }
      }),
    );
  });
});

describe('ejson property: isPlainDocument', () => {
  it('is false once a lone BSON value has been revived from EJSON', () => {
    fc.assert(
      fc.property(bsonLeaf, (value) => {
        const revived = ejsonParse(ejsonStringify(value));
        expect(isPlainDocument(revived)).toBe(false);
      }),
    );
  });

  it('is true for a plain document revived from EJSON, regardless of nested BSON fields', () => {
    fc.assert(
      fc.property(bsonDoc, (doc) => {
        const revived = ejsonParse(ejsonStringify(doc));
        expect(isPlainDocument(revived)).toBe(true);
      }),
    );
  });
});

describe('ejson property: deep nesting', () => {
  // Arrays-of-arrays-of-documents several levels deep — the flat bsonDoc
  // above only nests one level (leaf values inside a single document).
  // `depthSize: 'small'` biases fast-check toward shallower trees as
  // generation proceeds, so this terminates instead of blowing up.
  const { node } = fc.letrec((tie) => ({
    node: fc.oneof(
      { depthSize: 'small' as const },
      bsonLeaf,
      fc.array(tie('node') as fc.Arbitrary<unknown>, { maxLength: 4 }),
      fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), tie('node') as fc.Arbitrary<unknown>, {
        maxKeys: 4,
      }),
    ),
  }));
  const deepDoc = fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), node, { maxKeys: 4 });

  it('ejsonParse(ejsonStringify(doc)) preserves BSON leaves nested inside arrays and documents', () => {
    fc.assert(
      fc.property(deepDoc, (doc) => {
        const back = ejsonParse<Record<string, unknown>>(ejsonStringify(doc));
        // Structural round-trip only — walk both trees together, comparing
        // BSON leaves with expectBsonEqual and recursing through plain
        // arrays/objects unchanged.
        const walk = (a: unknown, b: unknown): void => {
          if (Array.isArray(a)) {
            expect(Array.isArray(b)).toBe(true);
            const bArr = b as unknown[];
            expect(bArr.length).toBe(a.length);
            a.forEach((v, i) => walk(v, bArr[i]));
          } else if (a !== null && typeof a === 'object' && isPlainDocument(a)) {
            expect(isPlainDocument(b)).toBe(true);
            const bObj = b as Record<string, unknown>;
            for (const k of Object.keys(a)) walk((a as Record<string, unknown>)[k], bObj[k]);
          } else {
            expectBsonEqual(b, a);
          }
        };
        walk(doc, back);
      }),
    );
  });
});

// ─── Bare integer tokens ────────────────────────────────────────────────────
// `JSON.parse` rounds any integer token past 2^53. The invariant, for every
// token a user can type and for both parsers: |n| < 2^53 stays a JS number,
// 2^53 <= |n| <= int64 becomes a Long with the exact digits, and anything
// wider stays the rounded double. (Not asserted through `ejsonStringify`: bson
// prints a safe non-int32 number as `$numberLong` too, so the output cannot
// tell a Long from a number.)
describe.each([
  ['electron ejsonParse', ejsonParse],
  ['renderer ejsonParse', ejsonParseRenderer],
] as const)('ejson property: bare integer tokens — %s', (_label, parse) => {
  const TWO_53 = 2n ** 53n;
  const INT64_MAX = 2n ** 63n - 1n;
  const INT64_MIN = -(2n ** 63n);

  // The same token in every position the parser must find it: a lone scalar,
  // an object field, an array element, and nested inside both, with JSON's
  // optional whitespace around it. `read` picks the value back out.
  const ws = fc.constantFrom('', ' ', '\n', '\t ', '\r\n');
  const placement = fc
    .tuple(ws, ws, fc.constantFrom('scalar', 'field', 'element', 'nested'))
    .map(([pre, post, where]) => ({
      text: (t: string): string => {
        switch (where) {
          case 'scalar':
            return `${pre}${t}${post}`;
          case 'field':
            return `{"a":${pre}${t}${post}}`;
          case 'element':
            return `[1,${pre}${t}${post}]`;
          default:
            return `{"x":[{"y":[0,${pre}${t}${post}]}]}`;
        }
      },
      read: (v: unknown): unknown => {
        switch (where) {
          case 'scalar':
            return v;
          case 'field':
            return (v as { a: unknown }).a;
          case 'element':
            return (v as unknown[])[1];
          default:
            return (v as { x: { y: unknown[] }[] }).x[0]!.y[1];
        }
      },
    }));

  const unsafeInt64 = fc.oneof(
    fc.bigInt({ min: TWO_53, max: INT64_MAX }),
    fc.bigInt({ min: INT64_MIN, max: -TWO_53 }),
    // Hug the boundaries, where an off-by-one in a bound would hide.
    fc.constantFrom(TWO_53, -TWO_53, TWO_53 + 1n, -TWO_53 - 1n, INT64_MAX, INT64_MIN, INT64_MAX - 1n, INT64_MIN + 1n),
  );

  it('an integer in [2^53, int64] keeps its exact digits as a Long', () => {
    fc.assert(
      fc.property(unsafeInt64, placement, (n, p) => {
        const got = p.read(parse(p.text(n.toString())));
        expect(got).toBeInstanceOf(Long);
        expect((got as Long).toString()).toBe(n.toString());
      }),
    );
  });

  it('a safe integer stays a JS number with the same value, however many digits it has', () => {
    fc.assert(
      fc.property(fc.maxSafeInteger(), placement, (n, p) => {
        const got = p.read(parse(p.text(String(n))));
        expect(typeof got).toBe('number');
        expect(BigInt(got as number)).toBe(BigInt(n));
      }),
    );
  });

  it('an integer beyond int64 stays the rounded double JSON.parse gives', () => {
    const beyond = fc.oneof(
      fc.bigInt({ min: INT64_MAX + 1n, max: 10n ** 40n }),
      fc.bigInt({ min: -(10n ** 40n), max: INT64_MIN - 1n }),
      fc.constantFrom(INT64_MAX + 1n, INT64_MIN - 1n),
    );
    fc.assert(
      fc.property(beyond, placement, (n, p) => {
        const token = n.toString();
        const got = p.read(parse(p.text(token)));
        expect(typeof got).toBe('number');
        expect(got).toBe(Number(token));
      }),
    );
  });

  it('a big integer spelled as a double (fraction or exponent) never becomes a Long', () => {
    const asDouble = fc
      .tuple(fc.bigInt({ min: TWO_53, max: INT64_MAX }), fc.constantFrom('.0', '.5', 'e0', 'E0', 'e+0'))
      .map(([n, suffix]) => `${n}${suffix}`);
    fc.assert(
      fc.property(asDouble, placement, (token, p) => {
        const got = p.read(parse(p.text(token)));
        expect(typeof got).toBe('number');
        expect(got).toBe(JSON.parse(token));
      }),
    );
  });
});
