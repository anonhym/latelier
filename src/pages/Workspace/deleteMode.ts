// Resolves which of the three mutually-exclusive delete dialogs should be open, and what docs/filter to hand DeleteConfirm.
import { buildDeleteSelectedFilterJson } from './selection';

/** How the documents to delete were chosen: one row, a selection, or the tab's filter. */
export type DeleteSource = 'document' | 'selection' | 'filter';

export type DeleteDialogState =
  | { open: false }
  | { open: true; docs: unknown[]; filter: string | undefined; source: DeleteSource };

/**
 * W08 §10 / ADR 0013's amendment: the confirmation is sized to what it deletes.
 * `plain` asks nothing; `typed` wants the collection name; `typed-all` wants it
 * under a red band, because no filter means every document.
 */
export type DeleteTier = 'plain' | 'typed' | 'typed-all';

/** A selection this small is checked by eye, so its dialog lists the ids and asks nothing more. */
export const PLAIN_SELECTION_MAX = 20;

export function deleteTier(input: {
  source: 'selection' | 'filter';
  count: number;
  filterJson: string;
}): DeleteTier {
  if (input.source === 'selection') return input.count <= PLAIN_SELECTION_MAX ? 'plain' : 'typed';
  // `{}` however it is spaced, or nothing at all, matches every document.
  const bare = input.filterJson.replace(/\s/g, '');
  return bare === '' || bare === '{}' ? 'typed-all' : 'typed';
}

// deleteAllOpen is folded into deleteAllFilterJson by the caller rather than passed separately, to avoid a Stryker-equivalent null-check collapse.
export function resolveDeleteDialog(input: {
  deleteDoc: unknown | null;
  deleteSelected: unknown[] | null;
  deleteAllFilterJson: string | null;
}): DeleteDialogState {
  const { deleteDoc, deleteSelected, deleteAllFilterJson } = input;

  // Must stay inactive (not fall through to '{}') when no selected doc has an _id, else it'd delete the whole collection.
  const deleteSelectedFilterJson = deleteSelected
    ? buildDeleteSelectedFilterJson(deleteSelected)
    : null;
  // Stryker disable next-line ConditionalExpression: deleteSelectedFilterJson can only be non-null when the ternary above saw deleteSelected truthy (arrays are always truthy, so the only falsy value of this `unknown[] | null` type is null itself) — deleteSelectedFilterJson !== null already implies deleteSelected !== null, so the left conjunct is redundant by construction of the ternary two lines up.
  const deleteSelectedActive = deleteSelected !== null && deleteSelectedFilterJson !== null;

  // Same hazard: null filter must not fall through to '{}' (delete-the-whole-collection).
  const deleteAllActive = deleteAllFilterJson !== null;

  if (!(deleteDoc !== null || deleteAllActive || deleteSelectedActive)) {
    return { open: false };
  }

  // docs prefers deleteDoc, filter prefers deleteSelected; the two are never simultaneously active (same modal overlay blocks both triggers).
  return {
    open: true,
    docs: deleteDoc !== null ? [deleteDoc] : deleteSelectedActive ? deleteSelected! : [],
    // Follows `filter`: what decides the dialog is what the delete runs by.
    source: deleteSelectedActive ? 'selection' : deleteAllActive ? 'filter' : 'document',
    filter: deleteSelectedActive
      ? deleteSelectedFilterJson!
      : deleteAllActive
        ? deleteAllFilterJson!
        : undefined,
  };
}
