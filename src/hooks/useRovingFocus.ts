import React from 'react';
import { useRovingHighlight } from './useRovingHighlight';

export interface UseRovingFocusOptions {
  /** Number of navigable rows. */
  count: number;
  /** Prefix for each row's stable DOM `id` — must match what the caller puts
   * on the row it renders at that index (`${idPrefix}${index}`), since
   * `aria-activedescendant` only works if it names a real element. */
  idPrefix: string;
  /** Forwarded to `useRovingHighlight` — pass the value that means "this is
   * conceptually a new list" (e.g. the `documents` array reference). */
  resetKey?: unknown;
  /**
   * Called synchronously, in the same key handler that moves the active
   * index, with the row index that is about to become active. A
   * virtualized list needs this to scroll the row into the mounted range
   * (`listRef.current.scrollToRow`) — `aria-activedescendant` is only valid
   * once that row actually exists in the DOM, so the scroll can't wait for
   * a separate effect a render later. Omit when nothing needs scrolling
   * (content that's always fully mounted).
   */
  scrollToIndex?: (index: number) => void;
}

export interface RovingFocus {
  /** Index of the row `aria-activedescendant` currently names. */
  activeIndex: number;
  /**
   * #60 — the row to paint the visual active-row treatment on, or `-1` to
   * paint none. Deliberately not the same value as `activeIndex`: a
   * screen reader hears `aria-activedescendant` whether or not the
   * container has real DOM focus (it's just an ARIA attribute, always
   * present once there's a row to name), but a *sighted* highlight that
   * stayed lit with focus elsewhere in the app would look like a stuck,
   * meaningless row — so this collapses to `-1` whenever the container
   * itself doesn't have focus, while `activeIndex` (read by Enter/Space
   * handling) must keep naming a real row even then.
   */
  highlightIndex: number;
  /** `undefined` when `count` is 0 — nothing to name. */
  activeId: string | undefined;
  /** The DOM id a row at this index must carry. */
  rowId: (index: number) => string;
  /**
   * Jump the active row directly, bypassing Arrow/Home/End — for a click on
   * row N, so the next Arrow key continues from the row just clicked rather
   * than from wherever the highlight was sitting before. Delegates straight
   * to `useRovingHighlight`'s own `setIndex`; never reimplemented here.
   */
  setActiveIndex: (index: number) => void;
  /** Spread onto the container element. */
  containerProps: {
    tabIndex: 0;
    'aria-activedescendant': string | undefined;
    onFocus: (e: React.FocusEvent) => void;
    onBlur: (e: React.FocusEvent) => void;
  };
  /**
   * Handles ArrowUp/ArrowDown/Home/End by moving the active row via
   * `useRovingHighlight`'s own `move`/`setIndex` — never reimplemented here.
   * Ignored when the key bubbled up from a nested control (`e.target !==
   * e.currentTarget`), so tabbing into a row's own button or an inline-edit
   * input keeps that control's native key behaviour. Leaves every other key,
   * Enter/Space included, for the caller to handle after it — activation
   * differs too much per view (select a Table row, expand/collapse a Tree
   * or field row) to own here, same reasoning `useRovingHighlight` already
   * documents for staying out of key bindings.
   */
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export function useRovingFocus({
  count,
  idPrefix,
  resetKey,
  scrollToIndex,
}: UseRovingFocusOptions): RovingFocus {
  const { index, setIndex, move } = useRovingHighlight(count, resetKey);
  const rowId = React.useCallback((i: number) => `${idPrefix}${i}`, [idPrefix]);

  // #62 — a long jump (Home/End, or any move past never-rendered rows) asks
  // `scrollToIndex` to compute an offset from react-window's dynamic-height
  // cache while most of the rows it's summing are still at their
  // `defaultRowHeight` estimate, so the target can land clipped instead of
  // fully in view. The first call still has to run synchronously (this
  // docstring's own requirement — the row must exist in the DOM before
  // `aria-activedescendant` names it); the fix is a second call once the
  // rows the jump just mounted have reported their real measured height via
  // `ResizeObserver` and corrected the cache. A single `requestAnimationFrame`
  // measured too early (still using the old estimate — the mount → layout
  // effect → `ResizeObserver` chain hadn't settled yet); two nested frames
  // did, confirmed against a real Electron window rather than assumed.
  // Re-running the same scroll then lands on the corrected offset. Harmless
  // for ArrowUp/ArrowDown, which don't hit this (each step moves at most one
  // row, so there's no unmeasured span to accumulate error over).
  //
  // Both pending frame ids are tracked so a newer jump — or an unmount —
  // can cancel a still-pending settle: without this, a quick Home-then-End
  // let Home's deferred re-scroll fire after End's jump and flick the list
  // back to row 0, and a settle could still fire after the list itself had
  // unmounted.
  const outerFrame = React.useRef<number | null>(null);
  const innerFrame = React.useRef<number | null>(null);
  // The `!== null` guards only skip a no-op: `cancelAnimationFrame` on a
  // stale/nonexistent handle (including `null`) is a documented no-op, never
  // a throw — confirmed against jsdom directly, not assumed from the spec.
  // Stryker's "always call it" mutant on either guard is genuinely
  // equivalent for that reason; its "never call it" and "flip the check"
  // mutants are real bugs and are covered below (a still-pending settle
  // that a newer jump must cancel).
  // This `useCallback`'s own `[]` closes over nothing (only stable refs), so
  // swapping it for a hardcoded non-empty literal is also equivalent: React
  // compares dependency arrays element-by-element with `Object.is`, and a
  // literal is the same value on every render, so it never trips the
  // "changed" branch any differently than `[]` does. Same reasoning applies
  // to `handleFocus`/`handleBlur` a little further down.
  const cancelPendingSettle = React.useCallback(() => {
    if (outerFrame.current !== null) cancelAnimationFrame(outerFrame.current);
    if (innerFrame.current !== null) cancelAnimationFrame(innerFrame.current);
    outerFrame.current = null;
    innerFrame.current = null;
  }, []);
  // `cancelPendingSettle`'s own deps are `[]`, so its identity is stable for
  // the component's lifetime (React's `useCallback([])` contract) — this
  // effect's `[cancelPendingSettle]` dep therefore never actually changes
  // across renders, making it equivalent to `[]` here specifically. Kept
  // for the normal reason to list a dep an effect closes over, not because
  // this instance can behave differently.
  React.useEffect(() => cancelPendingSettle, [cancelPendingSettle]);

  const scrollThenSettle = React.useCallback(
    (i: number) => {
      cancelPendingSettle();
      scrollToIndex?.(i);
      outerFrame.current = requestAnimationFrame(() => {
        outerFrame.current = null;
        innerFrame.current = requestAnimationFrame(() => {
          innerFrame.current = null;
          scrollToIndex?.(i);
        });
      });
    },
    [scrollToIndex, cancelPendingSettle],
  );

  // #60 — tracks real DOM focus on the container so `highlightIndex` can
  // collapse to `-1` while it's elsewhere, without touching `activeIndex`
  // (see that field's docstring on `RovingFocus`). Guarded the same way
  // `onKeyDown` already documents: React's `onFocus`/`onBlur` map to
  // `focusin`/`focusout`, which bubble, so without the own-target check,
  // a nested row control (an expand button, a whole nested `DocFieldTree`)
  // taking focus would light up this container too.
  const [focused, setFocused] = React.useState(false);
  const handleFocus = React.useCallback((e: React.FocusEvent) => {
    if (e.target !== e.currentTarget) return;
    setFocused(true);
  }, []);
  const handleBlur = React.useCallback((e: React.FocusEvent) => {
    if (e.target !== e.currentTarget) return;
    setFocused(false);
  }, []);

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (count === 0) return;
      if (e.target !== e.currentTarget) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          move(1);
          scrollThenSettle((index + 1) % count);
          return;
        case 'ArrowUp':
          e.preventDefault();
          move(-1);
          scrollThenSettle((index - 1 + count) % count);
          return;
        case 'Home':
          e.preventDefault();
          setIndex(0);
          scrollThenSettle(0);
          return;
        case 'End':
          e.preventDefault();
          setIndex(count - 1);
          scrollThenSettle(count - 1);
          return;
        default:
          return;
      }
    },
    [count, index, move, setIndex, scrollThenSettle],
  );

  return {
    activeIndex: index,
    // The `count === 0` arm matches `activeId` and `aria-activedescendant`
    // below rather than leaning on callers: with no rows, `index` is 0, not
    // -1, so a focused empty widget would nominate row 0. No caller renders a
    // row at index 0 while `count` is 0 today, so nothing paints — but the
    // three values on these lines should agree about what "empty" means.
    highlightIndex: count === 0 || !focused ? -1 : index,
    activeId: count === 0 ? undefined : rowId(index),
    rowId,
    setActiveIndex: setIndex,
    containerProps: {
      tabIndex: 0,
      'aria-activedescendant': count === 0 ? undefined : rowId(index),
      onFocus: handleFocus,
      onBlur: handleBlur,
    },
    onKeyDown,
  };
}
