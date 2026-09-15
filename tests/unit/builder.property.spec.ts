import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ObjectId, Long, Decimal128 } from 'bson';
import {
  compileFindOptions,
  currentFilterJson,
  cycleSortField,
  parseSortString,
  sortProblem,
  limitWarning,
  projectionProblem,
  isDefaultQueryState,
  findProblem,
  classifySort,
  emptyBuilder,
} from '../../src/pages/Workspace/builder';
import { ejsonStringify, isEjsonDocument } from '../../src/utils/ejson';
import { DEFAULT_COLLECTION_TAB_STATE } from '@shared/defaults';
import type { BuilderState, CollectionTabState } from '@shared/types';

function makeTabState(overrides: Partial<CollectionTabState> = {}): CollectionTabState {
  return {
    ...DEFAULT_COLLECTION_TAB_STATE,
    builder: { ...DEFAULT_COLLECTION_TAB_STATE.builder, ...overrides.builder },
    ...overrides,
  };
}

// Field names as object keys throughout this module (`parseSortString`'s
// output map, projection object). Per CLAUDE.md's key-set convention —
// `prototype` excluded, it collides on functions, not `Object.prototype`.
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

// BSON leaves built from real driver constructors (feedback_probe_bson_with_real_values.md)
// nested inside a plain dictionary, so the resulting EJSON text's top level
// is always a plain object — never a lone sentinel that revives to a BSON
// instance (`isPlainDocument` would then read it as non-document).
const bsonLeaf = fc.oneof(
  fc.string({ maxLength: 10 }),
  fc.boolean(),
  fc.constant(null),
  fc.integer(),
  fc.constant(null).map(() => new ObjectId()),
  fc.integer({ min: -1000, max: 1000 }).map((n) => Long.fromNumber(n)),
  fc.integer({ min: -1000, max: 1000 }).map((n) => Decimal128.fromString(String(n))),
);
const validDocText = fc
  .dictionary(fieldNameArb, bsonLeaf, { maxKeys: 4 })
  .map((doc) => ejsonStringify(doc));

// Valid EJSON that is NOT a document — arrays, `null`, bare scalars, and a
// lone BSON sentinel (e.g. `{"$oid":"..."}` revives to an ObjectId, not a
// plain object — see isEjsonDocument's docstring).
const validNonDocText = fc.oneof(
  fc.array(bsonLeaf, { maxLength: 3 }).map((arr) => ejsonStringify(arr)),
  fc.constant('null'),
  fc.string({ maxLength: 10 }).map((s) => ejsonStringify(s)),
  fc.constant(null).map(() => ejsonStringify(new ObjectId())),
);

const blankText = fc.constantFrom('', '  ', '\n\t');

// Arbitrary text that mostly won't parse as JSON at all.
const garbageText = fc.string({ maxLength: 20 });

const anyRawFilterText = fc.oneof(
  { arbitrary: blankText, weight: 1 },
  { arbitrary: garbageText, weight: 2 },
  { arbitrary: validNonDocText, weight: 2 },
  { arbitrary: validDocText, weight: 3 },
);

describe('currentFilterJson property: never widens a filter to match-everything', () => {
  // The load-bearing invariant (docstring on currentFilterJson, delete-all's
  // only guard): the function may only ever hand back `null` or the caller's
  // own trimmed text — never a fabricated `{}`. A mutant that replaced
  // `return null` with `return '{}'` on the blank/invalid branch is exactly
  // what this catches; delete-all treats `null` as "nothing to run" and `{}`
  // as "match every document in the collection".
  it('result is either null or exactly the trimmed input, never a widened value', () => {
    fc.assert(
      fc.property(anyRawFilterText, (raw) => {
        const state = makeTabState({ queryRaw: raw });
        const result = currentFilterJson(state);
        if (result === null) {
          expect(raw.trim() === '' || !isEjsonDocument(raw)).toBe(true);
        } else {
          expect(result).toBe(raw.trim());
          expect(isEjsonDocument(raw)).toBe(true);
        }
      }),
      { numRuns: 50 },
    );
  });

  // Specifically: a document that IS a real filter (built from real BSON
  // values, non-empty EJSON text) is always passed through, never nulled and
  // never collapsed to `{}` behind the caller's back.
  it('a syntactically valid document is always returned as-is, never dropped or replaced', () => {
    fc.assert(
      fc.property(validDocText, (raw) => {
        const result = currentFilterJson(makeTabState({ queryRaw: raw }));
        expect(result).toBe(raw.trim());
      }),
      { numRuns: 30 },
    );
  });
});

describe('compileFindOptions property: total over any BuilderState', () => {
  const stateArb: fc.Arbitrary<BuilderState> = fc.record({
    projection: fc.array(fieldNameArb, { maxLength: 4 }),
    projectionRaw: fc.option(garbageText, { nil: undefined }),
    sort: fc.oneof(blankText, garbageText, validDocText),
    limit: fc.oneof(blankText, fc.string({ maxLength: 8 }).map((s) => s), fc.integer().map(String)),
  });

  it('never throws, and always returns a well-typed limit/sort/projection', () => {
    fc.assert(
      fc.property(stateArb, (state) => {
        const result = compileFindOptions(state);
        expect(result.limit === null || (Number.isFinite(result.limit) && result.limit > 0)).toBe(true);
        if (result.sort !== undefined) {
          expect(result.sort).toBe(state.sort.trim());
          expect(result.sort.length).toBeGreaterThan(0);
        }
        if (state.projectionRaw?.trim()) {
          expect(result.projection).toBe(state.projectionRaw.trim());
        } else if (state.projection.length > 0) {
          const parsed = JSON.parse(result.projection!) as Record<string, unknown>;
          expect(parsed._id).toBe(1);
          for (const f of state.projection) {
            expect(parsed[f]).toBe(1);
          }
        } else {
          expect(result.projection).toBeUndefined();
        }
      }),
      { numRuns: 50 },
    );
  });
});

describe('cycleSortField property: three applications from any state form a fixpoint', () => {
  // not-present → asc → desc → cleared → not-present … is a period-3 cycle
  // (verified against the source: undefined→{1}, 1→{-1}, anything else→'').
  // Once one application has landed the field in that cycle, three more
  // applications return to the same string — true from ANY starting raw,
  // garbage included, since a garbage/unparseable sort reads as "not
  // present" (parseSortString('') === {}) just like a blank one.
  it('applying it three more times after the first returns to the same value', () => {
    fc.assert(
      fc.property(fc.oneof(blankText, garbageText, validDocText), fieldNameArb, (raw, field) => {
        const s1 = cycleSortField(raw, field);
        const s2 = cycleSortField(s1, field);
        const s3 = cycleSortField(s2, field);
        const s4 = cycleSortField(s3, field);
        expect(s4).toBe(s1);
      }),
      { numRuns: 50 },
    );
  });

  // The fixpoint check above is vacuous for a field name that collides with
  // an Object.prototype member: an unguarded `current[field]` read resolves
  // to the inherited member (truthy, not `1`) on *every* application, so the
  // buggy function collapses to the degenerate one-state cycle `'' -> '' ->
  // '' -> ''` — which still satisfies "s4 equals s1". This test computes the
  // expected direction independently, via `hasOwnProperty.call` (never a bare
  // bracket read), so it can't share the same blind spot as the code under
  // test — and fails on the degenerate collapse instead of accepting it.
  it('each step matches an own-property read of the current sort map, for every field name', () => {
    fc.assert(
      fc.property(fc.oneof(blankText, garbageText, validDocText), fieldNameArb, (raw, field) => {
        const current = parseSortString(raw);
        const dir = Object.prototype.hasOwnProperty.call(current, field)
          ? current[field]
          : undefined;
        const result = cycleSortField(raw, field);
        if (dir === undefined) expect(result).toBe(JSON.stringify({ [field]: 1 }));
        else if (dir === 1) expect(result).toBe(JSON.stringify({ [field]: -1 }));
        else expect(result).toBe('');
      }),
      { numRuns: 50 },
    );
  });

  // Explicit worked example for the exact keys named in the report: the
  // real not-present -> asc -> desc -> cleared cycle, not the degenerate
  // always-empty one an unguarded read produces for these names.
  it.each(['constructor', 'valueOf', 'hasOwnProperty', 'toString'])(
    'cycles a %s-named field through asc -> desc -> cleared, not straight to cleared',
    (field) => {
      const s1 = cycleSortField('', field);
      expect(s1).toBe(JSON.stringify({ [field]: 1 }));
      const s2 = cycleSortField(s1, field);
      expect(s2).toBe(JSON.stringify({ [field]: -1 }));
      const s3 = cycleSortField(s2, field);
      expect(s3).toBe('');
    },
  );
});

describe('parseSortString property: round-trips a canonical direction map', () => {
  it('parseSortString(JSON.stringify(map)) recovers the same field→direction map', () => {
    fc.assert(
      fc.property(fc.dictionary(fieldNameArb, fc.constantFrom<1 | -1>(1, -1), { maxKeys: 4 }), (map) => {
        const back = parseSortString(JSON.stringify(map));
        expect(back).toEqual(map);
      }),
      { numRuns: 30 },
    );
  });
});

describe('property: the small query-state guards never throw on arbitrary text', () => {
  it('sortProblem, limitWarning, projectionProblem, isDefaultQueryState, findProblem, classifySort are total', () => {
    fc.assert(
      fc.property(fc.oneof(blankText, garbageText, validNonDocText, validDocText), (raw) => {
        const state = makeTabState({ queryRaw: raw, builder: { ...emptyBuilder(), sort: raw, limit: raw } });
        expect(() => sortProblem(raw)).not.toThrow();
        expect(() => limitWarning(raw)).not.toThrow();
        expect(() => projectionProblem(state.builder)).not.toThrow();
        expect(() => isDefaultQueryState(state)).not.toThrow();
        expect(() => findProblem(state)).not.toThrow();
        expect(() => classifySort(raw)).not.toThrow();
      }),
      { numRuns: 40 },
    );
  });
});
