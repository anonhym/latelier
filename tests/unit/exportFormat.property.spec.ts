import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Double, Long } from 'bson';
import {
  csvCellValue,
  csvEscape,
  neutralizeFormula,
  serializeCsv,
  serializeJsonArray,
  serializeJsonl,
} from '../../src/pages/Workspace/exportFormat';
import { parseJsonArray, parseJsonlLine } from '../../electron/mongo/importParse';

/**
 * Reverses `csvEscape` for a single standalone field — not a general CSV
 * parser (no multi-column awareness needed here). If the text is wrapped in
 * `"…"`, strip the wrapper and undouble embedded quotes; otherwise it is
 * exactly what `csvEscape` was given.
 */
function unescapeOne(text: string): string {
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/""/g, '"');
  }
  return text;
}

describe('csvEscape (property)', () => {
  it('round-trips any string through escape -> unescape', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(unescapeOne(csvEscape(s))).toBe(s);
      }),
    );
  });

  it('quotes exactly when the field contains a comma, quote, or newline/CR — and leaves everything else untouched', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const escaped = csvEscape(s);
        const needsQuoting = /[",\r\n]/.test(s);
        if (needsQuoting) {
          expect(escaped[0]).toBe('"');
          expect(escaped[escaped.length - 1]).toBe('"');
        } else {
          expect(escaped).toBe(s);
        }
      }),
    );
  });
});

describe('serializeCsv (property)', () => {
  it('every row has exactly as many comma-joined top-level fields as columns, for single-column output', () => {
    // Single column avoids re-deriving a full CSV parser in the test: with
    // one column, an escaped cell's own embedded commas are the only ones on
    // the line, so "no bare unescaped comma" is exactly "one field".
    fc.assert(
      fc.property(fc.array(fc.string(), { maxLength: 20 }), (values) => {
        const docs = values.map((v) => ({ a: v }));
        const csv = serializeCsv(docs, [{ header: 'a', path: 'a' }]);
        const lines = csv.split('\n');
        // header + one line per doc + trailing empty string from the final \n
        expect(lines.length).toBe(docs.length + 2);
        expect(lines[0]).toBe('a');
        expect(lines[lines.length - 1]).toBe('');
        for (let i = 0; i < values.length; i++) {
          expect(unescapeOne(lines[i + 1]!)).toBe(neutralizeFormula(csvCellValue(values[i]), values[i]));
        }
      }),
    );
  });
});

// Relaxed export must not change a number's value, and past 2^53 must not change
// its type either: a Long comes back a Long, a Double a Double. Built from
// canonical sentinels because that is what documents look like on the wire.
describe('relaxed export then import (property)', () => {
  const TWO_53 = 2n ** 53n;
  const INT64_MAX = 2n ** 63n - 1n;
  const INT64_MIN = -(2n ** 63n);

  const importers: Array<[string, (doc: unknown) => Record<string, unknown>]> = [
    ['JSONL', (doc) => (parseJsonlLine(serializeJsonl([doc], true).trimEnd(), 1) as { doc: Record<string, unknown> }).doc],
    ['a JSON array', (doc) => (parseJsonArray(serializeJsonArray([doc], true))[0] as { doc: Record<string, unknown> }).doc],
  ];

  const wideLong = fc.oneof(
    fc.bigInt({ min: TWO_53, max: INT64_MAX }),
    fc.bigInt({ min: INT64_MIN, max: -TWO_53 }),
    fc.constantFrom(TWO_53, -TWO_53, INT64_MAX, INT64_MIN),
  );
  // A double with an integral value from 2^53 up to (not including) 2^63: the
  // range an importer would read back as a Long.
  const wideDouble = fc
    .bigInt({ min: TWO_53, max: INT64_MAX })
    .chain((n) => fc.boolean().map((neg) => Number(neg ? -n : n)))
    .filter((d) => Math.abs(d) < 2 ** 63);

  describe.each(importers)('through %s', (_name, importOne) => {
    it('a Long past the safe range comes back a Long with the same digits', () => {
      fc.assert(
        fc.property(wideLong, (n) => {
          const got = importOne({ v: { $numberLong: n.toString() } }).v;
          expect(got).toBeInstanceOf(Long);
          expect((got as Long).toString()).toBe(n.toString());
        }),
      );
    });

    it('an integral Double from 2^53 to int64 comes back a Double with the same value', () => {
      fc.assert(
        fc.property(wideDouble, (d) => {
          const got = importOne({ v: { $numberDouble: BigInt(d).toString() } }).v;
          expect(got).toBeInstanceOf(Double);
          expect(Object.is((got as Double).valueOf(), d)).toBe(true);
        }),
      );
    });

    it('any other finite Double keeps its value (a whole one below 2^53 may come back an integer)', () => {
      fc.assert(
        fc.property(
          fc.double({ noNaN: true, noDefaultInfinity: true }).filter((d) => !Number.isInteger(d) || Math.abs(d) < 2 ** 53 || Math.abs(d) >= 2 ** 63),
          (d) => {
            // bson writes a Double's canonical form with its shortest digits.
            const got = importOne({ v: { $numberDouble: d === 0 && Object.is(d, -0) ? '-0.0' : String(d) } }).v;
            const value = got instanceof Double ? got.valueOf() : (got as number);
            expect(typeof value).toBe('number');
            expect(Object.is(value, d) || (value === 0 && d === 0)).toBe(true);
          },
        ),
      );
    });
  });
});
