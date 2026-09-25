import type { UndoResult } from '@shared/types';
import { getErrorMessage, isIpcError } from '../api/atelier';

/**
 * Why an Undo was refused, in words the user can act on. The refusal codes
 * are X13's; each names what happened rather than the code, and a changed
 * target says plainly when there is nothing to unwind from here.
 */
export function undoFailureMessage(e: unknown): string {
  switch (isIpcError(e) ? e.code : null) {
    case 'AUDIT_TARGET_CHANGED':
      return "The document has changed since, so undoing would overwrite the newer change. Undo that change first if it was made here; a change made outside L'Atelier can't be unwound from here.";
    case 'AUDIT_ALREADY_UNDONE':
      return 'This change has already been undone.';
    case 'AUDIT_UNDO_EXPIRED':
      return 'This change is too old to undo — its earlier version is no longer kept.';
    case 'AUDIT_NOT_REVERSIBLE':
      return "This change can't be undone — its earlier version was never kept.";
    case 'CONFLICT':
      return "A document with the same _id exists again, so the deleted one can't be put back.";
    default:
      return getErrorMessage(e, 'Undo failed');
  }
}

export function undoneMessage(r: UndoResult): string {
  return `Restored ${r.restored} document${r.restored === 1 ? '' : 's'}`;
}
