import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ObjectId } from 'bson';
import { resolveDeleteDialog } from '../../src/pages/Workspace/deleteMode';
import { buildDeleteSelectedFilterJson } from '../../src/pages/Workspace/selection';

// Real ObjectId instances, not hand-built `{$oid: ...}` sentinels — matches
// what `documents`/`deleteSelected` actually hold at runtime (CLAUDE.md's
// "build inputs with real constructors" convention).
const docWithIdArb = fc.constant(null).map(() => ({ _id: new ObjectId() }));
const docWithoutIdArb = fc.record({ name: fc.string({ maxLength: 5 }) });
const docArb = fc.oneof(docWithIdArb, docWithoutIdArb);
const docsArrayArb = fc.array(docArb, { maxLength: 4 });

const deleteDocArb = fc.option(docArb, { nil: null });
const deleteSelectedArb = fc.option(docsArrayArb, { nil: null });
const deleteAllFilterJsonArb = fc.option(
  fc.constantFrom('{}', '{"status":"pending"}', '{"a":1}'),
  { nil: null },
);

// This repo's own deleteMode.spec.ts already pins, by example, that
// `deleteDoc`+`deleteSelected` set together is a documented, deliberately
// preserved quirk (docs prefers deleteDoc, filter prefers deleteSelected —
// see the `ponytail:` comment in deleteMode.ts). None of
// the properties below assert which side wins in that overlap; they check
// invariants that hold regardless of it.
describe('resolveDeleteDialog', () => {
  it('never throws for any combination of inputs', () => {
    fc.assert(
      fc.property(deleteDocArb, deleteSelectedArb, deleteAllFilterJsonArb, (deleteDoc, deleteSelected, deleteAllFilterJson) => {
        expect(() => resolveDeleteDialog({ deleteDoc, deleteSelected, deleteAllFilterJson })).not.toThrow();
      }),
      { numRuns: 40 },
    );
  });

  // Black-box contract (T0.4): the dialog is open exactly when there's
  // a trigger that can actually resolve to a filter — a bare `deleteSelected`
  // array with no `_id`s must NOT count. Uses the real
  // `buildDeleteSelectedFilterJson` rather than re-deriving its logic.
  it('is open exactly when deleteDoc is set, deleteAllFilterJson is set, or deleteSelected resolves to a filter', () => {
    fc.assert(
      fc.property(deleteDocArb, deleteSelectedArb, deleteAllFilterJsonArb, (deleteDoc, deleteSelected, deleteAllFilterJson) => {
        const selectedResolves = deleteSelected !== null && buildDeleteSelectedFilterJson(deleteSelected) !== null;
        const expectedOpen = deleteDoc !== null || deleteAllFilterJson !== null || selectedResolves;
        const result = resolveDeleteDialog({ deleteDoc, deleteSelected, deleteAllFilterJson });
        expect(result.open).toBe(expectedOpen);
      }),
      { numRuns: 40 },
    );
  });

  // The safety invariant behind the fail-open guard: the resolver never fabricates
  // an unfiltered `{}` delete-everything filter on its own — `'{}'` can only
  // reach the output because the caller explicitly passed it as
  // `deleteAllFilterJson`.
  it('never opens with filter "{}" unless deleteAllFilterJson itself was "{}"', () => {
    fc.assert(
      fc.property(deleteDocArb, deleteSelectedArb, deleteAllFilterJsonArb, (deleteDoc, deleteSelected, deleteAllFilterJson) => {
        const result = resolveDeleteDialog({ deleteDoc, deleteSelected, deleteAllFilterJson });
        if (result.open && result.filter === '{}') {
          expect(deleteAllFilterJson).toBe('{}');
        }
      }),
      { numRuns: 40 },
    );
  });

  // Every doc handed to the caller is one of the actual inputs — the
  // resolver never invents a document to delete.
  it('every doc in the resolved docs array comes from the actual inputs', () => {
    fc.assert(
      fc.property(deleteDocArb, deleteSelectedArb, deleteAllFilterJsonArb, (deleteDoc, deleteSelected, deleteAllFilterJson) => {
        const result = resolveDeleteDialog({ deleteDoc, deleteSelected, deleteAllFilterJson });
        if (!result.open) return;
        for (const d of result.docs) {
          const fromDeleteDoc = d === deleteDoc;
          const fromSelected = deleteSelected !== null && (deleteSelected as unknown[]).includes(d);
          expect(fromDeleteDoc || fromSelected).toBe(true);
        }
      }),
      { numRuns: 40 },
    );
  });
});
