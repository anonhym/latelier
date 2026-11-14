import { useSyncExternalStore } from 'react';
import { api, isIpcError } from '../../api/atelier';
import { notify } from '../../theme/notifications';
import { undoFailureMessage, undoneMessage } from '../../utils/auditUndo';

/** The collection a write landed in. */
export interface UndoTarget {
  connectionId: string;
  dbName: string;
  collection: string;
}

export interface UndoEntry {
  auditId: string;
  /** What the undo reverses, as the menu names it: `Undo: document updated`. */
  label: string;
  /** Re-runs whatever showed the write, once it is undone. */
  onUndone: () => void;
}

/**
 * The newest undo the renderer holds per collection (X13 §13), for ⌘Z on the
 * results and the canvas header's `Undo last change`. Session memory only:
 * the main process keeps the Pre-images, and says when one is gone by
 * refusing the undo, which also drops it here. A restart empties both.
 */
const newest = new Map<string, UndoEntry>();
const listeners = new Set<() => void>();
const keyOf = (t: UndoTarget) => `${t.connectionId}\u0000${t.dbName}\u0000${t.collection}`;

function emit() {
  for (const l of listeners) l();
}

export function undoLabel(message: string): string {
  return `Undo: ${message.charAt(0).toLowerCase()}${message.slice(1)}`;
}

export function recordUndo(target: UndoTarget, entry: UndoEntry): void {
  newest.set(keyOf(target), entry);
  emit();
}

export function latestUndo(target: UndoTarget): UndoEntry | undefined {
  return newest.get(keyOf(target));
}

/**
 * A write on `target` that recorded nothing to undo: its newest entry is no
 * longer the last change, so ⌘Z must not reach past the write to it.
 */
export function forgetUndo(target: UndoTarget): void {
  if (newest.delete(keyOf(target))) emit();
}

/**
 * A write somewhere on `connectionId` that the renderer can't place (a
 * script, a `$out`/`$merge`): every collection's newest undo there goes.
 */
export function forgetUndoOn(connectionId: string): void {
  const prefix = `${connectionId}\u0000`;
  let dropped = false;
  for (const key of newest.keys()) {
    if (key.startsWith(prefix)) dropped = newest.delete(key) || dropped;
  }
  if (dropped) emit();
}

let rerunTabsOn: (target: UndoTarget) => void = () => {};

/**
 * The Workspace registers how to re-run every open tab on a collection, for
 * an undo raised where no tab list is at hand: an import's toast outlives its
 * dialog. Returns the unregister.
 */
export function registerCollectionRerun(rerun: (target: UndoTarget) => void): () => void {
  rerunTabsOn = rerun;
  return () => {
    if (rerunTabsOn === rerun) rerunTabsOn = () => {};
  };
}

export function rerunCollection(target: UndoTarget): void {
  rerunTabsOn(target);
}

/** Drops `auditId` wherever it is still the newest entry: it has run, or it was refused. */
function forget(auditId: string) {
  for (const [key, entry] of newest) {
    if (entry.auditId === auditId) newest.delete(key);
  }
  emit();
}

/** X13's refusals, which hold however often the undo is retried. */
const FINAL_REFUSALS = new Set(['AUDIT_TARGET_CHANGED', 'AUDIT_ALREADY_UNDONE', 'AUDIT_UNDO_EXPIRED', 'AUDIT_NOT_REVERSIBLE', 'CONFLICT']);

/**
 * Runs one undo the way the toast's button does. An entry that ran is
 * forgotten, since it cannot run twice, and so is one X13 refused, since it
 * never will. Any other failure (a dropped Connection, a server error) says
 * nothing about the change, so the entry stays for another try.
 */
export function runUndo(entry: UndoEntry): Promise<void> {
  return api.audit.undo({ entryId: entry.auditId }).then(
    (r) => {
      forget(entry.auditId);
      notify.success(undoneMessage(r));
      entry.onUndone();
    },
    (e: unknown) => {
      if (isIpcError(e) && FINAL_REFUSALS.has(e.code)) forget(entry.auditId);
      notify.error(undoFailureMessage(e), { title: 'Undo failed' });
    },
  );
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLatestUndo(target: UndoTarget): UndoEntry | undefined {
  const key = keyOf(target);
  return useSyncExternalStore(subscribe, () => newest.get(key));
}

/** Test seam: the store is module state. */
export function clearUndoStore(): void {
  newest.clear();
  emit();
}
