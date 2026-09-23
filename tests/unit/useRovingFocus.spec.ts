// @vitest-environment jsdom
//
// Same jsdom-opt-in as useRovingHighlight.spec.ts (see the comment there):
// this hook's key-mapping logic is pure and fast enough for Stryker's
// per-mutant rerun, but exercising a React hook still needs a real render.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '../helpers/render';
import { installJsdomTeardown } from '../helpers/jsdomTeardown';
import { useRovingFocus } from '../../src/hooks/useRovingFocus';

// #110 — unmount and clear pending timers after each test; see
// tests/helpers/jsdomTeardown.ts for why a jsdom unit spec needs this.
installJsdomTeardown();

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

/** A minimal stand-in for React.KeyboardEvent — only the fields onKeyDown reads. */
function keyEvent(
  key: string,
  opts: { sameTarget?: boolean } = {},
): React.KeyboardEvent {
  const sameTarget = opts.sameTarget ?? true;
  const target = {};
  return {
    key,
    target: sameTarget ? target : {},
    currentTarget: target,
    preventDefault: vi.fn(),
  } as unknown as React.KeyboardEvent;
}

/** A minimal stand-in for React.FocusEvent — only the fields onFocus/onBlur read. */
function focusEvent(opts: { sameTarget?: boolean } = {}): React.FocusEvent {
  const sameTarget = opts.sameTarget ?? true;
  const target = {};
  return {
    target: sameTarget ? target : {},
    currentTarget: target,
  } as unknown as React.FocusEvent;
}

describe('useRovingFocus', () => {
  it('starts on row 0 with a matching aria-activedescendant', () => {
    const { result } = renderHook(() => useRovingFocus({ count: 3, idPrefix: 'row-' }));
    expect(result.current.activeIndex).toBe(0);
    expect(result.current.activeId).toBe('row-0');
    expect(result.current.containerProps['aria-activedescendant']).toBe('row-0');
    expect(result.current.containerProps.tabIndex).toBe(0);
  });

  it('ArrowDown moves to the next row and wraps past the last', () => {
    const { result } = renderHook(() => useRovingFocus({ count: 3, idPrefix: 'row-' }));
    act(() => result.current.onKeyDown(keyEvent('ArrowDown')));
    expect(result.current.activeIndex).toBe(1);
    act(() => result.current.onKeyDown(keyEvent('ArrowDown')));
    act(() => result.current.onKeyDown(keyEvent('ArrowDown')));
    expect(result.current.activeIndex).toBe(0);
  });

  it('ArrowUp wraps backward past the first row', () => {
    const { result } = renderHook(() => useRovingFocus({ count: 3, idPrefix: 'row-' }));
    act(() => result.current.onKeyDown(keyEvent('ArrowUp')));
    expect(result.current.activeIndex).toBe(2);
  });

  it('Home and End jump to the first and last row', () => {
    const { result } = renderHook(() => useRovingFocus({ count: 5, idPrefix: 'row-' }));
    act(() => result.current.onKeyDown(keyEvent('ArrowDown')));
    act(() => result.current.onKeyDown(keyEvent('End')));
    expect(result.current.activeIndex).toBe(4);
    act(() => result.current.onKeyDown(keyEvent('Home')));
    expect(result.current.activeIndex).toBe(0);
  });

  it('calls preventDefault for every handled navigation key, not for others', () => {
    const { result } = renderHook(() => useRovingFocus({ count: 3, idPrefix: 'row-' }));
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
      const handled = keyEvent(key);
      act(() => result.current.onKeyDown(handled));
      expect(handled.preventDefault).toHaveBeenCalledTimes(1);
    }

    const ignored = keyEvent('Enter');
    act(() => result.current.onKeyDown(ignored));
    expect(ignored.preventDefault).not.toHaveBeenCalled();
  });

  it('does not preventDefault a navigation key when count is 0 — nothing to navigate', () => {
    const { result } = renderHook(() => useRovingFocus({ count: 0, idPrefix: 'row-' }));
    const e = keyEvent('ArrowDown');
    act(() => result.current.onKeyDown(e));
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores a key that bubbled up from a nested control', () => {
    const { result } = renderHook(() => useRovingFocus({ count: 3, idPrefix: 'row-' }));
    act(() => result.current.onKeyDown(keyEvent('ArrowDown', { sameTarget: false })));
    expect(result.current.activeIndex).toBe(0);
  });

  it('is a no-op when count is 0 — no activedescendant, no crash on ArrowDown', () => {
    const { result } = renderHook(() => useRovingFocus({ count: 0, idPrefix: 'row-' }));
    expect(result.current.activeId).toBeUndefined();
    expect(result.current.containerProps['aria-activedescendant']).toBeUndefined();
    act(() => result.current.onKeyDown(keyEvent('ArrowDown')));
    expect(result.current.activeIndex).toBe(0);
  });

  it('calls scrollToIndex synchronously with the row about to become active', () => {
    const scrollToIndex = vi.fn();
    const { result } = renderHook(() =>
      useRovingFocus({ count: 3, idPrefix: 'row-', scrollToIndex }),
    );
    act(() => result.current.onKeyDown(keyEvent('ArrowDown')));
    expect(scrollToIndex).toHaveBeenCalledWith(1);
    act(() => result.current.onKeyDown(keyEvent('End')));
    expect(scrollToIndex).toHaveBeenCalledWith(2);
  });

  it('calls scrollToIndex with the wrapped-backward target on ArrowUp', () => {
    const scrollToIndex = vi.fn();
    const { result } = renderHook(() =>
      useRovingFocus({ count: 3, idPrefix: 'row-', scrollToIndex }),
    );
    act(() => result.current.onKeyDown(keyEvent('ArrowUp')));
    expect(scrollToIndex).toHaveBeenCalledWith(2);
  });

  // #60 — highlightIndex drives the visual active-row treatment; it must
  // track real container focus separately from activeIndex (which Enter/
  // Space handling reads and must never see go to -1).
  describe('highlightIndex (#60)', () => {
    it('is -1 before the container has focus', () => {
      const { result } = renderHook(() => useRovingFocus({ count: 3, idPrefix: 'row-' }));
      expect(result.current.highlightIndex).toBe(-1);
    });

    it('equals activeIndex once the container gains focus, and follows it', () => {
      const { result } = renderHook(() => useRovingFocus({ count: 3, idPrefix: 'row-' }));
      act(() => result.current.containerProps.onFocus(focusEvent()));
      expect(result.current.highlightIndex).toBe(0);
      act(() => result.current.onKeyDown(keyEvent('ArrowDown')));
      expect(result.current.highlightIndex).toBe(result.current.activeIndex);
      expect(result.current.highlightIndex).toBe(1);
    });

    it('returns to -1 on blur', () => {
      const { result } = renderHook(() => useRovingFocus({ count: 3, idPrefix: 'row-' }));
      act(() => result.current.containerProps.onFocus(focusEvent()));
      act(() => result.current.containerProps.onBlur(focusEvent()));
      expect(result.current.highlightIndex).toBe(-1);
    });

    it('stays -1 for an empty list even while the container has focus', () => {
      const { result } = renderHook(() => useRovingFocus({ count: 0, idPrefix: 'row-' }));
      act(() => result.current.containerProps.onFocus(focusEvent()));
      expect(result.current.highlightIndex).toBe(-1);
      // `activeIndex` is 0 here, not -1 — the two are deliberately different
      // values, and this is the case that shows it.
      expect(result.current.activeIndex).toBe(0);
    });

    it('ignores a focus/blur whose target is not the container itself', () => {
      const { result } = renderHook(() => useRovingFocus({ count: 3, idPrefix: 'row-' }));
      act(() => result.current.containerProps.onFocus(focusEvent({ sameTarget: false })));
      expect(result.current.highlightIndex).toBe(-1);

      act(() => result.current.containerProps.onFocus(focusEvent()));
      act(() => result.current.containerProps.onBlur(focusEvent({ sameTarget: false })));
      expect(result.current.highlightIndex).toBe(0);
    });
  });

  it('rowId/activeId reflect the current idPrefix', () => {
    const { result, rerender } = renderHook(
      ({ idPrefix }) => useRovingFocus({ count: 3, idPrefix }),
      { initialProps: { idPrefix: 'a-' } },
    );
    expect(result.current.activeId).toBe('a-0');
    rerender({ idPrefix: 'b-' });
    expect(result.current.activeId).toBe('b-0');
  });
});
