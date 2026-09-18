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
  /** `undefined` when `count` is 0 — nothing to name. */
  activeId: string | undefined;
  /** The DOM id a row at this index must carry. */
  rowId: (index: number) => string;
  /** Spread onto the container element. */
  containerProps: {
    tabIndex: 0;
    'aria-activedescendant': string | undefined;
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

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (count === 0) return;
      if (e.target !== e.currentTarget) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          move(1);
          scrollToIndex?.((index + 1) % count);
          return;
        case 'ArrowUp':
          e.preventDefault();
          move(-1);
          scrollToIndex?.((index - 1 + count) % count);
          return;
        case 'Home':
          e.preventDefault();
          setIndex(0);
          scrollToIndex?.(0);
          return;
        case 'End':
          e.preventDefault();
          setIndex(count - 1);
          scrollToIndex?.(count - 1);
          return;
        default:
          return;
      }
    },
    [count, index, move, setIndex, scrollToIndex],
  );

  return {
    activeIndex: index,
    activeId: count === 0 ? undefined : rowId(index),
    rowId,
    containerProps: {
      tabIndex: 0,
      'aria-activedescendant': count === 0 ? undefined : rowId(index),
    },
    onKeyDown,
  };
}
