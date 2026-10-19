import { describe, it, expect, vi, afterEach } from 'vitest';
import { BSON } from 'bson';
import { parseJsonKeepingBigInts, prettyPrintJsonKeepingBigInts } from '../../src/utils/bigIntJson';
import { ejsonParse } from '../../src/utils/ejson';

// ─── Bare integers beyond 2^53 ──────────────────────────────────────────────
// `JSON.parse` rounds `9007199254740993` to `9007199254740992` before any
// walker sees it, so the parse reads the exact digits off the reviver's
// `context.source` and hands them over as a `$numberLong` sentinel. This is the
// one copy of that logic; the renderer's `ejsonParse` and main's
// `safeEjsonParse` both parse through it (their own specs check the Long that
// comes out the far end).
describe('parseJsonKeepingBigInts — bare integers beyond 2^53', () => {
  const at = (raw: string): unknown => (parseJsonKeepingBigInts(raw) as { a: unknown }).a;

  it.each([
    ['2^53 + 1', '9007199254740993'],
    ['2^53 exactly (the first integer isSafeInteger rejects)', '9007199254740992'],
    ['negative -(2^53 + 1)', '-9007199254740993'],
    ['negative -(2^53) exactly', '-9007199254740992'],
    ['int64 max', '9223372036854775807'],
    ['int64 min', '-9223372036854775808'],
  ])('%s becomes a $numberLong with the exact digits', (_name, token) => {
    expect(at(`{"a":${token}}`)).toEqual({ $numberLong: token });
  });

  it('keeps the digits exact inside arrays nested in objects, at any depth', () => {
    const out = parseJsonKeepingBigInts('{"a":[1,{"b":9007199254740993}],"c":{"d":[[-9007199254740993]]}}');
    expect(out).toEqual({
      a: [1, { b: { $numberLong: '9007199254740993' } }],
      c: { d: [[{ $numberLong: '-9007199254740993' }]] },
    });
  });

  it.each([
    ['a space after the colon and before the brace', '{"a": -9007199254740993 }'],
    ['no whitespace at all', '{"a":-9007199254740993}'],
    ['tabs and newlines after the colon', '{"a":\n\t-9007199254740993\r\n}'],
  ])('%s takes the exact path', (_name, raw) => {
    expect(at(raw)).toEqual({ $numberLong: '-9007199254740993' });
  });

  it.each([
    ['after "[" with no space', '[9007199254740993]'],
    ['after ", " in an array', '[1, 9007199254740993]'],
    ['after "[" with a space', '[ 9007199254740993]'],
    ['after a comma with no space', '[1,9007199254740993]'],
  ])('an array element %s takes the exact path', (_name, raw) => {
    const arr = parseJsonKeepingBigInts(raw) as unknown[];
    expect(arr[arr.length - 1]).toEqual({ $numberLong: '9007199254740993' });
  });

  it('a lone top-level scalar, padded or not, takes the exact path', () => {
    // No delimiter before the digits: the gate needs its start-of-text branch.
    for (const raw of ['9007199254740993', '  -9007199254740993\n']) {
      expect(parseJsonKeepingBigInts(raw)).toEqual({ $numberLong: raw.trim() });
    }
  });

  it('keeps a field named __proto__ as an own property, holding the sentinel', () => {
    // A JSON string, not an object literal: a literal `__proto__` key sets the
    // prototype instead of creating a field.
    const out = parseJsonKeepingBigInts('{"__proto__":9007199254740993,"b":9007199254740993}') as object;
    expect(Object.getOwnPropertyDescriptor(out, '__proto__')?.value).toEqual({ $numberLong: '9007199254740993' });
    expect((out as { b: unknown }).b).toEqual({ $numberLong: '9007199254740993' });
  });

  // What must NOT become a sentinel. Each stays what plain JSON.parse says, so
  // the expectation is computed from JSON.parse rather than restated by hand.
  it.each([
    ['a safe 16-digit integer', '1234567890123456'],
    ['the largest safe integer', '9007199254740991'],
    ['the smallest safe integer', '-9007199254740991'],
    ['a small integer', '12'],
    ['a fraction', '1.5'],
    ['an exponent beyond 2^53', '1e21'],
    ['an exponent with an explicit big mantissa', '1.2345678901234567e19'],
    ['a plain exponent', '1e20'],
    ['a big integer spelled with a fraction', '12345678901234567890.0'],
    ['a 2^53 + 1 integer spelled with a fraction', '9007199254740993.5'],
    ['an integer spelled with a zero exponent', '9007199254740993e0'],
    ['one past int64 max', '9223372036854775808'],
    ['one past int64 min', '-9223372036854775809'],
    ['a 21-digit integer', '123456789012345678901'],
    ['an overflowing exponent (Infinity)', '1e400'],
  ])('%s stays the JS number JSON.parse gives', (_name, token) => {
    // A second field with a real big int forces the gate open, so the
    // reviver actually sees `a`; without it the plain path would hide a bug.
    const out = parseJsonKeepingBigInts(`{"a":${token},"keep":9007199254740993}`) as { a: unknown; keep: unknown };
    expect(typeof out.a).toBe('number');
    expect(Object.is(out.a, JSON.parse(token))).toBe(true);
    expect(out.keep).toEqual({ $numberLong: '9007199254740993' });
  });

  it('leaves a string that looks like a big integer alone', () => {
    expect(parseJsonKeepingBigInts('{"a":"9007199254740993","b":9007199254740993}')).toEqual({
      a: '9007199254740993',
      b: { $numberLong: '9007199254740993' },
    });
  });

  it('leaves an existing $numberLong sentinel exactly as it was', () => {
    expect(parseJsonKeepingBigInts('{"a":{"$numberLong":"9007199254740993"},"b":9007199254740993}')).toEqual({
      a: { $numberLong: '9007199254740993' },
      b: { $numberLong: '9007199254740993' },
    });
  });

  it('leaves a lone safe scalar a number even when the gate is open', () => {
    expect(parseJsonKeepingBigInts('1234567890123456')).toBe(1234567890123456);
  });

  it('throws the SyntaxError JSON.parse throws for text that is not JSON', () => {
    expect(() => parseJsonKeepingBigInts('{"a":9007199254740993')).toThrow(SyntaxError);
  });
});

// The reviver costs ~8x on a large payload, so a text with no 16-digit bare
// integer must reach JSON.parse without one. Spying on JSON.parse is the only
// way to see that: the result is identical either way.
describe('parseJsonKeepingBigInts — the reviver is only paid for when a 16-digit bare integer is present', () => {
  afterEach(() => vi.restoreAllMocks());

  function revivedFor(raw: string): boolean {
    const spy = vi.spyOn(JSON, 'parse');
    parseJsonKeepingBigInts(raw);
    const own = spy.mock.calls.filter((call) => call[0] === raw);
    expect(own).toHaveLength(1);
    return typeof own[0]![1] === 'function';
  }

  it.each([
    ['a canonical $numberLong string', '{"a":{"$numberLong":"9007199254740993"}}'],
    ['a canonical result payload', '[{"_id":{"$oid":"507f1f77bcf86cd799439011"},"n":{"$numberInt":"5"}}]'],
    ['a 15-digit bare integer', '{"a":123456789012345}'],
    ['a 16-digit string value', '{"a":"1234567890123456"}'],
    ['a 16-digit run glued to a key character, not a value', '{"a1234567890123456":1}'],
  ])('%s uses the plain JSON.parse', (_name, raw) => {
    expect(revivedFor(raw)).toBe(false);
  });

  it.each([
    ['after a colon', '{"a":1234567890123456}'],
    ['after a colon and a space', '{"a": 1234567890123456}'],
    ['after a comma', '[1,1234567890123456]'],
    ['after a bracket', '[1234567890123456]'],
    ['negative', '{"a":-1234567890123456}'],
    ['negative after a space', '{"a": -1234567890123456}'],
    ['at the very start', '1234567890123456'],
    ['at the start after whitespace', '  \n1234567890123456'],
    ['more than 16 digits', '{"a":12345678901234567890}'],
  ])('a 16-digit bare integer %s opens the reviver', (_name, raw) => {
    expect(revivedFor(raw)).toBe(true);
  });
});

// If an engine ever lacks JSON.parse's source-text access, a rounded integer
// must be refused, not stored. Simulated by calling the reviver with two
// arguments, the way an engine without the feature would.
describe('parseJsonKeepingBigInts — no JSON.parse source text available', () => {
  afterEach(() => vi.restoreAllMocks());

  function withoutSourceText(): void {
    const real = JSON.parse;
    vi.spyOn(JSON, 'parse').mockImplementation((text, reviver) =>
      real(text, reviver ? (key: string, value: unknown) => reviver.call(undefined, key, value) : undefined),
    );
  }

  it('refuses an integer beyond 2^53 rather than keeping the rounded double', () => {
    withoutSourceText();
    expect(() => parseJsonKeepingBigInts('{"a":9007199254740993}')).toThrow(/no source text/);
    expect(() => parseJsonKeepingBigInts('{"a":-9223372036854775808}')).toThrow(/no source text/);
  });

  it('pretty-printing refuses it too, instead of writing the rounded digits back', () => {
    withoutSourceText();
    expect(() => prettyPrintJsonKeepingBigInts('{"a":9007199254740993}', 2)).toThrow(/no source text/);
  });

  it('still parses everything that needs no source text', () => {
    withoutSourceText();
    expect(parseJsonKeepingBigInts('{"a":1.5,"b":1234567890123456,"c":"x","d":null,"e":[true]}')).toEqual({
      a: 1.5,
      b: 1234567890123456,
      c: 'x',
      d: null,
      e: [true],
    });
  });
});

// `JSON.stringify(JSON.parse(s), null, 2)` writes `9007199254740993` back as
// `9007199254740992`. Pretty-printing keeps the user's digits and otherwise
// matches that round trip, so every expectation below that is not about a big
// integer is computed from it rather than restated by hand.
describe('prettyPrintJsonKeepingBigInts', () => {
  const pretty = (raw: string): string => prettyPrintJsonKeepingBigInts(raw, 2);
  const plainRoundTrip = (raw: string): string => JSON.stringify(JSON.parse(raw), null, 2);

  it.each([
    ['2^53 + 1', '9007199254740993'],
    ['2^53 exactly (the first integer isSafeInteger rejects)', '9007199254740992'],
    ['negative -(2^53 + 1)', '-9007199254740993'],
    ['int64 max', '9223372036854775807'],
    ['int64 min', '-9223372036854775808'],
    ['one past int64 max (no int64 ceiling: nothing changes type here)', '9223372036854775808'],
    ['a 21-digit integer', '123456789012345678901'],
  ])('%s keeps its exact digits', (_name, token) => {
    expect(pretty(`{"a":${token}}`)).toBe(`{\n  "a": ${token}\n}`);
  });

  it('keeps the digits exact inside arrays and nested objects, at any depth', () => {
    expect(pretty('{"a":[1,{"b":9007199254740993}],"c":{"d":[[-9007199254740993]]}}')).toBe(
      [
        '{',
        '  "a": [',
        '    1,',
        '    {',
        '      "b": 9007199254740993',
        '    }',
        '  ],',
        '  "c": {',
        '    "d": [',
        '      [',
        '        -9007199254740993',
        '      ]',
        '    ]',
        '  }',
        '}',
      ].join('\n'),
    );
  });

  it('keeps a lone top-level scalar exact', () => {
    expect(pretty('  -9007199254740993\n')).toBe('-9007199254740993');
  });

  it('writes at the indent asked for', () => {
    expect(prettyPrintJsonKeepingBigInts('{"a":[9007199254740993]}', 0)).toBe('{"a":[9007199254740993]}');
    expect(prettyPrintJsonKeepingBigInts('{"a":9007199254740993}', 4)).toBe('{\n    "a": 9007199254740993\n}');
  });

  it('keeps a field named __proto__ as a field', () => {
    expect(pretty('{"__proto__":9007199254740993}')).toBe('{\n  "__proto__": 9007199254740993\n}');
  });

  // The plain round trip writes each of these back as a different BSON value:
  // a bare integer (a Long on the next parse), `null`, or an Int32 `0`.
  it.each([
    ['a Double beyond 2^53 spelled with a fraction', '1760000000000000768.0'],
    ['2^53 exactly, spelled with a fraction', '9007199254740992.0'],
    ['-(2^53) exactly, spelled with a fraction', '-9007199254740992.0'],
    ['a big integer spelled with a fraction', '12345678901234567890.0'],
    ['an exponent beyond 2^53', '1e18'],
    ['a negative exponent beyond 2^53', '-1e18'],
    ['an exponent past the bare-integer range', '1e21'],
    ['an integer spelled with a zero exponent', '9007199254740993e0'],
    ['a number too large for a double', '1e400'],
    ['negative zero', '-0'],
    ['negative zero with a fraction', '-0.0'],
  ])('keeps the spelling of %s', (_name, token) => {
    expect(pretty(`{"a":${token}}`)).toBe(`{\n  "a": ${token}\n}`);
  });

  it.each([
    ['a safe 16-digit integer', '{"a":1234567890123456}'],
    ['the largest safe integer', '{"a":9007199254740991}'],
    ['a fraction', '{"a":1.5}'],
    ['a safe integer spelled with a fraction', '{"a":1.0}'],
    ['a string that looks like a big integer', '{"a":"9007199254740993"}'],
    ['strings, booleans, null and an empty array', '{"s":"x","t":true,"n":null,"e":[]}'],
  ])('writes %s the way the plain round trip does', (_name, raw) => {
    // The first field is the case under test; a real big integer after it
    // forces the reviver to see it.
    const withBig = raw.replace(/}$/, ',"big":9007199254740993}');
    expect(pretty(withBig)).toBe(plainRoundTrip(raw).replace(/\n}$/, ',\n  "big": 9007199254740993\n}'));
  });

  it('leaves a typed $numberLong sentinel as the sentinel, not a bare integer', () => {
    expect(pretty('{"a":{"$numberLong":"9007199254740993"},"b":9007199254740993}')).toBe(
      ['{', '  "a": {', '    "$numberLong": "9007199254740993"', '  },', '  "b": 9007199254740993', '}'].join('\n'),
    );
  });

  it('throws the SyntaxError JSON.parse throws for text that is not JSON', () => {
    expect(() => pretty('{"a":9007199254740993')).toThrow(SyntaxError);
  });
});

// The Format button on a stage body runs `prettyPrintJsonKeepingBigInts`, and
// running the pipeline parses the result. Formatting must not change what the
// server receives.
describe('prettyPrintJsonKeepingBigInts — format then parse stores the same BSON', () => {
  const bson = (text: string): Uint8Array => BSON.serialize({ v: ejsonParse(text) });

  it.each([
    '{"n":1760000000000000768.0}',
    '{"n":9007199254740992.0}',
    '{"n":1e18}',
    '{"n":-1e18}',
    '{"n":12345678901234567890.0}',
    '{"n":9007199254740993e0}',
    '{"n":1e21}',
    '{"n":1e400}',
    '{"n":-0}',
    '{"n":9007199254740993}',
    '{"n":9223372036854775808}',
    '{"n":1.0}',
    '{"n":1.5}',
    '{"n":3000000000.0}',
    '[1760000000000000768.0,{"m":-0}]',
  ])('%s', (text) => {
    expect(bson(prettyPrintJsonKeepingBigInts(text, 2))).toEqual(bson(text));
  });
});
