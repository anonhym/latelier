import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '../helpers/render';
import { TableView } from '../../src/pages/Workspace/views/TableView';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import type {
  CollectionWorkspaceActions,
  CollectionWorkspaceMeta,
} from '../../src/pages/Workspace/context';
import type { CollectionTabState, TableColumnConfig } from '@shared/types';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { api, getErrorMessage } from '../../src/api/atelier';
import { buildIdFilter } from '../../src/pages/Workspace/views/docId';
import { ejsonStringify } from '../../src/utils/ejson';
import { notify } from '../../src/theme/notifications';

// jsdom doesn't implement clipboard by default; other cell interactions
// (double-click copy) can fire incidentally during these tests.
let originalClipboard: Clipboard | undefined;
beforeEach(() => {
  originalClipboard = navigator.clipboard;
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(async () => undefined) },
    configurable: true,
  });
});
afterEach(() => {
  if (originalClipboard !== undefined) {
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      configurable: true,
    });
  } else {
    delete (navigator as { clipboard?: Clipboard }).clipboard;
  }
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

function emptyMeta(overrides: Partial<CollectionWorkspaceMeta> = {}): CollectionWorkspaceMeta {
  return {
    connectionId: 'c1',
    dbName: 'app',
    collection: 'orders',
    tabId: 't1',
    isLoading: false,
    ...overrides,
  };
}

function stateWithDocs(
  docs: unknown[],
  overrides: Partial<CollectionTabState> = {},
): CollectionTabState {
  return {
    view: 'Table',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    lastRun: { documents: docs, durationMs: 1, ranAt: '2026-01-01T00:00:00Z' },
    ...overrides,
  };
}

/**
 * Harness whose `updateField` mirrors Workspace.tsx's real implementation
 * (`buildIdFilter` -> `api.doc.updateOne` -> refresh callback on success,
 * `notify.error` on failure) — a noop spy would only prove the affordance
 * renders, not the `$set` shape or the error-feedback path (T2.6 plan
 * validation: "real/stateful actions object, not a noop spy").
 */
function renderInlineEditHarness(
  docs: unknown[],
  opts: {
    onRefresh?: () => void;
    metaOverrides?: Partial<CollectionWorkspaceMeta>;
    columnConfig?: TableColumnConfig;
    openDuplicate?: (doc: unknown) => void;
  } = {},
) {
  function Harness() {
    const actions = React.useMemo<CollectionWorkspaceActions>(
      () => ({
        patch: vi.fn(),
        patchWith: vi.fn(),
        run: vi.fn(),
        openEdit: vi.fn(),
        openDelete: vi.fn(),
        openDeleteAll: vi.fn(),
        openInsert: vi.fn(),
        openSave: vi.fn(),
        updateField: (doc, fieldPath, newValue) => {
          const filterJson = buildIdFilter(doc);
          if (filterJson === null) {
            notify.error('Cannot edit a document without an _id');
            return;
          }
          const updateJson = ejsonStringify({ $set: { [fieldPath]: newValue } });
          api.doc
            .updateOne({
              connectionId: 'c1',
              dbName: 'app',
              collection: 'orders',
              filterJson,
              updateJson,
            })
            .then(() => opts.onRefresh?.())
            .catch((e: unknown) => {
              notify.error(getErrorMessage(e, 'Update failed'), { title: 'Update failed' });
            });
        },
        openDuplicate: opts.openDuplicate ?? vi.fn(),
      }),
      [],
    );
    return (
      <CollectionWorkspaceProvider
        state={stateWithDocs(docs)}
        actions={actions}
        meta={emptyMeta(opts.metaOverrides)}
      >
        <TableView
          documents={docs}
          onColumnResize={vi.fn()}
          onRowExpand={vi.fn()}
          columnConfig={opts.columnConfig}
        />
      </CollectionWorkspaceProvider>
    );
  }
  return render(<Harness />);
}

/**
 * Rerenderable variant of `renderInlineEditHarness` — the plain harness
 * above closes over a fixed `docs` array, which can't reproduce N0.2's bug
 * (a documents-array swap mid-edit rebinding the same `TableCell` instance
 * to a different document). Here `docs` is a prop, so `rerenderDocs` swaps
 * both the `TableView` `documents=` prop and the provider's `state.lastRun`
 * together, matching how Workspace.tsx replaces both after a refetch.
 */
function renderRerenderableInlineEditHarness(
  initialDocs: unknown[],
  opts: {
    onRefresh?: () => void;
    metaOverrides?: Partial<CollectionWorkspaceMeta>;
  } = {},
) {
  function Harness({ docs }: { docs: unknown[] }) {
    const actions = React.useMemo<CollectionWorkspaceActions>(
      () => ({
        patch: vi.fn(),
        patchWith: vi.fn(),
        run: vi.fn(),
        openEdit: vi.fn(),
        openDelete: vi.fn(),
        openDeleteAll: vi.fn(),
        openInsert: vi.fn(),
        openSave: vi.fn(),
        updateField: (doc, fieldPath, newValue) => {
          const filterJson = buildIdFilter(doc);
          if (filterJson === null) {
            notify.error('Cannot edit a document without an _id');
            return;
          }
          const updateJson = ejsonStringify({ $set: { [fieldPath]: newValue } });
          api.doc
            .updateOne({
              connectionId: 'c1',
              dbName: 'app',
              collection: 'orders',
              filterJson,
              updateJson,
            })
            .then(() => opts.onRefresh?.())
            .catch((e: unknown) => {
              notify.error(getErrorMessage(e, 'Update failed'), { title: 'Update failed' });
            });
        },
        openDuplicate: vi.fn(),
      }),
      [],
    );
    return (
      <CollectionWorkspaceProvider
        state={stateWithDocs(docs)}
        actions={actions}
        meta={emptyMeta(opts.metaOverrides)}
      >
        <TableView documents={docs} onColumnResize={vi.fn()} onRowExpand={vi.fn()} />
      </CollectionWorkspaceProvider>
    );
  }
  const result = render(<Harness docs={initialDocs} />);
  return {
    ...result,
    rerenderDocs: (docs: unknown[]) => result.rerender(<Harness docs={docs} />),
  };
}

describe('TableView — inline cell editing (T2.6)', () => {
  it('inline-edits a string cell via Enter: calls doc.updateOne with a $set patch (never replace), then refreshes', async () => {
    const updateCalls: Array<{ filterJson: string; updateJson: string }> = [];
    const replaceCalls: unknown[] = [];
    installAtelierMock({
      doc: {
        updateOne: async (input) => {
          updateCalls.push(input);
          return { matchedCount: 1, modifiedCount: 1 };
        },
        replace: async (input) => {
          replaceCalls.push(input);
          return { matchedCount: 1, modifiedCount: 1 };
        },
      },
    });
    const onRefresh = vi.fn();
    const docs = [{ _id: { $oid: '507f1f77bcf86cd799439011' }, status: 'pending' }];
    const { getByTitle } = renderInlineEditHarness(docs, { onRefresh });

    const cell = getByTitle(/Drag to add "status/);
    fireEvent.mouseEnter(cell);
    const editBtn = within(cell).getByRole('button', { name: 'Edit cell value' });
    fireEvent.click(editBtn);

    const input = within(cell).getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('pending');
    fireEvent.change(input, { target: { value: 'shipped' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(updateCalls.length).toBe(1));
    expect(replaceCalls.length).toBe(0);
    expect(JSON.parse(updateCalls[0]!.filterJson)).toEqual({
      _id: { $oid: '507f1f77bcf86cd799439011' },
    });
    expect(JSON.parse(updateCalls[0]!.updateJson)).toEqual({ $set: { status: 'shipped' } });

    // The refresh path (re-running the query) is Workspace.tsx's job, not
    // TableView's — this harness's `docs` prop is static, so the cell keeps
    // showing the pre-edit value until a real re-fetch replaces it. What
    // matters here is that the refresh callback actually fired.
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it('commits on blur too (not just Enter)', async () => {
    const updateCalls: unknown[] = [];
    installAtelierMock({
      doc: {
        updateOne: async (input) => {
          updateCalls.push(input);
          return { matchedCount: 1, modifiedCount: 1 };
        },
      },
    });
    const docs = [{ _id: 1, status: 'pending' }];
    const { getByTitle } = renderInlineEditHarness(docs);

    const cell = getByTitle(/Drag to add "status/);
    fireEvent.mouseEnter(cell);
    fireEvent.click(within(cell).getByRole('button', { name: 'Edit cell value' }));
    const input = within(cell).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'shipped' } });
    fireEvent.blur(input);

    await waitFor(() => expect(updateCalls.length).toBe(1));
  });

  it('Escape cancels the edit with no IPC call and restores the original value', () => {
    const updateCalls: unknown[] = [];
    installAtelierMock({
      doc: {
        updateOne: async (input) => {
          updateCalls.push(input);
          return { matchedCount: 1, modifiedCount: 1 };
        },
      },
    });
    const docs = [{ _id: 1, status: 'pending' }];
    const { getByTitle } = renderInlineEditHarness(docs);

    const cell = getByTitle(/Drag to add "status/);
    fireEvent.mouseEnter(cell);
    fireEvent.click(within(cell).getByRole('button', { name: 'Edit cell value' }));
    const input = within(cell).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'shipped' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(cell.textContent).toContain('pending');
    expect(updateCalls.length).toBe(0);
  });

  it('a trailing blur after Escape does not commit the cancelled draft', () => {
    // In real Chromium/Electron, cancelEdit's setEditing(false) unmounts the
    // focused <input>, and unmounting a focused element synchronously fires
    // a trailing `blur`. jsdom does NOT reproduce that unmount-triggered
    // blur, which is exactly why the plain "press Escape, assert no
    // updateOne" test above doesn't catch this bug. Reproduce the trailing
    // blur directly: dispatch the Escape keydown and the blur back-to-back
    // inside a single outer `act()`. `fireEvent`'s own per-call `act()`
    // wrapping nests inside ours (only the outermost `act()` flushes), so
    // React never gets a chance to re-render/unmount the input between the
    // two dispatches — `input` stays mounted for the blur, matching what a
    // real browser guarantees, and it still reaches React's delegated
    // `onBlur` (`commitEdit`) exactly as the browser would.
    const updateCalls: unknown[] = [];
    installAtelierMock({
      doc: {
        updateOne: async (input) => {
          updateCalls.push(input);
          return { matchedCount: 1, modifiedCount: 1 };
        },
      },
    });
    const docs = [{ _id: 1, status: 'pending' }];
    const { getByTitle } = renderInlineEditHarness(docs);

    const cell = getByTitle(/Drag to add "status/);
    fireEvent.mouseEnter(cell);
    fireEvent.click(within(cell).getByRole('button', { name: 'Edit cell value' }));
    const input = within(cell).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'shipped' } });

    act(() => {
      fireEvent.keyDown(input, { key: 'Escape' });
      fireEvent.blur(input);
    });

    expect(updateCalls.length).toBe(0);
    expect(cell.textContent).toContain('pending');
  });

  it('blur with an unchanged value commits nothing (no IPC call)', () => {
    const updateCalls: unknown[] = [];
    installAtelierMock({
      doc: {
        updateOne: async (input) => {
          updateCalls.push(input);
          return { matchedCount: 1, modifiedCount: 1 };
        },
      },
    });
    const docs = [{ _id: 1, status: 'pending' }];
    const { getByTitle } = renderInlineEditHarness(docs);

    const cell = getByTitle(/Drag to add "status/);
    fireEvent.mouseEnter(cell);
    fireEvent.click(within(cell).getByRole('button', { name: 'Edit cell value' }));
    const input = within(cell).getByRole('textbox') as HTMLInputElement;
    fireEvent.blur(input);

    expect(updateCalls.length).toBe(0);
  });

  it('the _id cell exposes no inline-edit pencil, even though its value renders as a string', () => {
    const docs = [{ _id: 'abc123', status: 'pending' }];
    const { getByTitle } = renderInlineEditHarness(docs);
    const cell = getByTitle(/Drag to add "_id/);
    fireEvent.mouseEnter(cell);
    expect(within(cell).queryByRole('button', { name: 'Edit cell value' })).toBeNull();
  });

  it('a number-sentinel cell exposes no inline-edit pencil (routes to the drawer to avoid BSON-type corruption)', () => {
    const docs = [{ _id: 1, amount: { $numberInt: '5' } }];
    const { getByTitle } = renderInlineEditHarness(docs);
    const cell = getByTitle(/Drag to add "amount/);
    fireEvent.mouseEnter(cell);
    expect(within(cell).queryByRole('button', { name: 'Edit cell value' })).toBeNull();
  });

  it('an ObjectId-sentinel cell exposes no inline-edit pencil', () => {
    const docs = [{ _id: 1, userId: { $oid: '507f1f77bcf86cd799439011' } }];
    const { getByTitle } = renderInlineEditHarness(docs);
    const cell = getByTitle(/Drag to add "userId/);
    fireEvent.mouseEnter(cell);
    expect(within(cell).queryByRole('button', { name: 'Edit cell value' })).toBeNull();
  });

  it('a computed dotted-path column exposes no inline-edit pencil (must never $set on the column label)', () => {
    const docs = [{ _id: 1, address: { city: 'Springfield' } }];
    const columnConfig: TableColumnConfig = {
      computed: [{ id: 'computed:address.city', path: 'address.city' }],
    };
    const { getByTitle } = renderInlineEditHarness(docs, { columnConfig });
    const cell = getByTitle('address.city');
    fireEvent.mouseEnter(cell);
    expect(within(cell).queryByRole('button', { name: 'Edit cell value' })).toBeNull();
  });

  it('a read-only provider shows no inline-edit pencil and no Duplicate menu item', () => {
    const docs = [{ _id: 1, status: 'pending' }];
    const { getByTitle, queryByText } = renderInlineEditHarness(docs, {
      metaOverrides: { isReadOnly: true },
    });
    const cell = getByTitle(/Drag to add "status/);
    fireEvent.mouseEnter(cell);
    expect(within(cell).queryByRole('button', { name: 'Edit cell value' })).toBeNull();

    fireEvent.contextMenu(cell);
    expect(queryByText('Duplicate document')).toBeNull();
  });

  it('a failed inline update surfaces user-visible error feedback, not a silent failure', async () => {
    installAtelierMock({
      doc: {
        updateOne: async () => {
          throw { code: 'SYSTEM_ERROR', message: 'boom' };
        },
      },
    });
    const docs = [{ _id: 1, status: 'pending' }];
    const { getByTitle } = renderInlineEditHarness(docs);

    const cell = getByTitle(/Drag to add "status/);
    fireEvent.mouseEnter(cell);
    fireEvent.click(within(cell).getByRole('button', { name: 'Edit cell value' }));
    const input = within(cell).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'shipped' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.getByText('boom')).toBeTruthy());
  });

  it('context menu "Duplicate document" calls actions.openDuplicate with the row document', () => {
    const openDuplicate = vi.fn();
    const docs = [{ _id: 1, status: 'pending' }];
    const { getByTitle, getByText } = renderInlineEditHarness(docs, { openDuplicate });

    const cell = getByTitle(/Drag to add "status/);
    fireEvent.contextMenu(cell);
    fireEvent.click(getByText('Duplicate document'));

    expect(openDuplicate).toHaveBeenCalledTimes(1);
    expect(openDuplicate).toHaveBeenCalledWith(docs[0]);
  });

  it('an in-flight edit does not commit to a different document when the result set swaps under it (N0.2)', async () => {
    const updateCalls: Array<{ filterJson: string; updateJson: string }> = [];
    installAtelierMock({
      doc: {
        updateOne: async (input) => {
          updateCalls.push(input);
          return { matchedCount: 1, modifiedCount: 1 };
        },
      },
    });
    const docsA = [{ _id: 1, status: 'pending' }];
    const docsB = [{ _id: 2, status: 'active' }];
    const { getByTitle, rerenderDocs } = renderRerenderableInlineEditHarness(docsA);

    const cell = getByTitle(/Drag to add "status/);
    fireEvent.mouseEnter(cell);
    fireEvent.click(within(cell).getByRole('button', { name: 'Edit cell value' }));
    const input = within(cell).getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('pending');
    fireEvent.change(input, { target: { value: 'shipped' } });

    // Simulate the documents array swapping out from under the still-open
    // editor (e.g. a re-run/refresh landing mid-edit — Workspace.tsx applies
    // the new `documents`/`lastRun` together, same as `rerenderDocs` here),
    // then the trailing blur a real unmount/refocus can fire once the swap
    // has landed. `rerenderDocs` lets the swap fully commit before the blur
    // fires (unlike the Escape+blur precedent above, which deliberately
    // nests both in one `act()` to catch the input BEFORE an unmount
    // commits) — this is what reproduces N0.2: without the fix, the swap's
    // re-render already rebinds this TableCell instance to doc `_id: 2`
    // while `editing`/`draft` survive, so the trailing blur's `commitEdit`
    // fires against the new doc with the stale, never-confirmed draft.
    rerenderDocs(docsB);
    fireEvent.blur(input);

    // No write should have landed on the new document (_id: 2) carrying the
    // stale "shipped" draft that was never committed against _id: 1.
    expect(updateCalls.length).toBe(0);

    // The guard must not be stuck: a fresh edit on the now-bound _id: 2 cell
    // still commits normally.
    const cellAfterSwap = getByTitle(/Drag to add "status/);
    fireEvent.mouseEnter(cellAfterSwap);
    fireEvent.click(within(cellAfterSwap).getByRole('button', { name: 'Edit cell value' }));
    const inputAfterSwap = within(cellAfterSwap).getByRole('textbox') as HTMLInputElement;
    expect(inputAfterSwap.value).toBe('active');
    fireEvent.change(inputAfterSwap, { target: { value: 'archived' } });
    fireEvent.keyDown(inputAfterSwap, { key: 'Enter' });

    await waitFor(() => expect(updateCalls.length).toBe(1));
    expect(JSON.parse(updateCalls[0]!.filterJson)).toEqual({ _id: 2 });
    expect(JSON.parse(updateCalls[0]!.updateJson)).toEqual({ $set: { status: 'archived' } });
  });
});
