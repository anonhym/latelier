import { useSyncExternalStore } from 'react';

/**
 * How long each tab's find has been running, and for a few seconds after a
 * cancel, how long it ran (W05 §9.5). A store rather than component state: the
 * runner knows when a run starts, settles or is cancelled, and both the status
 * bar and the band above the rows have to say the same figure.
 */
export type RunClock = { kind: 'running' | 'cancelled'; elapsedMs: number };

/** How long "Cancelled after …" stays up. */
export const CANCELLED_NOTICE_MS = 4000;

const clocks = new Map<string, RunClock>();
const startedAt = new Map<string, number>();
const stops = new Map<string, () => void>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function stopTimer(tabId: string): void {
  stops.get(tabId)?.();
  stops.delete(tabId);
}

/** A find started for `tabId`; a newer one restarts the count. */
export function startRunClock(tabId: string): void {
  stopTimer(tabId);
  const start = Date.now();
  startedAt.set(tabId, start);
  clocks.set(tabId, { kind: 'running', elapsedMs: 0 });
  const timer = setInterval(() => {
    clocks.set(tabId, { kind: 'running', elapsedMs: Date.now() - start });
    emit();
  }, 1000);
  stops.set(tabId, () => clearInterval(timer));
  emit();
}

/** The find for `tabId` answered or failed. A cancelled one keeps its notice. */
export function settleRunClock(tabId: string): void {
  if (clocks.get(tabId)?.kind !== 'running') return;
  stopTimer(tabId);
  clocks.delete(tabId);
  emit();
}

/** The find for `tabId` was cancelled: hold how long it ran, briefly. */
export function cancelRunClock(tabId: string): void {
  if (clocks.get(tabId)?.kind !== 'running') return;
  stopTimer(tabId);
  // A running clock always has its start recorded.
  clocks.set(tabId, { kind: 'cancelled', elapsedMs: Date.now() - startedAt.get(tabId)! });
  const timer = setTimeout(() => {
    clocks.delete(tabId);
    emit();
  }, CANCELLED_NOTICE_MS);
  stops.set(tabId, () => clearTimeout(timer));
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** `tabId`'s clock, or null when no find is running and none was just cancelled. */
export function useRunClock(tabId: string): RunClock | null {
  return useSyncExternalStore(subscribe, () => clocks.get(tabId) ?? null);
}

/** Test-only. */
// Stryker disable all: the spec's own teardown; nothing in the app calls it.
export function _resetRunClocksForTests(): void {
  for (const tabId of [...stops.keys()]) stopTimer(tabId);
  clocks.clear();
  startedAt.clear();
}
// Stryker restore all
