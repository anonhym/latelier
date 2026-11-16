import React from 'react';
import { api } from '../api/atelier';
import { logFailure } from '../utils/rendererLog';

// Main restores the previous session's tabs (or clears them) before the first
// window loads, so the first tab list this renderer sees is the restore. Tabs
// opened later in the session never count: the list is read once and kept.
let launchTabCount: Promise<number> | null = null;
let consumed = false;
// Whether the restored-tabs hint is out of the way for good this launch: it
// has shown and closed, or it was decided it will not show. Launch-time layers
// that must not stack on it (What's new) wait for this rather than a timer.
let restoreHintSettled = false;
const settledListeners = new Set<() => void>();

export function readLaunchTabCount(): Promise<number> {
  launchTabCount ??= api.tabs.list().then(
    (list) => list.length,
    // Fail-open to "nothing restored": a missing hint beats a wrong one.
    (err) => {
      logFailure('listing the restored tabs', err);
      return 0;
    },
  ).then((n) => {
    // Nothing restored: the hint can never show.
    if (n === 0) settleRestoreHint();
    return n;
  });
  return launchTabCount;
}

/** True once the restore hint has shown, so a remounted Workspace does not repeat it. */
export function isLaunchRestoreConsumed(): boolean {
  return consumed;
}

export function consumeLaunchRestore(): void {
  consumed = true;
}

/** Marks the restored-tabs hint as out of the way for the rest of this launch. */
export function settleRestoreHint(): void {
  if (restoreHintSettled) return;
  restoreHintSettled = true;
  for (const listener of settledListeners) listener();
}

function subscribeSettled(listener: () => void): () => void {
  settledListeners.add(listener);
  return () => settledListeners.delete(listener);
}

/** True once the restored-tabs hint has shown and closed, or will not show this launch. */
export function useRestoreHintSettled(): boolean {
  return React.useSyncExternalStore(subscribeSettled, () => restoreHintSettled);
}

/** Test seam: forget the launch snapshot, as a fresh renderer would. */
export function resetLaunchRestore(): void {
  launchTabCount = null;
  consumed = false;
  restoreHintSettled = false;
}
