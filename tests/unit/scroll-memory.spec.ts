import { describe, it, expect, beforeEach } from 'vitest';
import { forgetScroll, recallScroll, rememberScroll } from '../../src/pages/Workspace/views/scrollMemory';

beforeEach(() => {
  forgetScroll('t1');
  forgetScroll('t2');
  forgetScroll('t');
  forgetScroll('t10');
});

describe('scrollMemory', () => {
  it('recalls 0 for a view never scrolled', () => {
    expect(recallScroll('t1', 'Table')).toBe(0);
  });

  it('keeps an offset per tab and per view', () => {
    rememberScroll('t1', 'Table', 120);
    rememberScroll('t1', 'Tree', 40);
    rememberScroll('t2', 'Table', 7);

    expect(recallScroll('t1', 'Table')).toBe(120);
    expect(recallScroll('t1', 'Tree')).toBe(40);
    expect(recallScroll('t2', 'Table')).toBe(7);
    expect(recallScroll('t2', 'Tree')).toBe(0);
  });

  it('the latest offset wins, and scrolling back to the top clears it', () => {
    rememberScroll('t1', 'JSON', 500);
    rememberScroll('t1', 'JSON', 90);
    expect(recallScroll('t1', 'JSON')).toBe(90);

    rememberScroll('t1', 'JSON', 0);
    expect(recallScroll('t1', 'JSON')).toBe(0);
  });

  it('forgetting a tab drops all of its views and only those', () => {
    rememberScroll('t1', 'Table', 1);
    rememberScroll('t1', 'Tree', 2);
    rememberScroll('t10', 'Table', 3);
    rememberScroll('t', 'Table', 4);

    forgetScroll('t1');

    expect(recallScroll('t1', 'Table')).toBe(0);
    expect(recallScroll('t1', 'Tree')).toBe(0);
    expect(recallScroll('t10', 'Table')).toBe(3);
    expect(recallScroll('t', 'Table')).toBe(4);
  });

  it('refuses an offset that is negative or not a finite number', () => {
    expect(() => rememberScroll('t1', 'Table', -1)).toThrow(/finite number >= 0, got -1/);
    expect(() => rememberScroll('t1', 'Table', Number.NaN)).toThrow(RangeError);
    expect(() => rememberScroll('t1', 'Table', Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(recallScroll('t1', 'Table')).toBe(0);
  });
});
