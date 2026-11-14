import { notify } from '../../theme/notifications';
import { forgetUndo, recordUndo, runUndo, undoLabel, type UndoEntry, type UndoTarget } from './undoStore';

/**
 * Success toast for a write that was recorded Reversible, carrying an Undo
 * that puts it back. `onUndone` runs after a successful Undo — re-run the tab
 * the write came from, captured now, since the toast outlives whatever
 * dialog made the write. No `auditId` means nothing can be undone, and no
 * toast is shown.
 *
 * With `target`, the undo also outlives the toast: it becomes that
 * collection's newest, for ⌘Z on the results and `Undo last change` (X13 §13).
 * A write with no `auditId` still drops the older one, which it superseded.
 */
export function offerUndo(
  message: string,
  auditId: string | undefined,
  onUndone: () => void,
  target?: UndoTarget,
): void {
  if (auditId === undefined) {
    if (target) forgetUndo(target);
    return;
  }
  const entry: UndoEntry = { auditId, label: undoLabel(message), onUndone };
  if (target) recordUndo(target, entry);
  notify.success(message, {
    action: {
      label: 'Undo',
      onClick: () => void runUndo(entry),
    },
  });
}
