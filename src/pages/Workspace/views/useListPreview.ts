import React from 'react';

/**
 * The keyboard half of the Saved and History popovers (W05 §9.6): ↑↓ move a
 * highlight through the list while the focus stays in the search box, and
 * Enter loads the highlighted entry. The highlight is what the popover's
 * preview shows, so an entry can be read before it is loaded.
 */
export function useListPreview<T>(
  items: readonly T[],
  onEnter: (item: T) => void,
): {
  /** The highlighted entry; null for an empty list. */
  active: T | null;
  highlight: (index: number) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
} {
  const [index, setIndex] = React.useState(0);
  // The list shrinks under a search or a delete: the highlight stays on a row.
  const at = Math.min(index, items.length - 1);
  const active = items[at] ?? null;
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex(Math.min(at + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex(Math.max(at - 1, 0));
    } else if (e.key === 'Enter' && active !== null) {
      e.preventDefault();
      onEnter(active);
    }
  };
  return { active, highlight: setIndex, onKeyDown };
}
