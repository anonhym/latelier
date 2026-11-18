import { describe, it, expect } from 'vitest';
import { fieldTypeSplit } from '../../src/pages/Workspace/fieldTypeSplit';

describe('fieldTypeSplit', () => {
  it('lists the types most common first with their whole-percent shares', () => {
    expect(fieldTypeSplit({ types: { number: 38, string: 62 } })).toEqual([
      { type: 'string', share: 62 },
      { type: 'number', share: 38 },
    ]);
  });

  it('is empty when nothing was counted', () => {
    expect(fieldTypeSplit({ types: {} })).toEqual([]);
    expect(fieldTypeSplit({ types: { string: 0 } })).toEqual([]);
  });

  it('ignores counts that are not positive numbers', () => {
    expect(fieldTypeSplit({ types: { string: 4, number: -3, date: Number.NaN, long: Infinity } })).toEqual([
      { type: 'string', share: 100 },
    ]);
  });

  it('rounds by largest remainder so the shares add up to 100', () => {
    const split = fieldTypeSplit({ types: { a: 1, b: 1, c: 1 } });
    expect(split.map((s) => s.share)).toEqual([34, 33, 33]);
  });

  it('gives the spare percent to the largest remainder, not the largest type', () => {
    // 2/3 is 66.67 and 1/3 is 33.33: floors 66 + 33 leave one point, which belongs to the .67.
    expect(fieldTypeSplit({ types: { number: 1, string: 2 } })).toEqual([
      { type: 'string', share: 67 },
      { type: 'number', share: 33 },
    ]);
  });

  it('breaks equal remainders and equal shares by locale order of the type name', () => {
    expect(fieldTypeSplit({ types: { string: 1, number: 1 } }).map((s) => s.type)).toEqual(['number', 'string']);
    // Three-way tie: the spare point goes to the first name in order.
    expect(fieldTypeSplit({ types: { c: 1, a: 1, b: 1 } })).toEqual([
      { type: 'a', share: 34 },
      { type: 'b', share: 33 },
      { type: 'c', share: 33 },
    ]);
  });

  it('keeps a lone type at 100', () => {
    expect(fieldTypeSplit({ types: { binary: 7 } })).toEqual([{ type: 'binary', share: 100 }]);
  });

  it('leaves out a type too rare to earn a percent, and still adds up to 100', () => {
    const split = fieldTypeSplit({ types: { string: 1000, number: 1 } });
    expect(split).toEqual([{ type: 'string', share: 100 }]);
  });

  it('sorts shares descending across more than two types', () => {
    const split = fieldTypeSplit({ types: { a: 10, b: 60, c: 30 } });
    expect(split.map((s) => s.type)).toEqual(['b', 'c', 'a']);
  });

  it('ranks the spare point by the fraction lost, not by the size of the type', () => {
    // 60.4 and 39.6: the 39.6 lost more, so it rounds up.
    expect(fieldTypeSplit({ types: { big: 604, small: 396 } })).toEqual([
      { type: 'big', share: 60 },
      { type: 'small', share: 40 },
    ]);
  });
});
