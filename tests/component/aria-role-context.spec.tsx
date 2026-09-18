import { describe, it, expect, vi } from 'vitest';
import { render, within, emptyWorkspaceActions, emptyWorkspaceMeta } from '../helpers/render';
import { TableView } from '../../src/pages/Workspace/views/TableView';
import { TreeView } from '../../src/pages/Workspace/views/TreeView';
import { JsonView } from '../../src/pages/Workspace/views/JsonView';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import type { CollectionTabState } from '@shared/types';

/**
 * Two ARIA rules that a lint-driven accessibility pass gets wrong in opposite
 * directions, both found by review on #13's PR after the lint findings were
 * already green:
 *
 * 1. **Required context.** `treeitem` needs a `tree` ancestor and `option`
 *    needs a `listbox`. react-window labels its own container `role="list"`,
 *    so adding a role to the rows alone left every one of them orphaned —
 *    axe's `aria-required-parent`. Silencing S6848 that way swapped one
 *    accessibility defect for another.
 *
 * 2. **Children presentational.** `button`, `option`, `checkbox`, `switch` and
 *    friends may not contain other interactive controls at any depth; the
 *    subtree is flattened for assistive tech (axe's `nested-interactive`).
 *    Every row here holds real buttons, so those roles are simply unavailable
 *    — which is why the table is a `grid` of `row`/`gridcell`, roles that are
 *    *not* children presentational.
 *
 * Neither rule is checked by the linter that motivated the original change, so
 * they are pinned here instead.
 */

function state(view: CollectionTabState['view']): CollectionTabState {
  return {
    view,
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
  };
}

const DOCS = [
  { _id: 'a1', name: 'alpha', nested: { deep: 'v' } },
  { _id: 'b2', name: 'beta', nested: { deep: 'w' } },
];

function wrap(view: CollectionTabState['view'], node: React.ReactNode) {
  return render(
    <CollectionWorkspaceProvider state={state(view)} actions={emptyWorkspaceActions()} meta={emptyWorkspaceMeta()}>
      {node}
    </CollectionWorkspaceProvider>,
  );
}

/**
 * Nearest ancestor carrying an explicit role — generic elements are
 * transparent. Falls back to `aria-owns` (#53): a sticky/virtualized header
 * row can be a DOM *sibling* of its grid rather than a descendant, and
 * `aria-owns` is ARIA's own mechanism for declaring that logical parentage
 * without moving anything in the DOM — a plain ancestor walk alone can't see
 * it, so this checks for an `aria-owns` reference before giving up.
 */
function nearestRoleAncestor(el: Element): string | null {
  let cur = el.parentElement;
  while (cur) {
    const role = cur.getAttribute('role');
    if (role) return role;
    cur = cur.parentElement;
  }
  if (el.id) {
    const owner = el.ownerDocument.querySelector(`[aria-owns~="${el.id}"]`);
    if (owner) return owner.getAttribute('role');
  }
  return null;
}

describe('required role context', () => {
  it('every TableView row sits in a grid, and holds only cells', () => {
    const { container } = wrap(
      'Table',
      <TableView documents={DOCS} onColumnResize={vi.fn()} onRowExpand={vi.fn()} />,
    );
    const rows = container.querySelectorAll('[role="row"]');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(nearestRoleAncestor(row)).toBe('grid');
      // A row owns cells, not arbitrary content — the header row's are
      // `columnheader` (#53), every other row's are `gridcell`.
      expect(
        row.querySelectorAll('[role="gridcell"], [role="columnheader"]').length,
      ).toBeGreaterThan(0);
    }
  });

  it('every TreeView document row sits in a tree', () => {
    const { container } = wrap(
      'Tree',
      <TreeView documents={DOCS} expandedRows={{}} onSelect={vi.fn()} onRowExpand={vi.fn()} />,
    );
    const items = container.querySelectorAll('[role="treeitem"]');
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(nearestRoleAncestor(item)).toBe('tree');
  });
});

describe('no interactive role contains another interactive control', () => {
  // The roles ARIA flattens. An element with one of these must hold no button,
  // link or other control, however deeply nested.
  const CHILDREN_PRESENTATIONAL = [
    'button',
    'option',
    'checkbox',
    'radio',
    'switch',
    'tab',
    'slider',
    'separator',
    'progressbar',
  ];

  function assertNoNestedControls(container: HTMLElement) {
    const selector = CHILDREN_PRESENTATIONAL.map((r) => `[role="${r}"]`).join(',');
    const offenders: string[] = [];
    for (const el of [...container.querySelectorAll(selector), ...container.querySelectorAll('button')]) {
      const role = el.getAttribute('role') ?? 'button';
      if (el.tagName === 'BUTTON' && !CHILDREN_PRESENTATIONAL.includes(role)) continue;
      const nested = within(el as HTMLElement).queryAllByRole('button');
      if (nested.length > 0) {
        offenders.push(`${el.tagName.toLowerCase()}[role=${role}] holds ${nested.length} control(s)`);
      }
    }
    expect(offenders).toEqual([]);
  }

  it('holds for the Table view', () => {
    const { container } = wrap(
      'Table',
      <TableView documents={DOCS} onColumnResize={vi.fn()} onRowExpand={vi.fn()} />,
    );
    assertNoNestedControls(container);
  });

  it('holds for the Tree view', () => {
    const { container } = wrap(
      'Tree',
      <TreeView documents={DOCS} expandedRows={{ a1: true }} onSelect={vi.fn()} onRowExpand={vi.fn()} />,
    );
    assertNoNestedControls(container);
  });

  it('holds for the JSON view', () => {
    const { container } = wrap('JSON', <JsonView documents={DOCS} />);
    assertNoNestedControls(container);
  });
});
