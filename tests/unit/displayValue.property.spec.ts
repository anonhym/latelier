import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { toDisplayValue, valueToClipboardText, type DisplayType } from '../../src/utils/displayValue';

// `toDisplayValue` classifies parsed JSON, not revived BSON instances. Traced
// every caller (TableView, JsonTree, DocFieldTree, TreeView, builder.ts,
// lastRunSource.ts, references/display.ts, ReferenceDrawer, ReferenceHover
// Popover) — none of them imports `ejsonParse` or calls it on the value it
// hands to `toDisplayValue`; they all receive `value`/`documents` derived from
// `JSON.parse(documentsJson)` in the preload (electron/preload.ts:26), which
// is plain `JSON.parse`, not the revive walk. So the values this module
// actually receives are plain EJSON sentinel shapes like `{ $oid: "..." }`,
// never a real `ObjectId`/`Long`/… constructor instance — confirmed by
// reading `src/pages/Workspace/builder.ts`'s own `DraggedField.value` comment
// ("may be an EJSON-encoded shape"), not assumed. Building this arbitrary
// from real `bson` constructors, as ejson.property.spec.ts does for
// electron/mongo/ejson.ts (which parses with the revive walk), would test an
// input shape this module never actually receives.
const HOSTILE_KEYS = [
  '__proto__',
  'constructor',
  'toString',
  'hasOwnProperty',
  'valueOf',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
] as const;
const normalKey = fc
  .string({ minLength: 1, maxLength: 6 })
  .filter((s) => !(HOSTILE_KEYS as readonly string[]).includes(s));
const keyArb = fc.oneof({ arbitrary: normalKey, weight: 4 }, { arbitrary: fc.constantFrom(...HOSTILE_KEYS), weight: 1 });

// A date safely inside the range `new Date(...).toISOString()` can represent.
// The `$date` object-shape branch skips validation and calls `toISOString()`
// directly when the value is a number or `{ $numberLong }` — a value outside
// this range throws a RangeError instead of returning a DisplayValue. That is
// a real gap in the module, not a property-design choice; see the note at the
// bottom of this file. Constraining the arbitrary to `fc.date`'s own valid
// range is what keeps this file's totality claims honest about what they
// actually cover.
const safeDateMs = fc.date({ noInvalidDate: true }).map((d) => d.getTime());
const dateSentinel = fc.oneof(
  fc.string({ maxLength: 24 }).map((s) => ({ $date: s })), // string form is never parsed/validated
  safeDateMs.map((ms) => ({ $date: ms })),
  safeDateMs.map((ms) => ({ $date: { $numberLong: String(ms) } })),
);

const numberSentinel = fc
  .tuple(fc.constantFrom('$numberInt', '$numberDouble', '$numberLong', '$numberDecimal'), fc.string({ maxLength: 16 }))
  .map(([key, value]) => ({ [key]: value }));

const regexSentinel = fc
  .tuple(fc.string({ maxLength: 16 }), fc.option(fc.string({ maxLength: 4 }), { nil: undefined }))
  .map(([pattern, options]) => (options === undefined ? { $regex: pattern } : { $regex: pattern, $options: options }));

const binarySentinel = fc
  .tuple(fc.string({ maxLength: 16 }), fc.string({ maxLength: 4 }))
  .map(([base64, subType]) => ({ $binary: { base64, subType } }));

const oidSentinel = fc.string({ maxLength: 24 }).map((s) => ({ $oid: s }));

const sentinelShape = fc.oneof(oidSentinel, dateSentinel, numberSentinel, regexSentinel, binarySentinel);

// A sentinel key plus one extra key never satisfies any shape guard (every
// guard requires an exact key set), so this exercises the "falls through to
// generic object" branches rather than only ever hitting a clean sentinel.
const nearMissSentinel = fc
  .tuple(sentinelShape, keyArb, fc.string({ maxLength: 8 }))
  .map(([shape, extraKey, extraValue]) => ({ ...shape, [extraKey]: extraValue }));

const { node } = fc.letrec((tie) => ({
  node: fc.oneof(
    { depthSize: 'small' as const },
    fc.string({ maxLength: 12 }),
    fc.double(),
    fc.constantFrom(NaN, Infinity, -Infinity),
    fc.boolean(),
    fc.constant(null),
    fc.constant(undefined),
    fc.oneof({ arbitrary: sentinelShape, weight: 3 }, { arbitrary: nearMissSentinel, weight: 1 }),
    fc.array(tie('node') as fc.Arbitrary<unknown>, { maxLength: 3 }),
    fc.dictionary(keyArb, tie('node') as fc.Arbitrary<unknown>, { maxKeys: 3 }),
  ),
}));

describe('toDisplayValue property: totality', () => {
  it('never throws, over every generated shape including hostile keys and near-miss sentinels', () => {
    fc.assert(
      fc.property(node, (v) => {
        expect(() => toDisplayValue(v)).not.toThrow();
      }),
      { numRuns: 40 },
    );
  });

  it('display is always a string', () => {
    fc.assert(
      fc.property(node, (v) => {
        expect(typeof toDisplayValue(v).display).toBe('string');
      }),
      { numRuns: 40 },
    );
  });

  it('raw is always reference-identical to the input — every branch returns `raw: v` untouched', () => {
    fc.assert(
      fc.property(node, (v) => {
        expect(toDisplayValue(v).raw).toBe(v);
      }),
      { numRuns: 40 },
    );
  });

  it('type is always one of the declared DisplayType values', () => {
    const VALID_TYPES = new Set<DisplayType>([
      'objectid', 'date', 'long', 'decimal', 'regex', 'binary',
      'string', 'number', 'boolean', 'null', 'array', 'object', 'undefined',
    ]);
    fc.assert(
      fc.property(node, (v) => {
        expect(VALID_TYPES.has(toDisplayValue(v).type)).toBe(true);
      }),
      { numRuns: 40 },
    );
  });
});

describe('valueToClipboardText property: totality', () => {
  it('never throws and always returns a string, over the same domain', () => {
    fc.assert(
      fc.property(node, (v) => {
        expect(() => valueToClipboardText(v)).not.toThrow();
        expect(typeof valueToClipboardText(v)).toBe('string');
      }),
      { numRuns: 40 },
    );
  });

  it('matches toDisplayValue(v).display for every pass-through DisplayType', () => {
    const PASS_THROUGH = new Set<DisplayType>(['objectid', 'date', 'long', 'decimal', 'regex', 'number', 'boolean', 'null']);
    fc.assert(
      fc.property(node, (v) => {
        // undefined and raw strings are special-cased before toDisplayValue is
        // ever called (valueToClipboardText's own early returns), so a claim
        // about matching its .display doesn't apply to them.
        fc.pre(v !== undefined && typeof v !== 'string');
        const dv = toDisplayValue(v);
        fc.pre(PASS_THROUGH.has(dv.type));
        expect(valueToClipboardText(v)).toBe(dv.display);
      }),
      { numRuns: 40 },
    );
  });
});

// A separate, JSON-safe-only generator for the round-trip claim below: `node`
// above deliberately includes NaN/Infinity/undefined leaves to stress
// toDisplayValue's totality, but JSON.stringify silently turns a non-finite
// number into `null` and drops an `undefined` property entirely — neither is
// a bug in valueToClipboardText, just a JSON.stringify property that would
// make a `toEqual` comparison fail for reasons unrelated to what this test is
// checking. `fc.double()`'s default DOES include NaN/Infinity as corner
// cases (confirmed by running the property below without `noNaN` — it failed
// on `{" ": Infinity}` inside a couple hundred runs), so this needs the
// explicit guard rather than relying on the same call used in `node` above.
// `-0` needs its own exclusion for a different reason: `JSON.stringify(-0)`
// is `"0"`, so it round-trips to `0`, and vitest's `toEqual` (unlike a plain
// `==`) tells `0` and `-0` apart — also confirmed directly, not assumed
// (`{" ": -0}` failed the same way before this filter was added). Both
// exclusions are about what JSON itself cannot carry, not about
// valueToClipboardText. `normalKey` only, no hostile keys — those are
// covered above; this test is about the JSON encoding, not key-collision
// safety.
const { jsonSafeNode } = fc.letrec((tie) => ({
  jsonSafeNode: fc.oneof(
    { depthSize: 'small' as const },
    fc.string({ maxLength: 12 }),
    fc.double({ noNaN: true, min: -1e10, max: 1e10 }).filter((n) => !Object.is(n, -0)),
    fc.boolean(),
    fc.constant(null),
    sentinelShape,
    fc.array(tie('jsonSafeNode') as fc.Arbitrary<unknown>, { maxLength: 3 }),
    fc.dictionary(normalKey, tie('jsonSafeNode') as fc.Arbitrary<unknown>, { maxKeys: 3 }),
  ),
}));
const jsonSafeContainer = fc.oneof(
  fc.array(jsonSafeNode, { maxLength: 3 }),
  fc.dictionary(normalKey, jsonSafeNode, { maxKeys: 3 }),
);

describe('valueToClipboardText property: array/object encoding is a faithful JSON round trip', () => {
  it('JSON.parse(valueToClipboardText(v)) reconstructs v structurally, for non-sentinel arrays and objects', () => {
    fc.assert(
      fc.property(jsonSafeContainer, (v) => {
        const dv = toDisplayValue(v);
        fc.pre(dv.type === 'array' || dv.type === 'object');
        expect(JSON.parse(valueToClipboardText(v))).toEqual(v);
      }),
      { numRuns: 30 },
    );
  });
});

// ─── Reported, not fixed ──────────────────────────────────────────────────
//
// toDisplayValue({ $date: <number outside ±8.64e15, or NaN> }) and
// toDisplayValue({ $date: { $numberLong: "<non-numeric or out-of-range>" } })
// throw a RangeError ("Invalid time value") instead of returning a
// DisplayValue — src/utils/displayValue.ts's `new Date(d).toISOString()` and
// `new Date(Number(d.$numberLong)).toISOString()` calls are unguarded, unlike
// the string-typed `$date` branch a few lines above them, which never parses
// or validates its input at all.
//
// Reachability, traced end to end rather than assumed: BSON's Date type is
// an unrestricted signed int64 of milliseconds, wider than what ECMAScript's
// `Date` can represent (±8.64e15). A document holding such a value (or one
// carrying an already-invalid Date, e.g. written by another driver/tool)
// deserializes in the Node driver to a JS `Invalid Date` — bson's own
// `EJSON.stringify` does not reject that, it serializes it losslessly as
// `{"$date":{"$numberLong":"NaN"}}` in canonical mode (verified directly, not
// assumed). `electron/mongo/ejson.ts` calls `EJSON.stringify` in canonical
// mode to build `documentsJson`; `electron/preload.ts:26` then plain
// `JSON.parse`s it into exactly the POJO shape this file's arbitrary
// generates, which reaches `toDisplayValue` unchanged through every renderer
// caller (TableView, JsonTree, DocFieldTree). No `ejsonRelaxed` flag or
// malformed-input path is needed — a normal document with an out-of-range
// date crashes every view that renders it. Confirmed with a direct call:
//   toDisplayValue({ $date: NaN })                          → throws
//   toDisplayValue({ $date: 8.64e15 + 1 })                   → throws
//   toDisplayValue({ $date: { $numberLong: 'notanumber' } }) → throws
//   toDisplayValue({ $date: { $numberLong: 'NaN' } })        → throws (the exact shape an Invalid Date serializes to)
// This file's `safeDateMs` generator stays inside the valid range so its
// totality claims are true of what they actually cover, rather than green by
// accident. Not fixed here — reported to the task owner instead.
