import { describe, it, expect } from 'vitest';
import { AGENTS_TAB_ID, nthTab, steppedTab, stripOrder } from '../../src/features/agents/tabOrder';

describe('stripOrder', () => {
  it('appends the Agents tab last while it is open, and leaves the input alone', () => {
    const stored = ['a', 'b'];
    expect(stripOrder(stored, true)).toEqual(['a', 'b', AGENTS_TAB_ID]);
    expect(stripOrder(stored, false)).toEqual(['a', 'b']);
    expect(stripOrder(stored, false)).not.toBe(stored);
    expect(stored).toEqual(['a', 'b']);
  });

  it('is never a stored id', () => {
    expect(AGENTS_TAB_ID.startsWith('\u0000')).toBe(true);
  });
});

describe('steppedTab', () => {
  const order = ['a', 'b', AGENTS_TAB_ID];

  it('moves right and left, wrapping at both ends', () => {
    expect(steppedTab(order, 'a', 1)).toBe('b');
    expect(steppedTab(order, 'b', 1)).toBe(AGENTS_TAB_ID);
    expect(steppedTab(order, AGENTS_TAB_ID, 1)).toBe('a');
    expect(steppedTab(order, 'a', -1)).toBe(AGENTS_TAB_ID);
    expect(steppedTab(order, AGENTS_TAB_ID, -1)).toBe('b');
  });

  it('starts from the first with no focused tab, and does nothing for an unknown one', () => {
    expect(steppedTab(order, null, 1)).toBe('b');
    expect(steppedTab(order, null, -1)).toBe(AGENTS_TAB_ID);
    expect(steppedTab(order, 'zzz', 1)).toBeNull();
    expect(steppedTab([], null, 1)).toBeNull();
  });

  it('stays on the only tab', () => {
    expect(steppedTab([AGENTS_TAB_ID], AGENTS_TAB_ID, 1)).toBe(AGENTS_TAB_ID);
  });
});

describe('nthTab', () => {
  const order = ['a', 'b', AGENTS_TAB_ID];

  it('counts from 1, the Agents tab where it is drawn', () => {
    expect(nthTab(order, 1)).toBe('a');
    expect(nthTab(order, 3)).toBe(AGENTS_TAB_ID);
  });

  it('answers null past the end and for anything but a positive whole number', () => {
    expect(nthTab(order, 4)).toBeNull();
    expect(nthTab(order, 0)).toBeNull();
    expect(nthTab(order, -1)).toBeNull();
    expect(nthTab(order, 1.5)).toBeNull();
  });
});
