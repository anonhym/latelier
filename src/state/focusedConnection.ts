import { useSyncExternalStore } from 'react';

/**
 * the Connection the Data View is on lives as local derived state
 * inside `Workspace.tsx`, but `PaletteContextProvider` is mounted at the App
 * level, above `<Routes>`, so it cannot read it directly. This is the
 * narrowest bridge between the two: Workspace publishes here on every change,
 * and anything outside the Workspace tree can subscribe.
 *
 * X16.1 — the value published is the **Focused Tab**'s Connection (see
 * CONTEXT.md): the tab you are looking at is what "where am I" means, so a
 * Connection-scoped command acts on the server that tab is talking to. With no
 * tab open there is no Focused Tab and this is `null`.
 *
 * X16.4 — renamed from `activeConnection.ts`. The value it publishes
 * did not change; the name did, because CONTEXT.md retires *active
 * connection* and there is no longer a single one to name.
 *
 * Deliberately not a general-purpose store — one value, one publisher.
 */
let focusedConnectionId: string | null = null;
const listeners = new Set<() => void>();

export function setFocusedConnectionId(id: string | null): void {
  if (id === focusedConnectionId) return;
  focusedConnectionId = id;
  listeners.forEach((listener) => listener());
}

function getFocusedConnectionId(): string | null {
  return focusedConnectionId;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFocusedConnectionId(): string | null {
  return useSyncExternalStore(subscribe, getFocusedConnectionId);
}
