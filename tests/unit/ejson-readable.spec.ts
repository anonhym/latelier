// UX review §4.1 — `ejsonStringifyReadable`.
//
// The examples below are illustration. The contract is the property at the
// bottom of this file: anything this function emits must re-parse to the
// identical BSON. Everything else is a consequence of it.
import { describe, it, expect } from 'vitest';
import { ejsonParse, ejsonStringify, ejsonStringifyReadable, isValidEjson } from '../../src/utils/ejson';

/** Canonical text in, readable text out. */
function readable(canonical: string, indent?: number): string {
  return ejsonStringifyReadable(ejsonParse(canonical), indent);
}

/**
 * The canonical form of some EJSON text. Not every literal below is already
 * one: bson normalises `2e0` to `"2.0"` and a bare `1` to `{"$numberInt":"1"}`,
 * and the property is about the *value* surviving, not the spelling that
 * happened to be typed here.
 */
function canonical(text: string): string {
  return ejsonStringify(ejsonParse(text));
}

/** The one thing that has to hold. */
function roundTrips(text: string): boolean {
  return canonical(readable(text)) === canonical(text);
}

describe('ejsonStringifyReadable — what it unwraps', () => {
  it('renders an int32 as a plain number', () => {
    expect(readable('{"age":{"$numberInt":"67"}}')).toBe('{"age":67}');
  });

  it('renders a date as an ISO string instead of epoch milliseconds', () => {
    expect(readable('{"at":{"$date":{"$numberLong":"1738284528524"}}}')).toBe(
      '{"at":{"$date":"2025-01-31T00:48:48.524Z"}}',
    );
  });

  it('renders a fractional double as a plain number', () => {
    expect(readable('{"n":{"$numberDouble":"1.5"}}')).toBe('{"n":1.5}');
  });

  it('collapses an array of ints, which was the worst of it', () => {
    // UX review §4.1: "A three-number array needs nine lines of $numberInt
    // wrapper text."
    const canonical = '{"rgb":[{"$numberInt":"52"},{"$numberInt":"35"},{"$numberInt":"88"}]}';
    expect(readable(canonical)).toBe('{"rgb":[52,35,88]}');
  });

  it('reaches into nested documents and arrays', () => {
    expect(readable('{"a":{"b":[{"c":{"$numberInt":"1"}}]}}')).toBe('{"a":{"b":[{"c":1}]}}');
  });

  it('indents like JSON.stringify when asked', () => {
    expect(readable('{"age":{"$numberInt":"67"}}', 2)).toBe('{\n  "age": 67\n}');
  });
});

describe('ejsonStringifyReadable — what it refuses to unwrap', () => {
  it.each([
    ['an int64, which would lose its type and then its digits', '{"n":{"$numberLong":"9007199254740993"}}'],
    ['a decimal, which has no JSON equivalent at all', '{"n":{"$numberDecimal":"1.10"}}'],
    ['an ObjectId, which has no shorter lossless form', '{"_id":{"$oid":"6512a3f19d3b2c0012a4b8e1"}}'],
    ['an integral double, which would re-infer as int32', '{"n":{"$numberDouble":"2.0"}}'],
    ['a negative zero double', '{"n":{"$numberDouble":"-0.0"}}'],
    ['Infinity, which is not a JSON number', '{"n":{"$numberDouble":"Infinity"}}'],
    ['NaN, likewise', '{"n":{"$numberDouble":"NaN"}}'],
  ])('leaves %s alone', (_label, text) => {
    expect(readable(text)).toBe(text);
  });

  it.each([
    '{"n":{"$numberDouble":"1e+30"}}',
    '{"n":{"$numberDouble":"1e+21"}}',
    '{"n":{"$numberDouble":"123456789012345683968.0"}}',
  ])('leaves %s wrapped, on purpose rather than by accident', (text) => {
    // bson spells a large integral double in exponent form, where
    // `String(Number(text)) === text` holds and the text check waves it
    // through. Unwrapping is lossless on today's bson — this stays wrapped
    // because the `Number.isInteger` guard is the only thing standing between
    // a future change in that spelling and a silent type change on a write
    // surface. Delete the guard and this test is what goes red.
    expect(readable(text)).toContain('$numberDouble');
  });

  it('leaves an integral double written in exponent form', () => {
    // bson re-spells `2e0` as `"2.0"` before the walk sees it, so the
    // assertion is that it stays a sentinel, not that the spelling survives.
    expect(readable('{"n":{"$numberDouble":"2e0"}}')).toBe('{"n":{"$numberDouble":"2.0"}}');
  });

  it('keeps an int64 visible and exact rather than rounding it into a double', () => {
    // The failure this whole design exists to prevent. bson's own relaxed mode
    // renders this as 9007199254740992, and the user copies the wrong number.
    const text = readable('{"n":{"$numberLong":"9007199254740993"}}');
    expect(text).toContain('9007199254740993');
    expect(text).not.toContain('9007199254740992');
  });

  it('leaves a user field that merely looks like a sentinel', () => {
    // Two keys, so it is an ordinary document and not a BSON value — the same
    // rule `walkRevive` applies on the way in.
    const canonical = '{"$date":{"$numberInt":"1"},"other":{"$numberInt":"2"}}';
    expect(readable(canonical)).toBe('{"$date":1,"other":2}');
    expect(roundTrips(canonical)).toBe(true);
  });

  it('does not unwrap the $numberLong that lives inside a date', () => {
    // A recognised sentinel is never recursed into. Unwrapped, the inner value
    // would become a plain number and the date would stop being a date.
    const text = readable('{"at":{"$date":{"$numberLong":"1738284528524"}}}');
    expect(text).not.toContain('1738284528524');
    expect(JSON.parse(text)).toEqual({ at: { $date: '2025-01-31T00:48:48.524Z' } });
  });
});

describe('ejsonStringifyReadable — the round-trip property', () => {
  const CORPUS = [
    '{}',
    '{"plain":"text"}',
    '{"t":true,"f":false,"n":null}',
    '{"age":{"$numberInt":"67"}}',
    '{"age":{"$numberInt":"0"}}',
    '{"age":{"$numberInt":"-1"}}',
    '{"age":{"$numberInt":"2147483647"}}',
    '{"age":{"$numberInt":"-2147483648"}}',
    '{"n":{"$numberDouble":"1.5"}}',
    '{"n":{"$numberDouble":"-0.125"}}',
    '{"n":{"$numberDouble":"2.0"}}',
    '{"n":{"$numberDouble":"2e0"}}',
    '{"n":{"$numberDouble":"-0.0"}}',
    '{"n":{"$numberDouble":"1e+30"}}',
    '{"n":{"$numberDouble":"1e+21"}}',
    '{"n":{"$numberDouble":"1e-7"}}',
    '{"n":{"$numberDouble":"123456789012345683968.0"}}',
    '{"n":{"$numberDouble":"Infinity"}}',
    '{"n":{"$numberDouble":"-Infinity"}}',
    '{"n":{"$numberDouble":"NaN"}}',
    '{"n":{"$numberLong":"9007199254740993"}}',
    '{"n":{"$numberLong":"0"}}',
    '{"n":{"$numberDecimal":"1.10"}}',
    '{"_id":{"$oid":"6512a3f19d3b2c0012a4b8e1"}}',
    '{"at":{"$date":{"$numberLong":"1738284528524"}}}',
    '{"at":{"$date":{"$numberLong":"0"}}}',
    '{"at":{"$date":{"$numberLong":"-1"}}}',
    '{"at":{"$date":{"$numberLong":"-2208988800000"}}}',
    '{"at":{"$date":{"$numberLong":"253402300800000"}}}',
    '{"re":{"$regularExpression":{"pattern":"^acme","options":"im"}}}',
    '{"rgb":[{"$numberInt":"52"},{"$numberInt":"35"},{"$numberInt":"88"}]}',
    '{"deep":{"a":[{"b":{"$date":{"$numberLong":"1"}}},{"c":{"$numberLong":"2"}}]}}',
    '{"$date":{"$numberInt":"1"},"other":{"$numberInt":"2"}}',
    '{"empty":[],"emptyDoc":{}}',
    '{"mixed":[1,"two",null,{"$numberLong":"3"}]}',
  ];

  it.each(CORPUS)('%s re-parses to the identical BSON', (canonical) => {
    expect(roundTrips(canonical)).toBe(true);
  });

  it.each(CORPUS)('%s stays readable by the app that has to read it back', (canonical) => {
    const text = readable(canonical);
    expect(() => JSON.parse(text)).not.toThrow();
    expect(isValidEjson(text)).toBe(true);
  });

  it('the corpus is not vacuously passing — some of it actually changes', () => {
    // Without this, a `ejsonStringifyReadable = ejsonStringify` stub would
    // satisfy every assertion above.
    const changed = CORPUS.filter((c) => readable(c) !== c);
    expect(changed.length).toBeGreaterThanOrEqual(8);
  });
});
