import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  chipsFromValue,
  valueFromChips,
  chipText,
  parseChipText,
  isoToLocalInput,
  localInputToIso,
  type Chip,
} from '../../src/pages/Workspace/condValue';

// Two numbers are left out. `-0`: `String(-0)` and `JSON.stringify(-0)` both
// write "0", so no text form can carry it, and `toEqual` tells it from `0`.
// An integer past 2^53: `chipsFromValue` refuses it on purpose, keeping the
// text input (pinned in condValue.spec.ts).
const chipArb: fc.Arbitrary<Chip> = fc.oneof(
  fc.string(),
  fc
    .double({ noNaN: true, noDefaultInfinity: true })
    .filter((n) => !Object.is(n, -0) && (!Number.isInteger(n) || Number.isSafeInteger(n))),
  fc.boolean(),
  fc.constant(null),
);

describe('condValue properties', () => {
  it('a list of chips survives being written to the value and read back', () => {
    fc.assert(
      fc.property(fc.array(chipArb), (chips) => {
        expect(chipsFromValue(valueFromChips(chips))).toEqual(chips);
      }),
    );
  });

  it('a chip survives being shown as text and typed back in', () => {
    fc.assert(
      fc.property(chipArb, (chip) => {
        expect(parseChipText(chipText(chip))).toEqual(chip);
      }),
    );
  });

  it('a date to the minute survives the datetime-local input', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('1970-01-01T00:00:00Z'), max: new Date('2100-12-31T23:59:00Z'), noInvalidDate: true }),
        (d) => {
          const minute = new Date(Math.floor(d.getTime() / 60_000) * 60_000);
          expect(localInputToIso(isoToLocalInput(minute.toISOString()))).toBe(minute.toISOString());
        },
      ),
    );
  });
});
