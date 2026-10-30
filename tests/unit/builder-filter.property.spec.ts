import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { currentFilterJson, filterProblem } from '../../src/pages/Workspace/builder';
import { DEFAULT_COLLECTION_TAB_STATE } from '@shared/defaults';

// Every UTF-16 code unit `String.prototype.trim` strips, derived from the
// engine rather than listed by hand: engines have disagreed on members such
// as U+180E, and the property is about trim's set, whatever it is here.
const TRIM_SPACES = Array.from({ length: 0x10000 }, (_, c) => String.fromCharCode(c)).filter(
  (ch) => ch.trim() === '',
);

const padding = fc.array(fc.constantFrom(...TRIM_SPACES), { maxLength: 6 }).map((cs) => cs.join(''));

// Valid filter documents as strict JSON text: plain keys, JSON values.
const document = fc
  .dictionary(
    fc.string({ minLength: 1, maxLength: 6 }).filter((k) => !k.startsWith('$') && k !== '__proto__'),
    fc.oneof(fc.integer(), fc.string({ maxLength: 6 }), fc.boolean(), fc.constant(null)),
    { maxKeys: 4 },
  )
  .map((d) => JSON.stringify(d));

describe('filterProblem and currentFilterJson are one rule', () => {
  it('derives a non-empty whitespace set that includes the Unicode spaces JSON refuses', () => {
    expect(TRIM_SPACES).toEqual(expect.arrayContaining([' ', ' ', '﻿', ' ']));
  });

  it('accepts any valid document padded with trim whitespace, and sends it trimmed', () => {
    fc.assert(
      fc.property(padding, document, padding, (before, doc, after) => {
        const queryRaw = before + doc + after;
        const state = { ...DEFAULT_COLLECTION_TAB_STATE, queryRaw };
        expect(filterProblem(queryRaw)).toBeNull();
        expect(currentFilterJson(state)).toBe(doc);
      }),
    );
  });

  it('agrees on arbitrary text: null from one exactly when the other names a problem', () => {
    fc.assert(
      fc.property(padding, fc.oneof(document, fc.string({ maxLength: 12 })), padding, (before, mid, after) => {
        const queryRaw = before + mid + after;
        const state = { ...DEFAULT_COLLECTION_TAB_STATE, queryRaw };
        expect(currentFilterJson(state) === null).toBe(filterProblem(queryRaw) !== null);
      }),
    );
  });
});
