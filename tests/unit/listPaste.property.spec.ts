import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { splitPastedList } from '../../src/pages/Workspace/listPaste';

const SEPARATORS = [',', '\n', '\t', '\r'];

describe('splitPastedList properties', () => {
  it('never yields an empty or untrimmed chip, and no chip holds a separator', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        for (const chip of splitPastedList(text)) {
          expect(chip).not.toBe('');
          expect(chip).toBe(chip.trim());
          expect(SEPARATORS.some((s) => chip.includes(s))).toBe(false);
        }
      }),
    );
  });

  it('joining with a comma and splitting again is a fixpoint', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const once = splitPastedList(text);
        expect(splitPastedList(once.join(','))).toEqual(once);
      }),
    );
  });

  it('chip-safe strings survive a join and split unchanged', () => {
    const chipSafe = fc.string().filter((s) => s !== '' && s === s.trim() && !SEPARATORS.some((sep) => s.includes(sep)));
    fc.assert(
      fc.property(fc.array(chipSafe), (chips) => {
        expect(splitPastedList(chips.join(','))).toEqual(chips);
      }),
    );
  });
});
