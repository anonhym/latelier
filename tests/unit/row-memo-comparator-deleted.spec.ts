import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * X19 #82 — `TableView`'s `TableRow` and `TreeView`'s `DocRow` used to be
 * `React.memo(...Impl, comparator)` wrappers with careful index/docId-keyed
 * comparator bodies (selection, copy-flash, expansion, #60 active row).
 * Measured and confirmed dead: react-window hands every rebuilt row a fresh
 * inline `style` object, so the comparator's mandatory
 * `prev.style !== next.style` guard returned `false` for every mounted row,
 * every time, and nothing below it ever ran. A follow-up e2e latency
 * measurement (throwaway probe, deleted after use — see the comments at
 * each site below for the full method and numbers) found the resulting
 * always-re-render cost negligible for TreeView and borderline-but-under
 * for TableView, so both were deleted rather than repaired. See the
 * comments above `TableRowImpl`'s `rowComponent` wiring in `TableView.tsx`
 * and above `DocRowImpl`'s in `TreeView.tsx` for the full writeup.
 *
 * This is the "comparator is gone" half of #82's acceptance criteria — a
 * source-text check because a component test can't observe the *absence*
 * of a memo wrapper any other way (both a memoized and unmemoized row
 * re-render on every arrow key here, since the guard was never doing
 * anything to begin with). The current repaint behaviour for selection,
 * copy-flash, expansion, and #60's active-row outline is covered
 * separately, by the existing specs in `table-view.spec.tsx` and
 * `tree-view.spec.tsx`.
 */
const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('#82 — TableRow/DocRow have no React.memo comparator', () => {
  it('TableView passes the plain TableRowImpl as rowComponent, not a memo wrapper', () => {
    const src = read('src/pages/Workspace/views/TableView.tsx');
    // Matches the old `const TableRow = React.memo(TableRowImpl, ...)`
    // declaration specifically (not this file's own explanatory comment,
    // which mentions the same call by name in backticks).
    expect(src).not.toMatch(/\bTableRow\s*=\s*React\.memo\(TableRowImpl/);
    expect(src).toMatch(/rowComponent=\{TableRowImpl\}/);
  });

  it('TreeView passes the plain DocRowImpl as rowComponent, not a memo wrapper', () => {
    const src = read('src/pages/Workspace/views/TreeView.tsx');
    expect(src).not.toMatch(/\bDocRow\s*=\s*React\.memo\(DocRowImpl/);
    expect(src).toMatch(/rowComponent=\{DocRowImpl\}/);
  });
});
