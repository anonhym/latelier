import { describe, it, expect } from 'vitest';
import { ejsonParse } from '../../src/utils/ejson';
import { resolveDeleteDialog } from '../../src/pages/Workspace/deleteMode';

// Fixtures use `ejsonParse` (the same revival path `api.query.find`'s result
// goes through at the renderer edge) so `_id` is a real revived ObjectId
// instance, matching what `documents`/`deleteSelected` contain at runtime —
// house style per `tests/unit/selection.spec.ts`.
function docWithId(hex: string) {
  return ejsonParse<{ _id: unknown }>(`{"_id":{"$oid":"${hex}"}}`);
}

const DELETE_ALL_FILTER = '{"status":"pending"}';

describe('resolveDeleteDialog', () => {
  it('returns closed when nothing is set', () => {
    expect(
      resolveDeleteDialog({ deleteDoc: null, deleteSelected: null, deleteAllFilterJson: null }),
    ).toEqual({ open: false });
  });

  it('deleteDoc alone opens with that doc and no filter', () => {
    const doc = docWithId('507f1f77bcf86cd799439011');
    expect(
      resolveDeleteDialog({ deleteDoc: doc, deleteSelected: null, deleteAllFilterJson: null }),
    ).toEqual({ open: true, docs: [doc], filter: undefined });
  });

  it('a valid deleteAllFilterJson opens with an empty docs array and that filter', () => {
    expect(
      resolveDeleteDialog({
        deleteDoc: null,
        deleteSelected: null,
        deleteAllFilterJson: DELETE_ALL_FILTER,
      }),
    ).toEqual({ open: true, docs: [], filter: DELETE_ALL_FILTER });
  });

  // Fail-open guard — a null deleteAllFilterJson with nothing else set must stay closed.
  it('stays closed when deleteAllFilterJson is null and nothing else is set', () => {
    expect(
      resolveDeleteDialog({ deleteDoc: null, deleteSelected: null, deleteAllFilterJson: null }),
    ).toEqual({ open: false });
  });

  it('deleteSelected with docs carrying _id opens with the selected docs and the $in filter', () => {
    const docs = [docWithId('507f1f77bcf86cd799439011'), docWithId('507f1f77bcf86cd799439012')];
    const result = resolveDeleteDialog({
      deleteDoc: null,
      deleteSelected: docs,
      deleteAllFilterJson: null,
    });
    expect(result.open).toBe(true);
    if (!result.open) throw new Error('unreachable');
    expect(result.docs).toBe(docs);
    expect(JSON.parse(result.filter!)).toEqual({
      _id: {
        $in: [
          { $oid: '507f1f77bcf86cd799439011' },
          { $oid: '507f1f77bcf86cd799439012' },
        ],
      },
    });
  });

  // T0.4 — buildDeleteSelectedFilterJson returning null (no doc carries an
  // _id) is already pinned independently in selection.spec.ts:76,80; this
  // proves the resolver honours that null rather than re-deriving it.
  it('stays closed when none of the selected docs carry an _id (T0.4)', () => {
    expect(
      resolveDeleteDialog({
        deleteDoc: null,
        deleteSelected: [{ name: 'x' }, { name: 'y' }],
        deleteAllFilterJson: null,
      }),
    ).toEqual({ open: false });
  });

  it('stays closed for an empty deleteSelected array', () => {
    expect(
      resolveDeleteDialog({ deleteDoc: null, deleteSelected: [], deleteAllFilterJson: null }),
    ).toEqual({ open: false });
  });

  it('documents the pre-existing interleave: docs prefers deleteDoc while filter prefers deleteSelected (preserved verbatim in R1)', () => {
    const deleteDoc = docWithId('507f1f77bcf86cd799439099');
    const selected = [docWithId('507f1f77bcf86cd799439011')];
    const result = resolveDeleteDialog({
      deleteDoc,
      deleteSelected: selected,
      deleteAllFilterJson: null,
    });
    expect(result.open).toBe(true);
    if (!result.open) throw new Error('unreachable');
    expect(result.docs).toEqual([deleteDoc]);
    expect(JSON.parse(result.filter!)).toEqual({
      _id: { $in: [{ $oid: '507f1f77bcf86cd799439011' }] },
    });
  });

  it('deleteDoc set with deleteAllFilterJson set prefers deleteDoc for docs and the delete-all filter', () => {
    const deleteDoc = docWithId('507f1f77bcf86cd799439099');
    const result = resolveDeleteDialog({
      deleteDoc,
      deleteSelected: null,
      deleteAllFilterJson: DELETE_ALL_FILTER,
    });
    expect(result).toEqual({ open: true, docs: [deleteDoc], filter: DELETE_ALL_FILTER });
  });
});
