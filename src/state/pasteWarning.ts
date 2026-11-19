import { useSyncExternalStore } from 'react';
import type { CopySource } from '../utils/copyOrigin';

/** Mirrors the `warnings.crossConnectionPaste` entry in `electron/ipc/prefKeys.ts`; unset means on. */
export const CROSS_PASTE_PREF_KEY = 'warnings.crossConnectionPaste';

/**
 * The Cross-Connection Paste warning each tab is showing. A module-level
 * store rather than workspace-tab state: it is never persisted, a Run settles
 * it from the runner, and `useWorkspaceTabs` is not a context the surfaces
 * could read it from.
 *
 * One warning per tab: a second Cross-Connection Paste replaces the first.
 */
export interface PasteWarning {
  /** Which query surface received the paste; a host shows only its own. */
  surface: string;
  /** Where the pasted value was copied from. */
  from: CopySource;
  /** The next Run returned no documents: the warning is stronger and stays. */
  emphasised: boolean;
}

const warnings = new Map<string, PasteWarning>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The tab pasted a value copied from `from` into `surface`. */
export function showPasteWarning(tabId: string, surface: string, from: CopySource): void {
  warnings.set(tabId, { surface, from, emphasised: false });
  emit();
}

/** Dismiss, or the tab closed. */
export function dismissPasteWarning(tabId: string): void {
  if (warnings.delete(tabId)) emit();
}

/**
 * A Run for `tabId` finished with `documentCount` documents. It clears the
 * warning, unless the Run came back empty: then the warning turns emphatic
 * and stays until it is dismissed.
 */
export function settlePasteWarning(tabId: string, documentCount: number): void {
  const current = warnings.get(tabId);
  if (!current || current.emphasised) return;
  if (documentCount > 0) {
    warnings.delete(tabId);
  } else {
    warnings.set(tabId, { ...current, emphasised: true });
  }
  emit();
}

export function getPasteWarning(tabId: string): PasteWarning | undefined {
  return warnings.get(tabId);
}

/** The warning `tabId` is showing, if any. */
export function usePasteWarning(tabId: string): PasteWarning | undefined {
  return useSyncExternalStore(subscribe, () => warnings.get(tabId));
}

/** Test hook: forget every warning. */
export function resetPasteWarnings(): void {
  warnings.clear();
  emit();
}
