import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor, within, act } from '../helpers/render';
import { notifications } from '@mantine/notifications';
import { TableView } from '../../src/pages/Workspace/views/TableView';
import { ColumnChooser } from '../../src/pages/Workspace/ColumnChooser';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import type {
  CollectionWorkspaceActions,
  CollectionWorkspaceMeta,
} from '../../src/pages/Workspace/context';
import type { CollectionTabState, ReferenceRule } from '@shared/types';
import { DRAGGED_FIELD_MIME } from '../../src/pages/Workspace/builder';

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
  } = {},
) {
  return render(
      <CollectionWorkspaceProvider
        state={emptyState()}
        actions={emptyActions()}
        meta={emptyMeta()}
      >
        <TableView
          documents={docs}
          onColumnResize={vi.fn()}
          refsByField={extra.refsByField}
          columnConfig={extra.columnConfig}
          expandedRows={extra.expandedRows}
          onRowExpand={extra.onRowExpand ?? vi.fn()}
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
});

function clipboardWriteTextWasCalled(): boolean {
  const mock = navigator.clipboard.writeText as unknown as { mock?: { calls: unknown[] } };
  return (mock.mock?.calls.length ?? 0) > 0;
}
