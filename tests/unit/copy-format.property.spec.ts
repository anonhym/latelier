import { runInNewContext } from 'node:vm';
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
  MinKey,
  MaxKey,
  Timestamp,
} from 'bson';
import { ejsonParse, ejsonStringify } from '../../src/utils/ejson';
import { formatDocsForCopy, toMongoshLiteral } from '../../src/utils/copyFormat';
import { repairToCanonicalEjson } from '../../src/utils/shellSyntax';
import { getDocId } from '../../src/pages/Workspace/views/docId';

// Leaves are built with real bson constructors: a boxed Int32/Double and a raw
// JS number compare unequal, and a hand-shaped sentinel can disagree with what
// the driver would emit.
const longValue = fc.bigInt({ min: -(2n ** 63n), max: 2n ** 63n - 1n }).map((n) => Long.fromString(n.toString()));
const decimalValue = fc.oneof(
  fc.float({ noNaN: true }).map((n) => Decimal128.fromString(n.toString())),
  fc.constantFrom('NaN', 'Infinity', '-0', '0', '1E-6176').map((s) => Decimal128.fromString(s)),
);
// The shapes mongosh has a literal for. Only characters that need no escaping
// in a `/…/` literal, and the option letters Shell Syntax accepts.
const regexValue = fc
  .tuple(
    fc.array(fc.constantFrom(...'abcxyz019 ._-^$'), { minLength: 1, maxLength: 12 }).map((c) => c.join('')),
    fc.subarray([...'imsu']).map((f) => f.join('')),
  )
  .map(([pattern, flags]) => new BSONRegExp(pattern, flags));

// Shell Syntax (the app's own paste-back parser) has no Double constructor, so
// only the doubles a plain number already spells exactly belong in its round trip.
const fractionalDouble = fc
  .double({ noNaN: true, noDefaultInfinity: true })
  .filter((n) => !Number.isInteger(n))
  .map((n) => new Double(n));

const shellScalar = fc.oneof(
  fc.string(),
  fc.boolean(),
  fc.constant(null),
  fc.date({ noInvalidDate: true }),
  fc.constant(null).map(() => new ObjectId()),
  longValue,
  decimalValue,
  fc.integer({ min: -(2 ** 31), max: 2 ** 31 - 1 }).map((n) => new Int32(n)),
  fractionalDouble,
  regexValue,
);
// Every double mongosh can write, integral and special ones included.
const anyDouble = fc.oneof(
  fc.double().map((n) => new Double(n)),
  fc.constantFrom(0, -0, 1, -1, 10, 1e21, Number.NaN, Infinity, -Infinity).map((n) => new Double(n)),
);
const scalar = fc.oneof(shellScalar, anyDouble);
// Types only mongosh can spell (Shell Syntax has no constructor for them):
// every format must still carry them.
const mongoshOnly = fc.oneof(
  fc.uint8Array({ maxLength: 16 }).map((b) => new Binary(b, 0)),
  fc.constant(null).map(() => new MinKey()),
  fc.constant(null).map(() => new MaxKey()),
  fc
    .record({ t: fc.integer({ min: 0, max: 0xffffffff }), i: fc.integer({ min: 0, max: 0xffffffff }) })
    .map(({ t, i }) => new Timestamp({ t, i })),
);

// A field name starting with `$` is an operator, not stored data.
const key = fc.string({ minLength: 1, maxLength: 10 }).filter((k) => !k.startsWith('$'));

function docOf(leaf: fc.Arbitrary<unknown>): fc.Arbitrary<Record<string, unknown>> {
  const { tree } = fc.letrec((t) => ({
    tree: fc.oneof(
      { depthSize: 'small', maxDepth: 3 },
      leaf,
      fc.array(t('tree'), { maxLength: 4 }),
      fc.dictionary(key, t('tree'), { maxKeys: 4 }),
    ),
  }));
  return fc.dictionary(key, tree, { maxKeys: 6 });
}

const anyDoc = docOf(fc.oneof(scalar, mongoshOnly));
const shellDoc = docOf(shellScalar);
const printableDoc = docOf(scalar);

const canonicalOf = (v: unknown) => ejsonStringify(v);
// The wire carries sentinel trees, not live BSON: the formats must read both.
const asWire = (d: unknown) => JSON.parse(ejsonStringify(d)) as unknown;

describe('copy formats: every format parses back to the same BSON values', () => {
  it('readable EJSON round-trips', () => {
    fc.assert(
      fc.property(anyDoc, (d) => {
        expect(canonicalOf(ejsonParse(formatDocsForCopy([d], 'readable')))).toBe(canonicalOf(d));
        expect(canonicalOf(ejsonParse(formatDocsForCopy([asWire(d)], 'readable')))).toBe(canonicalOf(d));
      }),
    );
  });

  it('canonical EJSON round-trips', () => {
    fc.assert(
      fc.property(anyDoc, (d) => {
        expect(canonicalOf(ejsonParse(formatDocsForCopy([d], 'canonical')))).toBe(canonicalOf(d));
        expect(canonicalOf(ejsonParse(formatDocsForCopy([asWire(d)], 'canonical')))).toBe(canonicalOf(d));
      }),
    );
  });

  it('several documents come back as the same array', () => {
    fc.assert(
      fc.property(fc.array(anyDoc, { minLength: 2, maxLength: 3 }), (docs) => {
        for (const format of ['readable', 'canonical'] as const) {
          expect(canonicalOf(ejsonParse(formatDocsForCopy(docs, format)))).toBe(canonicalOf(docs));
        }
      }),
    );
  });

  it('the mongosh literal repairs to text that parses back to the same BSON, for the types Shell Syntax covers', () => {
    fc.assert(
      fc.property(shellDoc, (d) => {
        for (const source of [d, asWire(d)]) {
          const literal = toMongoshLiteral(source);
          const outcome = repairToCanonicalEjson(literal);
          expect(outcome.kind === 'repaired' || outcome.kind === 'unchanged').toBe(true);
          const text = outcome.kind === 'repaired' ? outcome.text : literal;
          expect(canonicalOf(ejsonParse(text))).toBe(canonicalOf(d));
        }
      }),
    );
  });

  it('mongosh evaluates the literal back to the same BSON, every type it can spell included', () => {
    // Stand-ins for the shell's own constructors, built on the driver's.
    const shell = {
      ObjectId: (hex: string) => new ObjectId(hex),
      ISODate: (iso: string) => new Date(iso),
      NumberLong: (n: string) => Long.fromString(n),
      NumberDecimal: (n: string) => Decimal128.fromString(n),
      Double: (n: number) => new Double(n),
      BinData: (sub: number, b64: string) => new Binary(Buffer.from(b64, 'base64'), sub),
      Timestamp: (v: { t: number; i: number }) => new Timestamp(v),
      MinKey: () => new MinKey(),
      MaxKey: () => new MaxKey(),
    };
    fc.assert(
      fc.property(anyDoc, (d) => {
        for (const source of [d, asWire(d)]) {
          const evaluated = runInNewContext(`(${toMongoshLiteral(source)})`, shell);
          expect(canonicalOf(evaluated)).toBe(canonicalOf(d));
        }
      }),
    );
  });

  it('the mongosh literal names the types it has constructors for', () => {
    fc.assert(
      fc.property(printableDoc, (d) => {
        const literal = toMongoshLiteral(d);
        // A canonical date nests a `$numberLong` of its own; that one is not a Long field.
        const wire = JSON.stringify(asWire(d)).replace(/"\$date":\{"\$numberLong":"[^"]*"\}/g, '');
        // No wrapper left for a type the shell can spell.
        if (wire.includes('"$oid"')) expect(literal).toContain('ObjectId("');
        if (wire.includes('"$numberLong"')) expect(literal).toContain('NumberLong("');
        if (wire.includes('"$numberDecimal"')) expect(literal).toContain('NumberDecimal("');
        expect(literal).not.toContain('"$oid"');
        expect(literal).not.toContain('"$numberLong"');
        expect(literal).not.toContain('"$numberDecimal"');
      }),
    );
  });
});

describe('getDocId: a scalar BSON _id never shows its EJSON wrapper', () => {
  it('never starts with {"$', () => {
    fc.assert(
      fc.property(fc.oneof(scalar, fc.integer()), (id) => {
        const label = getDocId({ _id: JSON.parse(ejsonStringify({ _id: id }))._id });
        expect(label.startsWith('{"$')).toBe(false);
        expect(label).not.toContain('$number');
        expect(label).not.toContain('$oid');
      }),
    );
  });
});
