// @vitest-environment jsdom
//
// Same jsdom-opt-in as useRovingHighlight.spec.ts (see the comment there):
// this hook's key-mapping logic is pure and fast enough for Stryker's
// per-mutant rerun, but exercising a React hook still needs a real render.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

  // #62 — Home's own case had no direct assertion (only ArrowDown/ArrowUp/End
  // did), so nothing distinguished calling `scrollThenSettle(0)` from not
  // calling it at all.
  it('calls scrollToIndex with 0 on Home', () => {
    const scrollToIndex = vi.fn();
    const { result } = renderHook(() =>
      useRovingFocus({ count: 5, idPrefix: 'row-', scrollToIndex }),
    );
    act(() => result.current.onKeyDown(keyEvent('Home')));
    expect(scrollToIndex).toHaveBeenCalledWith(0);
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

  // #62 — `scrollThenSettle` (the wrapper around `scrollToIndex`) schedules a
  // deferred re-scroll two `requestAnimationFrame`s out, to land a long jump
  // past `useDynamicRowHeight`'s estimate flush in the viewport (see the
  // hook's own comment). These tests need per-frame control real rAF timing
  // can't give reliably, so they swap in a manual, synchronously-flushable
  // queue instead of `vi.useFakeTimers()` (which doesn't cover rAF at all).
  describe('scrollThenSettle re-scroll (#62)', () => {
    /**
     * A fake `requestAnimationFrame`/`cancelAnimationFrame` pair. `flush`
     * only runs callbacks queued *before* it was called and clears them
     * first — a callback that schedules another frame (the hook's nested
     * inner frame) lands in the fresh queue and needs a second `flush()`,
     * matching real rAF's per-frame batching.
     */
    function makeFrameQueue() {
      let nextId = 1;
      const callbacks = new Map<number, FrameRequestCallback>();
      return {
        request(cb: FrameRequestCallback): number {
          const id = nextId++;
          callbacks.set(id, cb);
          return id;
        },
        cancel(id: number): void {
          callbacks.delete(id);
        },
        flush(): void {
          const due = [...callbacks.entries()];
          callbacks.clear();
          for (const [, cb] of due) cb(0);
        },
      };
    }

    let queue: ReturnType<typeof makeFrameQueue>;
    let originalRaf: typeof window.requestAnimationFrame;
    let originalCaf: typeof window.cancelAnimationFrame;

    // Swap in the fake queue for this block only, and hand the real pair
    // (which may itself be `jsdomTeardown.ts`'s recording wrapper — see
    // that file's own comment) back afterward, so its handles are recorded
    // and swept for every other test in this file as usual.
    beforeEach(() => {
      queue = makeFrameQueue();
      originalRaf = window.requestAnimationFrame;
      originalCaf = window.cancelAnimationFrame;
      window.requestAnimationFrame = queue.request as typeof window.requestAnimationFrame;
      window.cancelAnimationFrame = queue.cancel as typeof window.cancelAnimationFrame;
    });

    afterEach(() => {
      window.requestAnimationFrame = originalRaf;
      window.cancelAnimationFrame = originalCaf;
    });

    it('re-issues scrollToIndex only after both deferred frames have run', () => {
      const scrollToIndex = vi.fn();
      const { result } = renderHook(() =>
        useRovingFocus({ count: 5, idPrefix: 'row-', scrollToIndex }),
      );

      act(() => result.current.onKeyDown(keyEvent('End')));
      expect(scrollToIndex).toHaveBeenCalledTimes(1);
      expect(scrollToIndex).toHaveBeenLastCalledWith(4);

      act(() => queue.flush()); // outer frame: schedules the inner one
      expect(scrollToIndex).toHaveBeenCalledTimes(1);

      act(() => queue.flush()); // inner frame: the actual re-scroll
      expect(scrollToIndex).toHaveBeenCalledTimes(2);
      expect(scrollToIndex).toHaveBeenLastCalledWith(4);
    });

    it('a newer jump cancels the older pending settle — the stale index is never re-scrolled to', () => {
      const scrollToIndex = vi.fn();
      const { result } = renderHook(() =>
        useRovingFocus({ count: 5, idPrefix: 'row-', scrollToIndex }),
      );

      act(() => result.current.onKeyDown(keyEvent('Home'))); // schedules a settle(0)
      act(() => result.current.onKeyDown(keyEvent('End'))); // must cancel it, schedule settle(4)
      scrollToIndex.mockClear();

      act(() => queue.flush());
      act(() => queue.flush());

      expect(scrollToIndex).not.toHaveBeenCalledWith(0);
      expect(scrollToIndex).toHaveBeenCalledWith(4);
    });

    it('unmounting cancels a still-pending settle', () => {
      const scrollToIndex = vi.fn();
      const { result, unmount } = renderHook(() =>
        useRovingFocus({ count: 5, idPrefix: 'row-', scrollToIndex }),
      );

      act(() => result.current.onKeyDown(keyEvent('End')));
      act(() => unmount());
      scrollToIndex.mockClear();

      act(() => queue.flush());
      act(() => queue.flush());

      expect(scrollToIndex).not.toHaveBeenCalled();
    });

    // The "newer jump cancels" test above never lets the older jump's *inner*
    // frame become the pending one (End's outer frame is still what's
    // cancelled) — this one lets End's outer frame fire first, so its inner
    // frame is the one a following Home has to cancel.
    it('a newer jump cancels a pending settle even once the outer frame has already fired', () => {
      const scrollToIndex = vi.fn();
      const { result } = renderHook(() =>
        useRovingFocus({ count: 5, idPrefix: 'row-', scrollToIndex }),
      );

      act(() => result.current.onKeyDown(keyEvent('End'))); // schedules End's outer frame
      act(() => queue.flush()); // outer fires -> schedules End's inner frame
      act(() => result.current.onKeyDown(keyEvent('Home'))); // must cancel that inner frame
      scrollToIndex.mockClear();

      act(() => queue.flush());
      act(() => queue.flush());

      expect(scrollToIndex).not.toHaveBeenCalledWith(4);
      expect(scrollToIndex).toHaveBeenCalledWith(0);
    });

    it('does not throw when scrollToIndex is omitted, even once the deferred settle fires', () => {
      const { result } = renderHook(() => useRovingFocus({ count: 5, idPrefix: 'row-' }));
      act(() => result.current.onKeyDown(keyEvent('End')));

      expect(() => {
        act(() => queue.flush());
        act(() => queue.flush());
      }).not.toThrow();
    });

    // Guards against a stale closure: a broken dependency array on
    // `scrollThenSettle` would keep calling the `scrollToIndex` captured at
    // first render even after the caller passed a new one in.
    it('picks up a scrollToIndex passed in after the initial render, not a stale one', () => {
      const first = vi.fn();
      const second = vi.fn();
      const { result, rerender } = renderHook(
        ({ scrollToIndex }) => useRovingFocus({ count: 5, idPrefix: 'row-', scrollToIndex }),
        { initialProps: { scrollToIndex: first } },
      );

      rerender({ scrollToIndex: second });
      act(() => result.current.onKeyDown(keyEvent('End')));

      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledWith(4);
    });

    // Guards the other half of the same dependency array: a broken one on
    // `cancelPendingSettle` itself would make it (and, transitively,
    // `scrollThenSettle`) a new function every render, so an unrelated
    // re-render (focus, here) would re-run the cleanup effect and cancel a
    // jump that's still legitimately pending.
    it('an unrelated re-render (focus) does not cancel a pending settle', () => {
      const scrollToIndex = vi.fn();
      const { result } = renderHook(() =>
        useRovingFocus({ count: 5, idPrefix: 'row-', scrollToIndex }),
      );

      act(() => result.current.onKeyDown(keyEvent('End')));
      act(() => result.current.containerProps.onFocus(focusEvent()));
      scrollToIndex.mockClear();

      act(() => queue.flush());
      act(() => queue.flush());

      expect(scrollToIndex).toHaveBeenCalledWith(4);
    });
  });
});
