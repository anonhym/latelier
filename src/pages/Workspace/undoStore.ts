import { useSyncExternalStore } from 'react';
import { api } from '../../api/atelier';
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

/** Drops `auditId` wherever it is still the newest entry: it has run, or it was refused. */
function forget(auditId: string) {
  for (const [key, entry] of newest) {
    if (entry.auditId === auditId) newest.delete(key);
  }
  emit();
}

/**
 * Runs one undo the way the toast's button does, and forgets it either way:
 * an entry that ran cannot run twice, and a refused one never will.
 */
export function runUndo(entry: UndoEntry): Promise<void> {
  return api.audit.undo({ entryId: entry.auditId }).then(
    (r) => {
      forget(entry.auditId);
      notify.success(undoneMessage(r));
      entry.onUndone();
    },
    (e: unknown) => {
      forget(entry.auditId);
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
