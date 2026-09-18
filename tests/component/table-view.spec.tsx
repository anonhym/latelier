import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor, within, act } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { notifications } from '@mantine/notifications';
import { TableView } from '../../src/pages/Workspace/views/TableView';
import { ColumnChooser } from '../../src/pages/Workspace/ColumnChooser';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import type {
  CollectionWorkspaceActions,
  CollectionWorkspaceMeta,
} from '../../src/pages/Workspace/context';
import type { CollectionTabState, ReferenceRule } from '@shared/types';
import { DRAGGED_FIELD_MIME, cycleSortField } from '../../src/pages/Workspace/builder';

// jsdom doesn't implement clipboard by default; stub so copyToClipboard
// doesn't throw when rendered.
let originalClipboard: Clipboard | undefined;
beforeEach(() => {
  originalClipboard = navigator.clipboard;
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(async () => undefined) },
    configurable: true,
  });
});
afterEach(() => {
  // Mantine's notification store is module-global and outlives RTL's
  // unmount, so a toast raised by one test would still be on screen for the
  // next one's "did it *not* claim success?" assertion.
  notifications.clean();
  if (originalClipboard !== undefined) {
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      configurable: true,
    });
  } else {
    delete (navigator as { clipboard?: Clipboard }).clipboard;
  }
});

function emptyState(overrides: Partial<CollectionTabState> = {}): CollectionTabState {
  return {
    view: 'Table',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    ...overrides,
  };
}

function emptyActions(overrides: Partial<CollectionWorkspaceActions> = {}): CollectionWorkspaceActions {
  return {
    patch: vi.fn(),
    patchWith: vi.fn(),
    run: vi.fn(),
    openEdit: vi.fn(),
    openDelete: vi.fn(),
    openDeleteAll: vi.fn(),
    openInsert: vi.fn(),
    openSave: vi.fn(),
    ...overrides,
  };
}

function emptyMeta(): CollectionWorkspaceMeta {
  return {
    connectionId: 'c1',
    dbName: 'app',
    collection: 'orders',
    tabId: 't1',
    isLoading: false,
  };
}

function renderTable(
  docs: unknown[],
  extra: {
    refsByField?: Map<string, ReferenceRule>;
    columnConfig?: CollectionTabState['columnConfig'];
    expandedRows?: Record<string, boolean>;
    onRowExpand?: (docId: string, expanded: boolean) => void;
    actions?: Partial<CollectionWorkspaceActions>;
    sort?: string;
    onSortField?: (field: string) => void;
  } = {},
) {
  return render(
      <CollectionWorkspaceProvider
        state={emptyState()}
        actions={emptyActions(extra.actions)}
        meta={emptyMeta()}
      >
        <TableView
          documents={docs}
          onColumnResize={vi.fn()}
          refsByField={extra.refsByField}
          columnConfig={extra.columnConfig}
          expandedRows={extra.expandedRows}
          onRowExpand={extra.onRowExpand ?? vi.fn()}
          sort={extra.sort}
          onSortField={extra.onSortField}
        />
      </CollectionWorkspaceProvider>
  );
}

/**
 * Real `useState` harness for the ColumnChooser <-> TableView round-trip
 * (AC3/AC4): patches from the chooser must come back through props and
 * actually change what TableView renders. A static-prop render can't
 * observe this (known gotcha) — see also treeview/table-view specs for the
 * same pattern.
 */
function renderStatefulTable(initial: CollectionTabState) {
  function Harness() {
    const [state, setState] = React.useState(initial);
    const actions = React.useMemo<CollectionWorkspaceActions>(
      () => ({
        patch: (p) => setState((s) => ({ ...s, ...p })),
        patchWith: (fn) => setState((s) => ({ ...s, ...fn(s) })),
        run: vi.fn(),
        openEdit: vi.fn(),
        openDelete: vi.fn(),
        openDeleteAll: vi.fn(),
        openInsert: vi.fn(),
        openSave: vi.fn(),
      }),
      [],
    );
    const documents = state.lastRun?.documents ?? [];
    const handleRowExpand = (docId: string, expanded: boolean) => {
      setState((s) => {
        const next = { ...(s.expandedRows ?? {}) };
        if (expanded) next[docId] = true;
        else delete next[docId];
        return { ...s, expandedRows: next };
      });
    };
    return (
      <CollectionWorkspaceProvider state={state} actions={actions} meta={emptyMeta()}>
        <ColumnChooser />
        <TableView
          documents={documents}
          columns={state.columns}
          columnConfig={state.columnConfig}
          expandedRows={state.expandedRows}
          onRowExpand={handleRowExpand}
          onColumnResize={(field, width) =>
            setState((s) => ({ ...s, columns: { ...(s.columns ?? {}), [field]: { width } } }))
          }
        />
      </CollectionWorkspaceProvider>
    );
  }
  return render(<Harness />);
}

describe('TableView — rendering and interaction', () => {
  it('derives columns from the first 50 docs, _id first, others alphabetized', () => {
    const docs = [
      { _id: 1, zebra: 'z', apple: 'a' },
      { _id: 2, banana: 'b' },
    ];
    const { container } = renderTable(docs);
    expect(container.textContent).toContain('_id');
    expect(container.textContent).toContain('apple');
    expect(container.textContent).toContain('banana');
    expect(container.textContent).toContain('zebra');

    const text = container.textContent ?? '';
    const idIdx = text.indexOf('_id');
    const appleIdx = text.indexOf('apple');
    const bananaIdx = text.indexOf('banana');
    const zebraIdx = text.indexOf('zebra');
    expect(idIdx).toBeLessThan(appleIdx);
    expect(appleIdx).toBeLessThan(bananaIdx);
    expect(bananaIdx).toBeLessThan(zebraIdx);
  });

  it('renders cell values from documents', () => {
    const docs = [{ _id: 1, name: 'alpha' }];
    const { container } = renderTable(docs);
    expect(container.textContent).toContain('alpha');
  });

  it('renders a ReferenceChip for a column with a matching reference rule', () => {
    const rule: ReferenceRule = {
      id: 'r1',
      connectionId: 'c1',
      sourceDb: 'app',
      sourceCollection: 'orders',
      sourceField: 'userId',
      targetDb: 'app',
      targetCollection: 'users',
      targetField: '_id',
      projection: [],
      displayTemplate: undefined,
      enabled: true,
      createdAt: '2026-04-01T00:00:00Z',
      updatedAt: '2026-04-01T00:00:00Z',
    };
    const refsByField = new Map<string, ReferenceRule>([['userId', rule]]);
    const docs = [{ _id: 'o1', userId: { $oid: '507f1f77bcf86cd799439011' } }];
    const { container } = renderTable(docs, { refsByField });
    expect(container.textContent).toMatch(/users|→|↗/);
  });

  // AC1 — row expand reuses the Tree's field-tree renderer. `nested` itself
  // is already visible as a *column* before expansion (unlike Tree view,
  // Table always shows every derived field as a header) — the un-expanded
  // assertion checks the nested object's own inner field (`deep`), which
  // only the DocFieldTree panel would ever render.
  it('expands a row via the gutter chevron to reveal its full document as a field tree', () => {
    const docs = [{ _id: { $oid: '507f1f77bcf86cd799439011' }, name: 'alpha', nested: { deep: 'value123' } }];
    const onRowExpand = vi.fn();
    const { getByRole, queryByText } = renderTable(docs, { onRowExpand });

    expect(queryByText('deep')).toBeNull();
    expect(queryByText(/value123/)).toBeNull();

    fireEvent.click(getByRole('button', { name: 'Expand document' }));
    expect(onRowExpand).toHaveBeenCalledWith('507f1f77bcf86cd799439011', true);
  });

  it('renders the DocFieldTree panel (with FIELD/VALUE/TYPE header) when expandedRows marks the row expanded', () => {
    const docs = [{ _id: { $oid: '507f1f77bcf86cd799439011' }, visibleField: 'yes' }];
    const { container } = renderTable(docs, {
      expandedRows: { '507f1f77bcf86cd799439011': true },
    });
    expect(container.textContent).toContain('Field');
    expect(container.textContent).toContain('Value');
    expect(container.textContent).toContain('Type');
    expect(container.textContent).toContain('visibleField');
    expect(container.textContent).toContain('yes');
  });

  // AC5 — click-to-expand cell.
  it('opens a popover with the full value when the cell expand affordance is clicked', () => {
    const longValue = 'x'.repeat(80);
    const docs = [{ _id: 1, note: longValue }];
    const { getByTitle, getByText, queryByText } = renderTable(docs);

    const cell = getByTitle(/Drag to add "note/);
    // The cell itself already renders the raw value (unquoted) — that alone
    // isn't proof the popover opened. The popover renders it quoted
    // (`"${value}"`), which the cell never does, so assert on that form to
    // actually discriminate "popover open" from "cell always shows this".
    expect(queryByText(`"${longValue}"`)).toBeNull();

    fireEvent.mouseEnter(cell);
    // Scope to this cell — every column's cell renders its own "Expand cell
    // value" button, so an unscoped query would match more than one.
    const expandBtn = within(cell).getByRole('button', { name: 'Expand cell value' });
    fireEvent.click(expandBtn);

    expect(getByText(`"${longValue}"`)).toBeTruthy();
  });

  // AC6 regressions — behaviour that must survive the memo/gutter/dynamic-
  // height refactor.
  describe('AC6 regressions', () => {
    it('⌘/Ctrl+click toggles a row into multi-select without deselecting via plain click semantics', () => {
      const docs = [
        { _id: 1, name: 'a' },
        { _id: 2, name: 'b' },
      ];
      const { container, getAllByTitle } = renderTable(docs);
      const rows = container.querySelectorAll('[data-selected]');
      expect(rows.length).toBe(2);

      // Selection is driven by a click anywhere in the row's cell strip
      // (data-selected lives on the row's outer wrapper, one level up from
      // the clickable strip — the row-expand chevron/gutter and the
      // DocFieldTree panel below deliberately do NOT carry this handler).
      const cells = getAllByTitle(/Drag to add "name/);
      fireEvent.click(cells[0], { metaKey: true });
      fireEvent.click(cells[1], { metaKey: true });
      expect(rows[0].getAttribute('data-selected')).toBe('true');
      expect(rows[1].getAttribute('data-selected')).toBe('true');
    });

    it('double-click on a cell copies its value to the clipboard', () => {
      const docs = [{ _id: 1, name: 'alpha' }];
      const { getByTitle } = renderTable(docs);
      const cell = getByTitle(/Drag to add "name/);
      fireEvent.doubleClick(cell);
      expect(clipboardWriteTextWasCalled()).toBe(true);
    });

    // the badge used to be set synchronously, next to a dropped
    // promise: it claimed a copy that may never have happened.
    it('shows the copied badge only once the write has resolved', async () => {
      let settle: () => void = () => {};
      const writeText = vi.fn(() => new Promise<void>((res) => { settle = res; }));
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const { getByTitle } = renderTable([{ _id: 1, name: 'alpha' }]);

      fireEvent.doubleClick(getByTitle(/Drag to add "name/));
      expect(getByTitle(/Drag to add "name/).textContent).not.toContain('Copied');

      await act(async () => { settle(); });
      await waitFor(() =>
        expect(getByTitle(/Drag to add "name/).textContent).toContain('Copied'),
      );
    });

    it('reports a rejected cell copy and shows no badge', async () => {
      const writeText = vi.fn(async () => { throw new Error('denied'); });
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const { getByTitle } = renderTable([{ _id: 1, name: 'alpha' }]);

      fireEvent.doubleClick(getByTitle(/Drag to add "name/));

      await screen.findByText(/Could not copy to the clipboard/);
      expect(getByTitle(/Drag to add "name/).textContent).not.toContain('Copied');
    });

    // The regression this guard exists for: without `e.target !==
    // e.currentTarget`, Enter on a nested native button (which also bubbles
    // its keydown up to the strip) would both run its own action AND select
    // the row it lives in.
    it('Enter on the expand chevron expands the row but does not also select it', () => {
      const docs = [{ _id: { $oid: '507f1f77bcf86cd799439011' }, name: 'a' }];
      const onRowExpand = vi.fn();
      const { container } = renderTable(docs, { onRowExpand });
      const row = container.querySelector('[data-selected]')!;
      const chevron = container.querySelector('[aria-label="Expand document"]')!;

      fireEvent.keyDown(chevron, { key: 'Enter' });
      expect(row.getAttribute('data-selected')).toBe('false');
    });

    it('drag start on a cell sets the DRAGGED_FIELD_MIME payload', () => {
      const docs = [{ _id: 1, name: 'alpha' }];
      const { getByTitle } = renderTable(docs);
      const cell = getByTitle(/Drag to add "name/);

      const setData = vi.fn();
      fireEvent.dragStart(cell, {
        dataTransfer: { setData, effectAllowed: '' },
      });
      const call = setData.mock.calls.find(([type]) => type === DRAGGED_FIELD_MIME);
      expect(call).toBeTruthy();
      expect(JSON.parse(call![1])).toEqual({ field: 'name', value: 'alpha' });
    });

    it('right-click on a cell opens the context menu with Copy value / Copy field path', () => {
      const docs = [{ _id: 1, name: 'alpha' }];
      const { getByTitle, getByText } = renderTable(docs);
      const cell = getByTitle(/Drag to add "name/);
      fireEvent.contextMenu(cell);
      expect(getByText('Copy value')).toBeTruthy();
      expect(getByText('Copy field path')).toBeTruthy();
    });

    it('Escape closes the cell context menu', () => {
      const docs = [{ _id: 1, name: 'alpha' }];
      const { getByTitle, getByText, queryByText } = renderTable(docs);
      const cell = getByTitle(/Drag to add "name/);
      fireEvent.contextMenu(cell);
      expect(getByText('Copy value')).toBeTruthy();

      // Fired at the window, not at the menu node. The menu opens from a
      // `contextmenu` event and nothing focuses it, so a keydown dispatched
      // straight at the element proves only that a handler exists — it is a
      // path no keyboard user can take. An earlier version of this test did
      // exactly that and passed against a handler that could never fire.
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(queryByText('Copy value')).toBeNull();
    });

    it('Escape closes the field context menu from an expanded row', () => {
      const docs = [{ _id: { $oid: '507f1f77bcf86cd799439011' }, visibleField: 'yes' }];
      const { container, getByText, queryByText } = renderTable(docs, {
        expandedRows: { '507f1f77bcf86cd799439011': true },
      });
      // The field menu is a second, independently-registered window listener;
      // the cell menu passing says nothing about this one.
      const fieldRow = container.querySelector('[role="treeitem"]')!;
      fireEvent.contextMenu(fieldRow);
      expect(getByText('Copy field path')).toBeTruthy();

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(queryByText('Copy field path')).toBeNull();
    });

    it('resize handle is still present on a column header', () => {
      const docs = [{ _id: 1, name: 'alpha' }];
      const { container } = renderTable(docs);
      expect(container.querySelector('[data-resize-handle="1"]')).toBeTruthy();
    });

    it('sort indicator renders when a header is the active sort field', () => {
      const docs = [{ _id: 1, name: 'alpha' }];
      const { getByTestId } = render(
        <CollectionWorkspaceProvider state={emptyState()} actions={emptyActions()} meta={emptyMeta()}>
          <TableView
            documents={docs}
            onColumnResize={vi.fn()}
            onSortField={vi.fn()}
            sort={'{"name":1}'}
          />
        </CollectionWorkspaceProvider>,
      );
      expect(getByTestId('table-header-name').textContent).toContain('↑');
    });
  });

  // AC3/AC4 — column chooser hide/reorder round-trips into TableView.
  describe('column chooser integration (stateful)', () => {
    function stateWithDocs(overrides: Partial<CollectionTabState> = {}): CollectionTabState {
      return emptyState({
        lastRun: {
          documents: [
            { _id: 1, apple: 'a-val', banana: 'b-val' },
            { _id: 2, apple: 'a-val2', banana: 'b-val2' },
          ],
          durationMs: 1,
          ranAt: '2026-01-01T00:00:00Z',
        },
        ...overrides,
      });
    }

    it('hiding a column via the chooser removes its header + cells; unhiding restores it', () => {
      const { getByRole, container, queryByTestId } = renderStatefulTable(stateWithDocs());

      expect(queryByTestId('table-header-apple')).toBeTruthy();
      expect(container.textContent).toContain('a-val');

      fireEvent.click(getByRole('button', { name: /columns/i }));
      const appleCheckbox = getByRole('checkbox', { name: 'apple' });
      fireEvent.click(appleCheckbox);

      expect(queryByTestId('table-header-apple')).toBeNull();
      expect(container.textContent).not.toContain('a-val');

      fireEvent.click(appleCheckbox);
      expect(queryByTestId('table-header-apple')).toBeTruthy();
      expect(container.textContent).toContain('a-val');
    });

    it('reordering via drag changes the header order', () => {
      const { getByRole, getByTestId } = renderStatefulTable(stateWithDocs());

      fireEvent.click(getByRole('button', { name: /columns/i }));
      // Scope to the chooser's own popover dropdown — TableView's cells are
      // also `draggable`, so an unscoped document-wide query would be
      // ambiguous between the two.
      const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
      const checkboxRows = dialog.querySelectorAll('[draggable="true"]');
      // Order in the chooser is `_id, apple, banana` — drag `banana` (index 2)
      // to the front (index 0).
      const dataTransfer = {};
      fireEvent.dragStart(checkboxRows[2], { dataTransfer });
      fireEvent.dragOver(checkboxRows[0], { dataTransfer });
      fireEvent.drop(checkboxRows[0], { dataTransfer });

      const idHeader = getByTestId('table-header-_id');
      const bananaHeader = getByTestId('table-header-banana');
      const appleHeader = getByTestId('table-header-apple');
      // `banana` must now render before both `_id` and `apple` in DOM order.
      const position = idHeader.compareDocumentPosition(bananaHeader);
      expect(position & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
      const applePosition = appleHeader.compareDocumentPosition(bananaHeader);
      expect(applePosition & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    });

    // AC8 — computed dotted-path column.
    it('a computed dotted-path column renders the nested value', () => {
      const { getByRole, container } = renderStatefulTable(
        stateWithDocs({
          lastRun: {
            documents: [{ _id: 1, address: { city: 'Springfield' } }],
            durationMs: 1,
            ranAt: '2026-01-01T00:00:00Z',
          },
        }),
      );

      fireEvent.click(getByRole('button', { name: /columns/i }));
      const input = getByRole('textbox', { name: /computed column path/i });
      fireEvent.change(input, { target: { value: 'address.city' } });
      fireEvent.click(getByRole('button', { name: /add column/i }));

      expect(container.textContent).toContain('Springfield');
      // Header for the computed column shows the path (no explicit label set).
      const headers = Array.from(container.querySelectorAll('[data-testid^="table-header-"]'));
      expect(headers.some((h) => h.textContent?.includes('address.city'))).toBe(true);
    });
  });

  // #20 — roving focus: the grid itself is the widget's only tab stop, and
  // arrow/Home/End move `aria-activedescendant` between mounted rows instead
  // of putting every row in the tab order.
  describe('roving focus (#20)', () => {
    it('the grid is a tab stop and names row 0 as the active descendant', () => {
      const docs = [{ _id: 1, name: 'a' }, { _id: 2, name: 'b' }, { _id: 3, name: 'c' }];
      const { container } = renderTable(docs);
      const grid = container.querySelector('[role="grid"]')!;

      expect(grid.getAttribute('tabindex')).toBe('0');
      expect(grid.getAttribute('aria-activedescendant')).toBe('table-row-0');
      expect(container.querySelector('#table-row-0')).not.toBeNull();
    });

    it('ArrowDown moves the active descendant to the next row', () => {
      const docs = [{ _id: 1, name: 'a' }, { _id: 2, name: 'b' }, { _id: 3, name: 'c' }];
      const { container } = renderTable(docs);
      const grid = container.querySelector('[role="grid"]')!;

      fireEvent.keyDown(grid, { key: 'ArrowDown' });
      expect(grid.getAttribute('aria-activedescendant')).toBe('table-row-1');
    });

    it('ArrowUp from row 0 wraps to the last row', () => {
      const docs = [{ _id: 1, name: 'a' }, { _id: 2, name: 'b' }, { _id: 3, name: 'c' }];
      const { container } = renderTable(docs);
      const grid = container.querySelector('[role="grid"]')!;

      fireEvent.keyDown(grid, { key: 'ArrowUp' });
      expect(grid.getAttribute('aria-activedescendant')).toBe('table-row-2');
    });

    it('End jumps to the last row, Home jumps back to the first', () => {
      const docs = [{ _id: 1, name: 'a' }, { _id: 2, name: 'b' }, { _id: 3, name: 'c' }];
      const { container } = renderTable(docs);
      const grid = container.querySelector('[role="grid"]')!;

      fireEvent.keyDown(grid, { key: 'End' });
      expect(grid.getAttribute('aria-activedescendant')).toBe('table-row-2');
      fireEvent.keyDown(grid, { key: 'Home' });
      expect(grid.getAttribute('aria-activedescendant')).toBe('table-row-0');
    });

    it('Enter on the grid itself selects the active row', () => {
      const docs = [{ _id: 1, name: 'a' }, { _id: 2, name: 'b' }];
      const { container } = renderTable(docs);
      const grid = container.querySelector('[role="grid"]')!;
      const rows = container.querySelectorAll('[data-selected]');

      fireEvent.keyDown(grid, { key: 'ArrowDown' });
      fireEvent.keyDown(grid, { key: 'Enter' });

      expect(rows[0].getAttribute('data-selected')).toBe('false');
      expect(rows[1].getAttribute('data-selected')).toBe('true');
    });

    // The mutation this guards against: dropping `e.target !== e.currentTarget`
    // at the grid level would make Enter on the row's own nested expand
    // button ALSO select the active row (mirrors the pre-existing guard on
    // the row strip's own onKeyDown, at the grid's level instead).
    it('Enter bubbling up from a nested button does not select the active row', () => {
      const docs = [{ _id: { $oid: '507f1f77bcf86cd799439011' }, name: 'a' }];
      const { container } = renderTable(docs);
      const chevron = container.querySelector('[aria-label="Expand document"]')!;
      const row = container.querySelector('[data-selected]')!;

      fireEvent.keyDown(chevron, { key: 'Enter' });
      expect(row.getAttribute('data-selected')).toBe('false');
    });

    // Found in review: `tabIndex={-1}` on the row strip excludes it from
    // *sequential* (Tab) focus but leaves it click-focusable per the HTML
    // focusing-steps algorithm. `fireEvent.click` (used everywhere else in
    // this file) does no focus management at all, so nothing here had ever
    // caught a real click actually moving DOM focus onto the row — only
    // `userEvent`'s `click` walks up to the nearest focusable ancestor the
    // way a real browser does, which is why this needs it specifically:
    // once focus is truly on the row, every later keydown reaches the grid
    // with `e.target` = the row, `e.currentTarget` = the grid, and
    // `useRovingFocus`'s own-target guard swallows it — Arrow/Home/End all
    // go dead until focus is moved again by hand.
    it('a real click on a row does not trap focus there — ArrowDown still moves the grid afterward', async () => {
      const user = userEvent.setup();
      const docs = [{ _id: 1, name: 'a' }, { _id: 2, name: 'b' }, { _id: 3, name: 'c' }];
      const { container } = renderTable(docs);
      const grid = container.querySelector('[role="grid"]')!;
      // Scoped to the grid, not `container` — #53 gives the sticky header
      // row its own `role="row"` too (for its `columnheader` children), and
      // it's a DOM sibling of the grid, not a descendant, so this excludes
      // it without depending on index order.
      const strip = grid.querySelectorAll('[role="row"]')[0] as HTMLElement;

      await user.click(strip);
      await user.keyboard('{ArrowDown}');

      expect(document.activeElement).toBe(grid);
      expect(grid.getAttribute('aria-activedescendant')).toBe('table-row-1');
    });

    // Clicking a row should also make it the roving-focus target, so the
    // very next Arrow moves from the row just clicked — not from wherever
    // the highlight happened to be sitting before.
    it('clicking row 2 makes it the active row — ArrowDown moves to row 3, not row 1', async () => {
      const user = userEvent.setup();
      const docs = [{ _id: 1, name: 'a' }, { _id: 2, name: 'b' }, { _id: 3, name: 'c' }];
      const { container } = renderTable(docs);
      const grid = container.querySelector('[role="grid"]')!;
      // Scoped to the grid — see the note in the previous test.
      const strip = grid.querySelectorAll('[role="row"]')[1] as HTMLElement;

      await user.click(strip);
      expect(grid.getAttribute('aria-activedescendant')).toBe('table-row-1');
      await user.keyboard('{ArrowDown}');
      expect(grid.getAttribute('aria-activedescendant')).toBe('table-row-2');
    });

    // #55 — the shared ContextMenu had no keyboard open path; this cell menu
    // is TableView's own hand-rolled one (not the shared `ContextMenu`
    // component), so it needs its own keyboard trigger and focus management.
    describe('keyboard: opening the context menu (#55)', () => {
      it('Shift+F10 opens the menu for the active row, with Edit/Delete reachable', async () => {
        const docs = [{ _id: 1, name: 'a' }, { _id: 2, name: 'b' }];
        const { container, getByText } = renderTable(docs);
        const grid = container.querySelector('[role="grid"]')! as HTMLElement;

        fireEvent.keyDown(grid, { key: 'F10', shiftKey: true });

        expect(await screen.findByText('Edit')).toBeTruthy();
        expect(getByText('Delete')).toBeTruthy();
      });

      it('the ContextMenu key opens the same menu', async () => {
        const docs = [{ _id: 1, name: 'a' }];
        const { container } = renderTable(docs);
        const grid = container.querySelector('[role="grid"]')! as HTMLElement;

        fireEvent.keyDown(grid, { key: 'ContextMenu' });

        expect(await screen.findByText('Edit')).toBeTruthy();
      });

      it('F10 without Shift does not open the menu', () => {
        const docs = [{ _id: 1, name: 'a' }];
        const { container, queryByText } = renderTable(docs);
        const grid = container.querySelector('[role="grid"]')! as HTMLElement;

        fireEvent.keyDown(grid, { key: 'F10', shiftKey: false });

        expect(queryByText('Edit')).toBeNull();
      });

      it('anchors the menu to the active row, not a stale {0,0}', async () => {
        const docs = [{ _id: 1, name: 'a' }];
        const { container } = renderTable(docs);
        const grid = container.querySelector('[role="grid"]')! as HTMLElement;
        const row = container.querySelector('#table-row-0')!;
        vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
          left: 42,
          bottom: 84,
          top: 0,
          right: 0,
          width: 0,
          height: 0,
          x: 42,
          y: 84,
          toJSON: () => {},
        } as DOMRect);

        fireEvent.keyDown(grid, { key: 'ContextMenu' });

        const menu = await screen.findByRole('group', { name: 'Cell actions' });
        expect(menu.style.left).toBe('42px');
        expect(menu.style.top).toBe('84px');
      });

      it('focus enters the menu on open and Escape returns it to the grid', async () => {
        const docs = [{ _id: 1, name: 'a' }];
        const { container } = renderTable(docs);
        const grid = container.querySelector('[role="grid"]')! as HTMLElement;

        fireEvent.keyDown(grid, { key: 'ContextMenu' });
        await screen.findByRole('group', { name: 'Cell actions' });
        await waitFor(() =>
          expect(document.activeElement?.closest('[role="group"]')).toBeTruthy(),
        );

        // Same window-level Escape listener as the existing mouse-opened
        // menu (`:869`/`:973`) — must not regress it.
        fireEvent.keyDown(window, { key: 'Escape' });

        await waitFor(() => expect(document.activeElement).toBe(grid));
      });

      it('right-click behaviour is unchanged — no forced refocus on a mouse-opened menu', () => {
        const docs = [{ _id: 1, name: 'a' }];
        const { getByTitle, getByText } = renderTable(docs);
        const cell = getByTitle(/Drag to add "name/);

        fireEvent.contextMenu(cell);
        expect(getByText('Edit')).toBeTruthy();

        fireEvent.keyDown(window, { key: 'Escape' });
        // Pre-existing behaviour (see the "Escape closes the cell context
        // menu" test above): nothing focuses this menu for a mouse open, so
        // there is nothing guaranteeing where focus lands — only that the
        // menu itself is gone.
        expect(document.querySelector('[aria-label="Cell actions"]')).toBeNull();
      });
    });
  });

  // #53 — the sort mechanism (a real <button>) already worked; the sorted
  // header cell just never said so to assistive tech, and the hover-gated
  // pencil/expand affordances were invisible to a keyboard user who tabbed
  // onto them.
  describe('aria-sort and focus-visible affordances (#53)', () => {
    it('a sortable column header is a columnheader with aria-sort="none" while unsorted', () => {
      const docs = [{ _id: 1, name: 'alpha' }];
      const { getByTestId } = renderTable(docs, { onSortField: vi.fn() });
      const header = getByTestId('table-header-name');

      expect(header.getAttribute('role')).toBe('columnheader');
      expect(header.getAttribute('aria-sort')).toBe('none');
    });

    it('carries aria-sort="ascending" or "descending" for the actively sorted column', () => {
      const docs = [{ _id: 1, name: 'alpha' }];
      const ascending = renderTable(docs, { onSortField: vi.fn(), sort: '{"name":1}' });
      expect(within(ascending.container).getByTestId('table-header-name').getAttribute('aria-sort')).toBe(
        'ascending',
      );
      ascending.unmount();

      const descending = renderTable(docs, { onSortField: vi.fn(), sort: '{"name":-1}' });
      expect(within(descending.container).getByTestId('table-header-name').getAttribute('aria-sort')).toBe(
        'descending',
      );
    });

    it('keyboard-activating the sort button cycles aria-sort ascending -> descending -> none', async () => {
      const user = userEvent.setup();
      function Harness() {
        const [sort, setSort] = React.useState('');
        return (
          <CollectionWorkspaceProvider state={emptyState()} actions={emptyActions()} meta={emptyMeta()}>
            <TableView
              documents={[{ _id: 1, name: 'alpha' }]}
              onColumnResize={vi.fn()}
              onSortField={(field) => setSort((s) => cycleSortField(s, field))}
              sort={sort}
            />
          </CollectionWorkspaceProvider>
        );
      }
      const { getByTestId, getByRole } = render(<Harness />);
      const header = getByTestId('table-header-name');
      const sortButton = getByRole('button', { name: 'name' });

      expect(header.getAttribute('aria-sort')).toBe('none');
      sortButton.focus();
      await user.keyboard('{Enter}');
      expect(header.getAttribute('aria-sort')).toBe('ascending');
      await user.keyboard('{Enter}');
      expect(header.getAttribute('aria-sort')).toBe('descending');
      await user.keyboard('{Enter}');
      expect(header.getAttribute('aria-sort')).toBe('none');
    });

    it('a non-sortable computed column header is still a columnheader but carries no aria-sort', () => {
      const docs = [{ _id: 1, address: { city: 'Springfield' } }];
      const columnConfig: CollectionTabState['columnConfig'] = {
        computed: [{ id: 'computed:address.city', path: 'address.city' }],
      };
      const { getByTestId } = renderTable(docs, { onSortField: vi.fn(), columnConfig });
      const header = getByTestId('table-header-computed:address.city');

      expect(header.getAttribute('role')).toBe('columnheader');
      expect(header.hasAttribute('aria-sort')).toBe(false);
    });

    it('a column with no onSortField at all is a columnheader with no aria-sort (view has sorting disabled)', () => {
      const docs = [{ _id: 1, name: 'alpha' }];
      const { getByTestId } = renderTable(docs);
      const header = getByTestId('table-header-name');

      expect(header.getAttribute('role')).toBe('columnheader');
      expect(header.hasAttribute('aria-sort')).toBe(false);
    });

    it('a column hidden via the column chooser renders no header at all — no orphaned aria-sort', () => {
      const docs = [{ _id: 1, name: 'alpha' }];
      const columnConfig: CollectionTabState['columnConfig'] = { hidden: ['name'] };
      const { queryByTestId } = renderTable(docs, {
        onSortField: vi.fn(),
        sort: '{"name":1}',
        columnConfig,
      });

      expect(queryByTestId('table-header-name')).toBeNull();
    });

    it('focusing the expand-cell affordance makes it visible (WCAG 2.4.11), not just present', () => {
      const docs = [{ _id: 1, note: 'hello' }];
      const { getByTitle } = renderTable(docs);
      const cell = getByTitle(/Drag to add "note/);
      const expandBtn = within(cell).getByRole('button', { name: 'Expand cell value' }) as HTMLElement;

      // Baseline: nothing hovered/focused yet — the affordance exists (it's
      // always mounted) but is not visible. Asserting only `toBeTruthy()` on
      // the button, as the pre-existing expand test does, would pass whether
      // or not this fix is applied — the button is real either way. Opacity
      // is the actual property the hover path already drives (:171/:358), so
      // it's the one a focus path has to drive too.
      expect(expandBtn.style.opacity).toBe('0');
      expect(expandBtn.style.pointerEvents).toBe('none');

      // The button is already a real tab stop (never `tabIndex={-1}`), so
      // this reproduces exactly what a keyboard user tabbing onto it does.
      // `fireEvent.focus`, not a raw `.focus()` call: the visibility flip is
      // a React state update inside the `onFocus` handler this cell's
      // wrapping `gridcell` div carries, and only `fireEvent` wraps native
      // event dispatch in `act()` so that update is flushed before the next
      // assertion runs — a bare `element.focus()` schedules the same update
      // but leaves it unflushed, which is a false negative, not proof the
      // fix is missing (confirmed against a real probe: logging inside the
      // handler shows it firing either way; only the flushed DOM differs).
      fireEvent.focus(expandBtn);

      expect(expandBtn.style.opacity).toBe('1');
      expect(expandBtn.style.pointerEvents).toBe('auto');
    });

    it('blurring the expand-cell affordance hides it again (not stuck visible)', () => {
      const docs = [{ _id: 1, note: 'hello' }];
      const { getByTitle } = renderTable(docs);
      const cell = getByTitle(/Drag to add "note/);
      const expandBtn = within(cell).getByRole('button', { name: 'Expand cell value' }) as HTMLElement;

      fireEvent.focus(expandBtn);
      expect(expandBtn.style.opacity).toBe('1');
      fireEvent.blur(expandBtn);
      expect(expandBtn.style.opacity).toBe('0');
    });

    it('tabbing onto the edit-cell pencil affordance makes it visible', () => {
      const docs = [{ _id: 1, status: 'pending' }];
      const { getByTitle } = renderTable(docs, { actions: { updateField: vi.fn() } });
      const cell = getByTitle(/Drag to add "status/);
      const editBtn = within(cell).getByRole('button', { name: 'Edit cell value' }) as HTMLElement;

      expect(editBtn.style.opacity).toBe('0');
      fireEvent.focus(editBtn);
      expect(editBtn.style.opacity).toBe('1');
      expect(editBtn.style.pointerEvents).toBe('auto');
    });
  });
});

function clipboardWriteTextWasCalled(): boolean {
  const mock = navigator.clipboard.writeText as unknown as { mock?: { calls: unknown[] } };
  return (mock.mock?.calls.length ?? 0) > 0;
}
