// @vitest-environment jsdom
//
// The run clock is a module-level store read through a hook, so a real render
// is the only way to observe it; the logic is timers and a map, fast enough
// for Stryker's per-mutant rerun.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '../helpers/render';
import { installJsdomTeardown } from '../helpers/jsdomTeardown';
import {
  CANCELLED_NOTICE_MS,
  _resetRunClocksForTests,
  cancelRunClock,
  settleRunClock,
  startRunClock,
  useRunClock,
} from '../../src/pages/Workspace/runClock';

installJsdomTeardown();

// The render helper mounts a MantineProvider, which reads matchMedia.
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

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  _resetRunClocksForTests();
  vi.useRealTimers();
});

describe('run clock', () => {
  it('is null until a find starts', () => {
    const { result } = renderHook(() => useRunClock('t1'));
    expect(result.current).toBeNull();
  });

  it('starts at zero and counts each second', () => {
    const { result } = renderHook(() => useRunClock('t1'));
    act(() => startRunClock('t1'));
    expect(result.current).toEqual({ kind: 'running', elapsedMs: 0 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toEqual({ kind: 'running', elapsedMs: 1000 });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current).toEqual({ kind: 'running', elapsedMs: 3000 });
  });

  it('keeps each tab\'s clock to itself', () => {
    const { result } = renderHook(() => useRunClock('t2'));
    act(() => startRunClock('t1'));
    expect(result.current).toBeNull();
  });

  it('restarts the count when a newer find starts', () => {
    const { result } = renderHook(() => useRunClock('t1'));
    act(() => startRunClock('t1'));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    act(() => startRunClock('t1'));
    expect(result.current).toEqual({ kind: 'running', elapsedMs: 0 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // One timer, not two: a leaked first interval would not change this, but a
    // stale start time would.
    expect(result.current).toEqual({ kind: 'running', elapsedMs: 1000 });
  });

  it('drops the old count on a restart, between the new one\'s ticks', () => {
    const { result } = renderHook(() => useRunClock('t1'));
    act(() => startRunClock('t1'));
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    act(() => startRunClock('t1'));
    // The first find's next tick falls here, 500ms in; it must not speak.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toEqual({ kind: 'running', elapsedMs: 0 });
  });

  it('clears on settle and stops counting', () => {
    const { result } = renderHook(() => useRunClock('t1'));
    const idle = vi.getTimerCount();
    act(() => startRunClock('t1'));
    expect(vi.getTimerCount()).toBe(idle + 1);
    act(() => settleRunClock('t1'));
    expect(result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(idle);
  });

  it('ignores a settle or cancel with nothing running', () => {
    const { result } = renderHook(() => useRunClock('t1'));
    const idle = vi.getTimerCount();
    act(() => settleRunClock('t1'));
    act(() => cancelRunClock('t1'));
    expect(result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(idle);
  });

  it('holds how long a cancelled find ran, then lets go after the notice', () => {
    const { result } = renderHook(() => useRunClock('t1'));
    act(() => startRunClock('t1'));
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    act(() => cancelRunClock('t1'));
    expect(result.current).toEqual({ kind: 'cancelled', elapsedMs: 2500 });

    act(() => {
      vi.advanceTimersByTime(CANCELLED_NOTICE_MS - 1);
    });
    expect(result.current).toEqual({ kind: 'cancelled', elapsedMs: 2500 });
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBeNull();
  });

  it('does not let a settle erase a cancelled notice', () => {
    const { result } = renderHook(() => useRunClock('t1'));
    act(() => startRunClock('t1'));
    act(() => cancelRunClock('t1'));
    act(() => settleRunClock('t1'));
    expect(result.current).toEqual({ kind: 'cancelled', elapsedMs: 0 });
  });

  it('replaces a cancelled notice when the next find starts', () => {
    const { result } = renderHook(() => useRunClock('t1'));
    act(() => startRunClock('t1'));
    act(() => cancelRunClock('t1'));
    act(() => {
      vi.advanceTimersByTime(CANCELLED_NOTICE_MS - 500);
    });
    act(() => startRunClock('t1'));
    expect(result.current).toEqual({ kind: 'running', elapsedMs: 0 });
    // The old notice timer falls due here, 500ms in; it must not clear the new run.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toEqual({ kind: 'running', elapsedMs: 0 });
  });
});
