// Undo/redo history for the filter drawer's tree (W13 §5.7). Pure and
// generic: the drawer keeps one of these in component state, so it lives as
// long as the drawer's mount and no longer.

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /**
   * The coalescing key of the push that made `present`, or `null`. A run of
   * pushes with one key (a field typed a keystroke at a time) is one undo
   * step, not one per keystroke.
   */
  lastKey: string | null;
}

/** How many steps back undo can go; the oldest are dropped past this. */
export const HISTORY_CAP = 100;

export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], lastKey: null };
}

/**
 * Records `next` as the new present. With the same `key` as the push before
 * it, `next` replaces the present instead of adding a step. Any push drops
 * the redo stack.
 */
export function pushHistory<T>(h: History<T>, next: T, key?: string): History<T> {
  const lastKey = key ?? null;
  const past = lastKey !== null && lastKey === h.lastKey ? h.past : [...h.past, h.present].slice(-HISTORY_CAP);
  return { past, present: next, future: [], lastKey };
}

/** One step back; `h` itself when there is none. */
export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  return {
    past: h.past.slice(0, -1),
    present: h.past[h.past.length - 1]!,
    future: [h.present, ...h.future],
    lastKey: null,
  };
}

/** One step forward; `h` itself when there is none. */
export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  return {
    past: [...h.past, h.present],
    present: h.future[0]!,
    future: h.future.slice(1),
    lastKey: null,
  };
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}
