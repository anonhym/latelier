import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
  emptyWorkspaceActions,
  emptyWorkspaceMeta,
} from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { TreeView } from '../../src/pages/Workspace/views/TreeView';
import { TableView } from '../../src/pages/Workspace/views/TableView';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import type { CollectionWorkspaceActions } from '../../src/pages/Workspace/context';
import type { CollectionTabState } from '@shared/types';

const OID = '507f1f77bcf86cd799439011';
// Six levels: a > b > c > d > e > f.
const DEEP_DOC = { _id: { $oid: OID }, a: { b: { c: { d: { e: { f: 'bottom' } } } } }, top: 1 };

function state(): CollectionTabState {
  return {
    view: 'Tree',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
  };
}

/** Real `useState` for row expansion: a static prop cannot see what a click changes. */
function StatefulTree({ docs, actions }: { docs: unknown[]; actions?: Partial<CollectionWorkspaceActions> }) {
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  return (
    <CollectionWorkspaceProvider
      state={state()}
      actions={emptyWorkspaceActions(actions)}
      meta={emptyWorkspaceMeta()}
    >
      <TreeView
        documents={docs}
        expandedRows={expanded}
        onSelect={() => {}}
        onRowExpand={(id, open) => setExpanded((p) => ({ ...p, [id]: open }))}
      />
    </CollectionWorkspaceProvider>
  );
}

const fieldRow = (path: string) => document.getElementById(`field-row-${OID}::${path}`);

describe('the four result menus', () => {
  it('the document menu is a role=menu of menuitems that moves with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<StatefulTree docs={[DEEP_DOC]} />);

    fireEvent.click(screen.getByRole('button', { name: /More actions for document/ }));

    const menu = await screen.findByRole('menu');
    const labels = within(menu).getAllByRole('menuitem').map((i) => i.textContent);
    expect(labels).toEqual(['Copy document', 'Copy _id', 'Edit document', 'Expand all', 'Collapse all', 'Delete']);

    await user.keyboard('{ArrowDown}');
    const first = document.activeElement;
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).not.toBe(first);
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem');
  });

  it('a right-click on a collapsed Tree row opens that row\'s document menu', async () => {
    render(<StatefulTree docs={[DEEP_DOC]} />);

    fireEvent.contextMenu(screen.getByRole('treeitem'));

    expect(await screen.findByRole('menuitem', { name: 'Copy document' })).toBeTruthy();
  });

  it('Shift+F10 on the Tree opens the active row\'s document menu', async () => {
    render(<StatefulTree docs={[DEEP_DOC]} />);

    fireEvent.keyDown(screen.getByRole('tree', { name: 'Documents' }), { key: 'F10', shiftKey: true });

    expect(await screen.findByRole('menuitem', { name: 'Copy document' })).toBeTruthy();
  });

  it('a field menu is a role=menu too, with the field items', async () => {
    render(<StatefulTree docs={[DEEP_DOC]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand document' }));

    fireEvent.contextMenu(fieldRow('top')!);

    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Copy value',
      'Copy field path',
      'Add to filter',
    ]);
  });
});

function renderTable(docs: unknown[], actions: Partial<CollectionWorkspaceActions> = {}, onSortField?: (f: string) => void) {
  return render(
    <CollectionWorkspaceProvider
      state={state()}
      actions={emptyWorkspaceActions(actions)}
      meta={emptyWorkspaceMeta()}
    >
      <TableView documents={docs} onColumnResize={vi.fn()} onRowExpand={vi.fn()} onSortField={onSortField} />
    </CollectionWorkspaceProvider>,
  );
}

describe('the column header menu', () => {
  const DOCS = [{ _id: 1, name: 'alpha' }];

  it('right-click opens Copy field path, the two sorts, Hide column and Add to filter', async () => {
    renderTable(DOCS, {}, vi.fn());

    fireEvent.contextMenu(screen.getByTestId('table-header-name'));

    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Copy field path',
      'Sort ascending',
      'Sort descending',
      'Hide column',
      'Add to filter',
    ]);
  });

  it('Sort descending sorts by exactly that column and re-runs the query', async () => {
    const patch = vi.fn();
    const run = vi.fn();
    renderTable(DOCS, { patch, run }, vi.fn());

    fireEvent.contextMenu(screen.getByTestId('table-header-name'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sort descending' }));

    const expected = { builder: { projection: [], sort: '{"name":-1}', limit: '' } };
    expect(patch).toHaveBeenCalledWith(expected);
    expect(run).toHaveBeenCalledWith(expected);
  });

  it('Hide column adds the field to the tab\'s hidden columns, once', async () => {
    const patchWith = vi.fn();
    renderTable(DOCS, { patchWith });

    fireEvent.contextMenu(screen.getByTestId('table-header-name'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Hide column' }));

    const fn = patchWith.mock.calls[0]![0] as (s: CollectionTabState) => Partial<CollectionTabState>;
    expect(fn({ ...state(), columnConfig: { hidden: ['x'] } })).toEqual({ columnConfig: { hidden: ['x', 'name'] } });
    expect(fn({ ...state(), columnConfig: { hidden: ['name'] } })).toEqual({ columnConfig: { hidden: ['name'] } });
  });

  it('offers no sort where the table cannot sort', async () => {
    renderTable(DOCS);

    fireEvent.contextMenu(screen.getByTestId('table-header-name'));

    await screen.findByRole('menu');
    expect(screen.queryByRole('menuitem', { name: 'Sort ascending' })).toBeNull();
  });

  it('Shift+F10 on a header opens its menu, and Escape returns focus to its sort button', async () => {
    const user = userEvent.setup();
    renderTable(DOCS, {}, vi.fn());
    const header = screen.getByTestId('table-header-name');
    const sortButton = within(header).getByRole('button');
    sortButton.focus();

    fireEvent.keyDown(sortButton, { key: 'F10', shiftKey: true });
    await screen.findByRole('menu');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(sortButton));
  });
});

describe('deep documents', () => {
  it('Expand all in the document menu opens every level', async () => {
    render(<StatefulTree docs={[DEEP_DOC]} />);

    fireEvent.click(screen.getByRole('button', { name: /More actions for document/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Expand all' }));

    expect(fieldRow('a.b.c.d.e.f')).not.toBeNull();
  });

  it('Collapse all closes the document and every field under it', async () => {
    render(<StatefulTree docs={[DEEP_DOC]} />);
    fireEvent.click(screen.getByRole('button', { name: /More actions for document/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Expand all' }));
    expect(fieldRow('a.b.c.d.e.f')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /More actions for document/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Collapse all' }));
    expect(fieldRow('a')).toBeNull();

    // Reopening the document shows its fields collapsed again, not remembered open.
    fireEvent.click(screen.getByRole('button', { name: 'Expand document' }));
    expect(fieldRow('a')).not.toBeNull();
    expect(fieldRow('a.b')).toBeNull();
  });

  it('a plain click on a chevron opens one level; an ⌥-click opens every level below it', () => {
    render(<StatefulTree docs={[DEEP_DOC]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand document' }));

    fireEvent.click(within(fieldRow('a')!).getByRole('button', { name: 'Expand' }));
    expect(fieldRow('a.b')).not.toBeNull();
    expect(fieldRow('a.b.c')).toBeNull();

    // Collapse it, then ⌥-click.
    fireEvent.click(within(fieldRow('a')!).getByRole('button', { name: 'Collapse' }));
    fireEvent.click(within(fieldRow('a')!).getByRole('button', { name: 'Expand' }), { altKey: true });
    expect(fieldRow('a.b.c.d.e.f')).not.toBeNull();
  });

  it('⌥-click on the document chevron opens the document and every level', () => {
    render(<StatefulTree docs={[DEEP_DOC]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Expand document' }), { altKey: true });

    expect(fieldRow('a.b.c.d.e.f')).not.toBeNull();
  });

  it('→ on a collapsed row opens it, then enters its field tree; ← closes it', () => {
    render(<StatefulTree docs={[DEEP_DOC]} />);
    const tree = screen.getByRole('tree', { name: 'Documents' });
    tree.focus();

    fireEvent.keyDown(tree, { key: 'ArrowRight' });
    expect(fieldRow('a')).not.toBeNull();

    fireEvent.keyDown(tree, { key: 'ArrowRight' });
    const fields = document.querySelector<HTMLElement>('[data-expanded-doc-section="true"]')!;
    expect(document.activeElement).toBe(fields);

    // From the field tree, ← on a top-level field goes back to the documents.
    fireEvent.keyDown(fields, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tree);
    fireEvent.keyDown(tree, { key: 'ArrowLeft' });
    expect(fieldRow('a')).toBeNull();
  });

  it('⌥→ on the document row opens every level and ⌥← closes the document', () => {
    render(<StatefulTree docs={[DEEP_DOC]} />);
    const tree = screen.getByRole('tree', { name: 'Documents' });
    tree.focus();

    fireEvent.keyDown(tree, { key: 'ArrowRight', altKey: true });
    expect(fieldRow('a.b.c.d.e.f')).not.toBeNull();

    fireEvent.keyDown(tree, { key: 'ArrowLeft', altKey: true });
    expect(fieldRow('a')).toBeNull();
  });

  it('in the field tree, → opens then enters a field, ← steps to the parent, ⌥→ / ⌥← flip the subtree', () => {
    render(<StatefulTree docs={[DEEP_DOC]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand document' }));
    const fields = document.querySelector<HTMLElement>('[data-expanded-doc-section="true"]')!;
    const active = () => fields.getAttribute('aria-activedescendant');
    fields.focus();
    // _id is the first row, a is the second.
    fireEvent.keyDown(fields, { key: 'ArrowDown' });
    expect(active()).toBe(`field-row-${OID}::a`);

    fireEvent.keyDown(fields, { key: 'ArrowRight' });
    expect(fieldRow('a.b')).not.toBeNull();
    expect(active()).toBe(`field-row-${OID}::a`);

    fireEvent.keyDown(fields, { key: 'ArrowRight' });
    expect(active()).toBe(`field-row-${OID}::a.b`);

    fireEvent.keyDown(fields, { key: 'ArrowLeft' });
    expect(active()).toBe(`field-row-${OID}::a`);

    fireEvent.keyDown(fields, { key: 'ArrowRight', altKey: true });
    expect(fieldRow('a.b.c.d.e.f')).not.toBeNull();

    fireEvent.keyDown(fields, { key: 'ArrowLeft', altKey: true });
    expect(fieldRow('a.b')).toBeNull();
  });
});
