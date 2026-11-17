import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { toggleProjectionField } from '../../src/pages/Workspace/projectionWriter';
import { isRawProjection, notFetchedFields, projectionMode } from '../../src/pages/Workspace/projection';
import type { BuilderState } from '@shared/types';

// No `__proto__` here on purpose: a literal key of that name needs building
// from a string, and the writer's own key handling is covered by example.
const TOP = ['_id', 'a', 'b', 'c', 'd'] as const;
const FIELDS = [...TOP, 'a.b'] as const;
// What a view knows is top-level names; a dotted path is only ever clicked.
const UNIVERSE = [...TOP];
const field = fc.constantFrom(...FIELDS);
const topField = fc.constantFrom(...TOP);
const subset = fc.uniqueArray(field, { maxLength: 4 });

const doc = (entries: [string, unknown][]) => JSON.stringify(Object.fromEntries(entries));
const base = (over: Partial<BuilderState>): BuilderState => ({ projection: [], sort: '', limit: '', ...over });

// Every shape the list can meet: nothing, an inclusion (modelled or with
// `_id: 0`), an exclusion, and each of those beside an operator.
const builder: fc.Arbitrary<BuilderState> = fc.oneof(
  fc.constant(base({})),
  subset.map((f) => base({ projection: f })),
  subset.map((f) => base({ projectionRaw: doc([...f.filter((k) => k !== '_id').map((k): [string, unknown] => [k, 1]), ['_id', 0]]) })),
  subset
    .filter((f) => f.length > 0)
    .map((f) => base({ projectionRaw: doc(f.map((k): [string, unknown] => [k, 0])) })),
  fc.constant(base({ projectionRaw: '{"tags":{"$slice":2}}' })),
  subset.map((f) => base({ projectionRaw: doc([...f.map((k): [string, unknown] => [k, 1]), ['tags', { $slice: 2 }]]) })),
  subset
    .filter((f) => f.length > 0)
    .map((f) => base({ projectionRaw: doc([...f.map((k): [string, unknown] => [k, 0]), ['tags', { $slice: 2 }]]) })),
);

const click = fc.record({ field, checked: fc.boolean() });

// The fetched set and the operators, which is what a projection means: two
// builders that agree on both send the server the same shape.
const meaning = (b: BuilderState) => ({
  notFetched: notFetchedFields(b, UNIVERSE),
  operators: projectionMode(b)
    .entries.filter(([k]) => projectionMode(b).locked.includes(k))
    .map(([k, v]) => [k, JSON.stringify(v)] as const)
    .sort((x, y) => x[0].localeCompare(y[0])),
});

describe('toggleProjectionField property: the written projection', () => {
  it('never mixes 1 and 0, except for _id, however the list is clicked', () => {
    fc.assert(
      fc.property(builder, fc.array(click, { maxLength: 12 }), (start, clicks) => {
        let b = start;
        for (const { field: f, checked } of clicks) {
          b = toggleProjectionField(b, f, checked, UNIVERSE);
          const { mode, entries } = projectionMode(b);
          expect(mode).not.toBe('invalid');
          const flags = entries.filter(([k, v]) => k !== '_id' && (v === 0 || v === 1 || v === true || v === false));
          const hasZero = flags.some(([, v]) => v === 0 || v === false);
          const hasOne = flags.some(([, v]) => v === 1 || v === true);
          expect(hasZero && hasOne).toBe(false);
        }
      }),
    );
  });

  it('always writes a projection the raw rule accepts, or the modelled list', () => {
    fc.assert(
      fc.property(builder, fc.array(click, { maxLength: 12 }), (start, clicks) => {
        let b = start;
        for (const { field: f, checked } of clicks) b = toggleProjectionField(b, f, checked, UNIVERSE);
        const text = b.projectionRaw?.trim();
        if (text) {
          expect(isRawProjection(text)).toBe(true);
          expect(b.projection).toEqual([]);
        }
      }),
    );
  });

  it('keeps every operator the user wrote through any number of clicks', () => {
    fc.assert(
      fc.property(builder, fc.array(click, { maxLength: 12 }), (start, clicks) => {
        const before = meaning(start).operators;
        let b = start;
        for (const { field: f, checked } of clicks) b = toggleProjectionField(b, f, checked, UNIVERSE);
        expect(meaning(b).operators).toEqual(before);
      }),
    );
  });

  it('unchecking then re-checking a field returns an equivalent projection (and the mirror)', () => {
    fc.assert(
      fc.property(builder, topField, (start, f) => {
        const { locked } = projectionMode(start);
        fc.pre(!locked.includes(f));
        const checked = !meaning(start).notFetched.includes(f);
        const there = toggleProjectionField(start, f, !checked, UNIVERSE);
        const back = toggleProjectionField(there, f, checked, UNIVERSE);
        expect(meaning(back)).toEqual(meaning(start));
      }),
    );
  });

  it('a click changes only the field it names: every other field keeps its checked state', () => {
    fc.assert(
      fc.property(builder, fc.record({ field: topField, checked: fc.boolean() }), (start, { field: f, checked }) => {
        const { locked } = projectionMode(start);
        fc.pre(!locked.includes(f));
        const next = toggleProjectionField(start, f, checked, UNIVERSE);
        const before = new Set(meaning(start).notFetched);
        const after = new Set(meaning(next).notFetched);
        for (const other of UNIVERSE.filter((k) => k !== f)) {
          expect(after.has(other)).toBe(before.has(other));
        }
      }),
    );
  });
});
