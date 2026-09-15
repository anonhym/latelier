import React from 'react';

export interface RovingHighlight {
  /** Always in `[0, count - 1]` (or `0` when `count` is `0`) — never names a row that isn't there. */
  index: number;
  /** Jump straight to a row (click, hover, Home/End). */
  setIndex: (index: number) => void;
  /** Move by `delta` from the current (already-clamped) `index`, wrapping at both ends. */
  move: (delta: number) => void;
}

/**
 * Owns the clamp-at-render + wrap-around arithmetic shared by every
 * keyboard-navigable list in the app (`ConnectionSwitcher`, `SuggestionPopover`,
 * `CommandPalette`, `ConnectionExpandedTable`). Doesn't own key
 * bindings or DOM wiring: callers differ too much (a subtree `onKeyDown` vs.
 * a manual `window`/anchor `addEventListener`) to unify that too; this hook
 * only owns "what index is highlighted right now."
 *
 * `move` computes from the current *clamped* `index`, not the raw stored
 * one — this is `ConnectionSwitcher`'s original approach (the one named
 * "the better base" when this hook was extracted), which stays correct
 * even when `count` shrinks out from under a standing highlight for a
 * reason the component never sees
 * (e.g. a Connection deleted elsewhere in the app while its popover is
 * open) — the next arrow press still walks from a row that's actually on
 * screen, not from a stale raw index.
 *
 * `resetKey`: pass a value that changes when the underlying list is
 * conceptually "new" (e.g. a search query) to reset the highlight to `0`
 * without an effect — the same trick a command palette needs when it
 * doesn't own the search input's `onChange` directly. Omit it for a
 * component that resets the highlight itself (an explicit `setIndex(0)`
 * alongside its own query handler).
 */
export function useRovingHighlight(count: number, resetKey?: unknown): RovingHighlight {
  const [state, setState] = React.useState<{ raw: number; key: unknown }>({ raw: 0, key: resetKey });
  const raw = state.key === resetKey ? state.raw : 0;
  const index = count === 0 ? 0 : Math.min(raw, count - 1);

  const setIndex = React.useCallback(
    (next: number) => setState({ raw: next, key: resetKey }),
    [resetKey],
  );

  const move = React.useCallback(
    (delta: number) => {
      if (count === 0) return;
      setState({ raw: (index + delta + count) % count, key: resetKey });
    },
    [count, index, resetKey],
  );

  return { index, setIndex, move };
}
