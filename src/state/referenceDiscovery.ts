import { useSyncExternalStore } from 'react';
import type { FieldRef, RulePair } from '../utils/referenceDiscovery';

/** Mirrors the `refs.discovery.never` entry in `electron/ipc/prefKeys.ts`. */
export const DISCOVERY_NEVER_PREF_KEY = 'refs.discovery.never';

/**
 * A paste of a copied value waiting for the tab's next Run. Renderer memory
 * only: it holds the copied values, which are dropped with it.
 */
export interface PendingDiscovery {
  /** The Copy Origin's field, in its own Collection. */
  origin: FieldRef;
  /** Which copy it was, so Not now can mean this copy only. */
  seq: number;
  /** The copied values the paste carried. */
  values: string[];
}

/** What the strip offers. It holds names only, never a copied value. */
export interface ReferenceSuggestion {
  pair: RulePair;
  /** `pairKey` of `pair`. */
  key: string;
  /** The copy it came from: Not now declines the pair for this copy only. */
  seq: number;
  /** The Connection the rule would be created on. */
  connectionId: string;
  /** The Connection's Family, resolved when the suggestion was made; null when it has none. */
  family: { id: string; name: string } | null;
}

const pending = new Map<string, PendingDiscovery>();
const suggestions = new Map<string, ReferenceSuggestion>();
// Not now: pair keys declined for one copy. Forgotten as soon as another copy is the subject.
let declinedSeq = -1;
const declinedKeys = new Set<string>();
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

/** The tab pasted a copied value; the next Run looks for it. A later paste replaces this one. */
export function armDiscovery(tabId: string, discovery: PendingDiscovery): void {
  pending.set(tabId, discovery);
}

/** Take the tab's pending discovery: it is gone once taken, whatever the Run finds. */
export function takePendingDiscovery(tabId: string): PendingDiscovery | undefined {
  const found = pending.get(tabId);
  pending.delete(tabId);
  return found;
}

/** Offer `suggestion` on the tab, replacing any other. */
export function showSuggestion(tabId: string, suggestion: ReferenceSuggestion): void {
  suggestions.set(tabId, suggestion);
  emit();
}

/** The strip goes: Save, Not now, Never, or the tab closed. */
export function clearSuggestion(tabId: string): void {
  if (suggestions.delete(tabId)) emit();
}

/** Not now: `key` is not offered again for the copy `seq`. */
export function declineForCopy(seq: number, key: string): void {
  if (seq !== declinedSeq) {
    declinedKeys.clear();
    declinedSeq = seq;
  }
  declinedKeys.add(key);
}

export function isDeclinedForCopy(seq: number, key: string): boolean {
  return seq === declinedSeq && declinedKeys.has(key);
}

export function getReferenceSuggestion(tabId: string): ReferenceSuggestion | undefined {
  return suggestions.get(tabId);
}

/** The suggestion `tabId` is showing, if any. */
export function useReferenceSuggestion(tabId: string): ReferenceSuggestion | undefined {
  return useSyncExternalStore(subscribe, () => suggestions.get(tabId));
}

/** Test hook: forget everything. */
export function resetReferenceDiscovery(): void {
  pending.clear();
  suggestions.clear();
  declinedKeys.clear();
  declinedSeq = -1;
  emit();
}
