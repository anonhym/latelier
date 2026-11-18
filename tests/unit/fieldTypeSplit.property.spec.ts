import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { fieldTypeSplit } from '../../src/pages/Workspace/fieldTypeSplit';

const counts = fc.dictionary(
  fc.constantFrom('string', 'number', 'long', 'decimal', 'date', 'objectid', 'binary', 'null', 'array', 'object'),
  fc.oneof(fc.integer({ min: 0, max: 5000 }), fc.constantFrom(Number.NaN, -1, Infinity)),
);

describe('fieldTypeSplit properties', () => {
  it('never throws, and shares add up to 100 whenever anything was counted', () => {
    fc.assert(
      fc.property(counts, (types) => {
        const split = fieldTypeSplit({ types });
        const counted = Object.values(types).some((n) => Number.isFinite(n) && n > 0);
        const sum = split.reduce((a, s) => a + s.share, 0);
        expect(sum).toBe(counted ? 100 : 0);
      }),
    );
  });

  it('is sorted by share descending, ties in locale order, every share a whole positive number', () => {
    fc.assert(
      fc.property(counts, (types) => {
        const split = fieldTypeSplit({ types });
        for (const s of split) {
          expect(Number.isInteger(s.share)).toBe(true);
          expect(s.share).toBeGreaterThan(0);
        }
        for (let i = 1; i < split.length; i++) {
          const a = split[i - 1]!;
          const b = split[i]!;
          expect(a.share >= b.share).toBe(true);
          if (a.share === b.share) expect(a.type.localeCompare(b.type)).toBeLessThan(0);
        }
      }),
    );
  });

  it('does not depend on the order the types were counted in', () => {
    fc.assert(
      fc.property(counts, (types) => {
        const reversed = Object.fromEntries(Object.entries(types).reverse());
        expect(fieldTypeSplit({ types: reversed })).toEqual(fieldTypeSplit({ types }));
      }),
    );
  });

  it('a type never gets a share more than one point off its exact share', () => {
    fc.assert(
      fc.property(counts, (types) => {
        const total = Object.values(types).filter((n) => Number.isFinite(n) && n > 0).reduce((a, b) => a + b, 0);
        for (const s of fieldTypeSplit({ types })) {
          expect(Math.abs(s.share - (types[s.type]! * 100) / total)).toBeLessThan(1);
        }
      }),
    );
  });
});
