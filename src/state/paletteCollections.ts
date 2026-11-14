import { useSyncExternalStore } from 'react';

/**
 * What the empty palette needs to list "Collections in this connection" and to
 * say `Loading collections…` (X07 §14.2, §14.5). Workspace owns the sweep that
 * lists them, but `PaletteContextProvider` sits above it, so this is the
 * narrow bridge between the two, like `focusedConnection.ts`.
 */
export interface PaletteCollectionsState {
  /** The Connection being swept; null when none is open. */
  connectionId: string | null;
  /** Its collections are still being listed. */
  pending: boolean;
}

const NONE: PaletteCollectionsState = { connectionId: null, pending: false };
let state: PaletteCollectionsState = NONE;
const listeners = new Set<() => void>();

export function publishPaletteCollections(next: PaletteCollectionsState): void {
  if (next.connectionId === state.connectionId && next.pending === state.pending) return;
  state = next;
  listeners.forEach((listener) => listener());
}

export function usePaletteCollections(): PaletteCollectionsState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

/** Test-only: back to nothing open. */
export function _resetPaletteCollectionsForTests(): void {
  state = NONE;
  listeners.forEach((listener) => listener());
}
