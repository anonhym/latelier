import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { BSON } from 'bson';
import { parseJsonKeepingBigInts, prettyPrintJsonKeepingBigInts } from '../../src/utils/bigIntJson';
import { ejsonParse } from '../../src/utils/ejson';

// `JSON.parse` rounds any integer token past 2^53. The invariant, for every
// token a user can type: |n| < 2^53 stays a JS number, 2^53 <= |n| <= int64
// becomes a `$numberLong` sentinel with the exact digits, and anything wider
// stays the rounded double.
describe('bigIntJson property: bare integer tokens', () => {
  const TWO_53 = 2n ** 53n;
  const INT64_MAX = 2n ** 63n - 1n;
  const INT64_MIN = -(2n ** 63n);

  // The same token in every position the parse must find it: a lone scalar,
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

  it('an integer in [2^53, int64] keeps its exact digits as a $numberLong', () => {
    fc.assert(
      fc.property(unsafeInt64, placement, (n, p) => {
        expect(p.read(parseJsonKeepingBigInts(p.text(n.toString())))).toEqual({ $numberLong: n.toString() });
      }),
    );
  });

  it('a safe integer stays a JS number with the same value, however many digits it has', () => {
    fc.assert(
      fc.property(fc.maxSafeInteger(), placement, (n, p) => {
        const got = p.read(parseJsonKeepingBigInts(p.text(String(n))));
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
        const got = p.read(parseJsonKeepingBigInts(p.text(token)));
        expect(typeof got).toBe('number');
        expect(got).toBe(Number(token));
      }),
    );
  });

  it('a big integer spelled as a double (fraction or exponent) never becomes a sentinel', () => {
    const asDouble = fc
      .tuple(fc.bigInt({ min: TWO_53, max: INT64_MAX }), fc.constantFrom('.0', '.5', 'e0', 'E0', 'e+0'))
      .map(([n, suffix]) => `${n}${suffix}`);
    fc.assert(
      fc.property(asDouble, placement, (token, p) => {
        const got = p.read(parseJsonKeepingBigInts(p.text(token)));
        expect(typeof got).toBe('number');
        expect(got).toBe(JSON.parse(token));
      }),
    );
  });

  it('formatting then parsing stores the same BSON for any double, however it is spelled', () => {
    // fc.double rarely lands in [2^53, 2^70], where a fraction or exponent
    // spelling used to come back as a bare integer, so that range is drawn too.
    const double = fc
      .oneof(
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        fc.bigInt({ min: TWO_53, max: 2n ** 70n }).map((n) => Number(n) * (n % 2n === 0n ? 1 : -1)),
      )
      .filter((d) => !Object.is(d, -0));
    // -0 has no sign-keeping spelling in this list; the example tests cover it.
    const spelled = double.chain((d) =>
      fc.constantFrom(String(d), d.toExponential(), Number.isInteger(d) ? `${BigInt(d)}.0` : String(d)),
    );
    const bson = (text: string): Uint8Array => BSON.serialize({ v: ejsonParse(text) });
    fc.assert(
      fc.property(spelled, placement, (token, p) => {
        const text = p.text(token);
        expect(bson(prettyPrintJsonKeepingBigInts(text, 2))).toEqual(bson(text));
      }),
    );
  });

  it('pretty-printing keeps the digits of any integer, wherever it sits, and is a fixpoint', () => {
    const anyInteger = fc.oneof(fc.bigInt({ min: -(10n ** 40n), max: 10n ** 40n }), unsafeInt64);
    fc.assert(
      fc.property(anyInteger, placement, (n, p) => {
        const token = n.toString();
        const out = prettyPrintJsonKeepingBigInts(p.text(token), 2);
        expect(out).toContain(token);
        expect(prettyPrintJsonKeepingBigInts(out, 2)).toBe(out);
      }),
    );
  });
});
