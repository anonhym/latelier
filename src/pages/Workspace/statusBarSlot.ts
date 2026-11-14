import { useSyncExternalStore } from 'react';

/**
 * Where the Focused Tab's own status goes (W01 §14.6). The status bar is part
 * of the shell, outside every tab's provider; the Documents view portals its
 * count and pager into this element, so they read the tab's context as they
 * always did and leave with the view. One window, one status bar: a module
 * value is enough.
 */
let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

export function setStatusBarSlot(el: HTMLElement | null): void {
  if (slot === el) return;
  slot = el;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStatusBarSlot(): HTMLElement | null {
  return useSyncExternalStore(subscribe, () => slot);
}
