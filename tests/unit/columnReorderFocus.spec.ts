import { describe, it, expect } from 'vitest';
import { focusTargetAfterMove } from '../../src/pages/Workspace/columnReorderFocus';

/**
 * The four branches are two mirror-image pairs, which is exactly the shape
 * that shipped #56's inverted keyboard resize. Each case states its expected
 * button as a literal rather than deriving it from the direction, so an
 * inverted branch reddens here instead of agreeing with itself.
 */
describe('focusTargetAfterMove', () => {
  const CASES: ReadonlyArray<{
    direction: 'up' | 'down';
    newIndex: number;
    length: number;
    expected: 'up' | 'down';
    why: string;
  }> = [
    { direction: 'up', newIndex: 0, length: 3, expected: 'down', why: 'up button is now disabled' },
    { direction: 'up', newIndex: 1, length: 3, expected: 'up', why: 'mid-list, keep pressing up' },
    { direction: 'down', newIndex: 2, length: 3, expected: 'up', why: 'down button is now disabled' },
    { direction: 'down', newIndex: 1, length: 3, expected: 'down', why: 'mid-list, keep pressing down' },
  ];

  CASES.forEach(({ direction, newIndex, length, expected, why }) => {
    it(`${direction} landing at ${newIndex} of ${length} focuses "${expected}" — ${why}`, () => {
      expect(focusTargetAfterMove(direction, newIndex, length)).toBe(expected);
    });
  });

  it('hands over at both ends of a two-item list, where every move hits an end', () => {
    expect(focusTargetAfterMove('up', 0, 2)).toBe('down');
    expect(focusTargetAfterMove('down', 1, 2)).toBe('up');
  });

  it('never returns the button the move just disabled', () => {
    for (let length = 2; length <= 6; length += 1) {
      for (let newIndex = 0; newIndex < length; newIndex += 1) {
        for (const direction of ['up', 'down'] as const) {
          const target = focusTargetAfterMove(direction, newIndex, length);
          if (newIndex === 0) expect(target).not.toBe('up');
          if (newIndex === length - 1) expect(target).not.toBe('down');
        }
      }
    }
  });
});
