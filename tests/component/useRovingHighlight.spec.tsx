import { describe, it, expect } from 'vitest';
import { renderHook, act } from '../helpers/render';
import { useRovingHighlight } from '../../src/hooks/useRovingHighlight';

describe('useRovingHighlight', () => {
  it('starts at index 0', () => {
    const { result } = renderHook(() => useRovingHighlight(5));
    expect(result.current.index).toBe(0);
  });

  it('wraps forward past the last row back to 0', () => {
    const { result } = renderHook(() => useRovingHighlight(3));
    act(() => result.current.setIndex(2));
    act(() => result.current.move(1));
    expect(result.current.index).toBe(0);
  });

  it('wraps backward past the first row to the last', () => {
    const { result } = renderHook(() => useRovingHighlight(3));
    act(() => result.current.move(-1));
    expect(result.current.index).toBe(2);
  });

  it('moves within bounds without wrapping', () => {
    const { result } = renderHook(() => useRovingHighlight(3));
    act(() => result.current.move(1));
    expect(result.current.index).toBe(1);
  });

  // The clamp invariant: a highlight must never name a row that filtering
  // (or an external delete) has removed, even though nothing explicitly
  // reset it when the list shrank.
  it('clamps a standing highlight when count shrinks out from under it', () => {
    const { result, rerender } = renderHook(({ count }) => useRovingHighlight(count), {
      initialProps: { count: 5 },
    });
    act(() => result.current.setIndex(4));
    expect(result.current.index).toBe(4);

    rerender({ count: 2 });
    expect(result.current.index).toBe(1);
  });

  it('clamps to 0 when count drops to 0, and move() is a no-op', () => {
    const { result, rerender } = renderHook(({ count }) => useRovingHighlight(count), {
      initialProps: { count: 3 },
    });
    act(() => result.current.setIndex(2));
    rerender({ count: 0 });
    expect(result.current.index).toBe(0);

    act(() => result.current.move(1));
    expect(result.current.index).toBe(0);
  });

  it('move() computes from the clamped index, not a stale raw one', () => {
    // Standing highlight at the last row of a 5-item list; the list then
    // shrinks to 2 without an explicit reset (e.g. an external delete).
    // The clamped index is 1 (last row of 2) — moving forward from *that*
    // must wrap to 0, not to whatever raw-index-mod-2 would have produced.
    const { result, rerender } = renderHook(({ count }) => useRovingHighlight(count), {
      initialProps: { count: 5 },
    });
    act(() => result.current.setIndex(4));
    rerender({ count: 2 });
    expect(result.current.index).toBe(1);

    act(() => result.current.move(1));
    expect(result.current.index).toBe(0);
  });

  it('resetKey changing resets the index to 0 without an explicit call', () => {
    const { result, rerender } = renderHook(
      ({ count, resetKey }) => useRovingHighlight(count, resetKey),
      { initialProps: { count: 5, resetKey: 'a' } },
    );
    act(() => result.current.setIndex(3));
    expect(result.current.index).toBe(3);

    rerender({ count: 5, resetKey: 'b' });
    expect(result.current.index).toBe(0);
  });

  it('without a resetKey, the index survives a re-render with the same count', () => {
    const { result, rerender } = renderHook(({ count }) => useRovingHighlight(count), {
      initialProps: { count: 5 },
    });
    act(() => result.current.setIndex(3));
    rerender({ count: 5 });
    expect(result.current.index).toBe(3);
  });
});
