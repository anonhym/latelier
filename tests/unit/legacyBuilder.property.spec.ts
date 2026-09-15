import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { legacyCompileFilter } from '../../src/pages/Workspace/legacyBuilder';
import type { LegacyBuilderState, LegacyCond, LegacyValType } from '../../src/pages/Workspace/legacyBuilder';

// `field`/`op` are read from disk (a pre-#277 saved find payload) and used
// as computed object keys (`{ [cond.field]: … }`, `{ [cond.op]: … }`).
// Computed-key assignment always creates an own property rather than
// tripping the `{ __proto__: … }` object-literal special case — verified via
// `node -e` before this generator was written (the property below re-checks
// it holds through legacyCompileFilter's full pipeline, JSON.stringify
// included) — so these are folded in rather than excluded, per
// CLAUDE.md's key-set convention. `prototype` is left out: it collides on
// functions, not `Object.prototype`.
const HOSTILE_KEYS = [
  '__proto__',
  'constructor',
  'toString',
  'hasOwnProperty',
  'valueOf',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
];
const fieldNameArb = fc.oneof(
  { arbitrary: fc.string({ minLength: 1, maxLength: 10 }), weight: 4 },
  { arbitrary: fc.constantFrom(...HOSTILE_KEYS), weight: 1 },
);

const LEGACY_VAL_TYPES: LegacyValType[] = [
  'string', 'number', 'long', 'decimal', 'boolean', 'date', 'null', 'regex', 'objectid', 'array',
];
const KNOWN_OPS = [
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$all', '$exists',
  '$regex', '$type', '$mod', '$size', '$bitsAllClear', '$bitsAnyClear', '$bitsAllSet', '$bitsAnySet',
];
// A real payload's op always came from a fixed set, but the field is untyped
// on disk — an op outside `KNOWN_OPS` still reaches `buildCondValue`'s final
// `default:` branch, so it's folded in at low weight rather than excluded.
const opArb = fc.oneof(
  { arbitrary: fc.constantFrom(...KNOWN_OPS), weight: 5 },
  { arbitrary: fc.constantFrom(...HOSTILE_KEYS), weight: 1 },
);

// Value text is free-form on disk (a hand-edited tab row, an old format) —
// `buildTypedValue`/`buildCondValue` must not assume it parses as anything
// in particular for the valType it's paired with.
const condArb: fc.Arbitrary<LegacyCond> = fc.record({
  id: fc.nat(),
  field: fieldNameArb,
  op: opArb,
  valType: fc.constantFrom(...LEGACY_VAL_TYPES),
  value: fc.string({ maxLength: 20 }),
});

const stateArb: fc.Arbitrary<LegacyBuilderState> = fc.record({
  conditions: fc.array(condArb, { maxLength: 5 }),
  logic: fc.constantFrom<'AND' | 'OR'>('AND', 'OR'),
  projection: fc.array(fc.string({ maxLength: 8 }), { maxLength: 3 }),
  sort: fc.string({ maxLength: 20 }),
  limit: fc.string({ maxLength: 10 }),
});

describe('legacyCompileFilter property: total over any legacy builder state', () => {
  // Frozen (W13-2) — the only path standing between a pre-`queryRaw`
  // saved find and losing its filter once `builder.ts` drops the live
  // compiler's filter half. It must never throw regardless of how mangled
  // the on-disk shape is, including op/field names that collide with
  // Object.prototype members.
  it('never throws and always returns text that parses as JSON', () => {
    fc.assert(
      fc.property(stateArb, (state) => {
        let out = '';
        expect(() => (out = legacyCompileFilter(state))).not.toThrow();
        expect(() => JSON.parse(out)).not.toThrow();
      }),
      { numRuns: 50 },
    );
  });
});

describe('legacyCompileFilter property: a non-empty filter never widens to match-everything', () => {
  // Mirrors the live currentFilterJson invariant in builder.ts for the
  // frozen legacy path: `{}` here means the same thing it means live — "no
  // filter, match every document" — so at least one active (non-blank-field)
  // condition must never compile down to it.
  it('at least one active condition compiles to something other than {}', () => {
    fc.assert(
      fc.property(
        fc.array(condArb, { minLength: 1, maxLength: 5 }).filter((conds) => conds.some((c) => c.field.trim() !== '')),
        fc.constantFrom<'AND' | 'OR'>('AND', 'OR'),
        (conditions, logic) => {
          const state: LegacyBuilderState = { conditions, logic, projection: [], sort: '', limit: '' };
          expect(legacyCompileFilter(state)).not.toBe('{}');
        },
      ),
      { numRuns: 50 },
    );
  });

  // The other direction, pinned as a fixpoint rather than restated as a
  // second assertion: conditions whose field is entirely blank/whitespace
  // are the documented "inactive" case (`activeConds` filter) — dropping
  // all of them is the one legitimate way to reach `{}` here.
  it('all-blank-field conditions compile to {} same as no conditions at all', () => {
    fc.assert(
      fc.property(
        fc.array(condArb, { maxLength: 5 }).map((conds) => conds.map((c) => ({ ...c, field: '   ' }))),
        fc.constantFrom<'AND' | 'OR'>('AND', 'OR'),
        (conditions, logic) => {
          const state: LegacyBuilderState = { conditions, logic, projection: [], sort: '', limit: '' };
          expect(legacyCompileFilter(state)).toBe('{}');
        },
      ),
      { numRuns: 30 },
    );
  });
});

describe('legacyCompileFilter property: a hostile field name survives as an own key, not a prototype write', () => {
  // Direct check on the mechanism the totality property above exercises
  // indirectly: compiling a single condition whose field is a
  // Object.prototype member name produces a filter document with that name
  // as an own, readable key — not a silently dropped or corrupted one.
  it('single-condition output round-trips the hostile field as its own key', () => {
    fc.assert(
      fc.property(fc.constantFrom(...HOSTILE_KEYS), fc.string({ maxLength: 15 }), (field, value) => {
        const cond: LegacyCond = { id: 1, field, op: '$eq', valType: 'string', value };
        const state: LegacyBuilderState = { conditions: [cond], logic: 'AND', projection: [], sort: '', limit: '' };
        const parsed = JSON.parse(legacyCompileFilter(state)) as Record<string, unknown>;
        expect(Object.prototype.hasOwnProperty.call(parsed, field)).toBe(true);
        expect((parsed[field] as Record<string, unknown>).$eq).toBe(value);
      }),
      { numRuns: 20 },
    );
  });
});
