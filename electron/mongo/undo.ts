import type { Document } from 'mongodb';
import { SystemError } from '../errors.ts';

/**
 * What a single-document write kept so it can be undone: the Pre-image, and
 * for an update the document the write left behind, which Undo compares
 * against before putting the Pre-image back.
 */
export interface UndoCapture {
  preImage: Document;
  postImage?: Document;
}

/**
 * Read options that keep every BSON value as its own type — a Double stays a
 * Double rather than coming back as a JS number that re-inserts as an Int32, a
 * Long stays a Long, a regex keeps flags a JS RegExp can't hold — so a
 * restored Pre-image is the document that was read, not an approximation.
 */
export const EXACT_BSON = { promoteValues: false, bsonRegExp: true } as const;

// Keyed by the result object a service returns, which is the same object the
// router hands the audit sink as the envelope's data. The Pre-image rides next
// to the result instead of inside it, so it can never cross IPC.
const captures = new WeakMap<object, UndoCapture>();

export function attachUndo<T extends object>(result: T, capture: UndoCapture): T {
  captures.set(result, capture);
  return result;
}

// `WeakMap#get` answers undefined for a primitive rather than throwing.
export function undoCaptureOf(result: unknown): UndoCapture | undefined {
  return captures.get(result as object);
}

/**
 * Refuses an Undo before anything is written (X13 §6). `reversible` records
 * whether a Pre-image was ever captured and never changes afterwards; the
 * sweep only nulls `undo_json`, which is how an expired entry stays
 * distinguishable from one that was never reversible.
 */
export function assertUndoable(row: {
  reversible: number;
  undone_at: string | null;
  undo_json: string | null;
}): asserts row is { reversible: number; undone_at: null; undo_json: string } {
  if (row.reversible !== 1) {
    throw new SystemError('AUDIT_NOT_REVERSIBLE', 'Nothing was kept that could undo this change.');
  }
  if (row.undone_at !== null) {
    throw new SystemError('AUDIT_ALREADY_UNDONE', 'This change has already been undone.');
  }
  if (row.undo_json === null) {
    throw new SystemError('AUDIT_UNDO_EXPIRED', 'This change is too old to undo.');
  }
}
