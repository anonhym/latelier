// "Add to filter" right-click command on a field-tree row, the non-drag
// discovery path onto the Query Builder. Mounts `TreeView` /
// `TableView` directly against a `CollectionWorkspaceProvider`, mirroring
// `tree-view.spec.tsx` / `table-view.spec.tsx`'s existing mount pattern —
// lighter than a full `Workspace` render and gives direct control over
// `actions.patch` / `meta.isReadOnly`, which is all this handler touches.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { notifications } from '@mantine/notifications';
import { render, fireEvent, screen, waitFor, within } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TreeView } from '../../src/pages/Workspace/views/TreeView';
import { TableView } from '../../src/pages/Workspace/views/TableView';
import Workspace from '../../src/pages/Workspace';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import type {
  CollectionWorkspaceActions,
  CollectionWorkspaceMeta,
} from '../../src/pages/Workspace/context';
import type { CollectionTabState, WorkspaceTab } from '@shared/types';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { IpcApi } from '@shared/ipc';

function makeState(overrides: Partial<CollectionTabState> = {}): CollectionTabState {
  return {
    view: 'Tree',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    ...overrides,
  };
}

function makeActions(overrides: Partial<CollectionWorkspaceActions> = {}): CollectionWorkspaceActions {
  return {
    patch: vi.fn(),
    patchWith: vi.fn(),
    run: vi.fn(),
    openEdit: vi.fn(),
    openDelete: vi.fn(),
    openDeleteAll: vi.fn(),
    openInsert: vi.fn(),
    openSave: vi.fn(),
    expandBuilder: vi.fn(),
    ...overrides,
  };
}

function makeMeta(overrides: Partial<CollectionWorkspaceMeta> = {}): CollectionWorkspaceMeta {
  return {
    connectionId: 'c1',
    dbName: 'app',
    collection: 'orders',
    tabId: 't1',
    isLoading: false,
    ...overrides,
  };
}

const DOC_OID = '507f1f77bcf86cd799439011';
const DOC = { _id: { $oid: DOC_OID }, name: 'alpha' };
// Expansion state is keyed by `getFullDocId` (the full `$oid`), not the
// short 8-char label the collapsed row displays — see `docId.ts`.
const EXPANDED = { [DOC_OID]: true };

// "Add to filter" confirms before patching whenever the Filter/Builder tab
// is open (the default in `makeState` below), since the drawer mounted
// there can hold local-only edits the tab state doesn't know about. Every
// test that expects the add to actually go through clicks past this dialog
// first.
async function confirmAdd() {
  fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
}

/**
 * X19 #68/#69 — `TreeView` and `TableView` reach the *same* field menu: both
 * render a `DocFieldTree`, and the menu belongs to that tree, not to either
 * view. The two copies of this block were identical apart from which view
 * `mount` rendered, and SonarCloud measured the file at 47.9% duplication.
 * Declared once here and called from inside each view's own `describe`, so
 * each still runs against its own mount.
 *
 * `userEvent`, not `fireEvent`, per #68's own acceptance — `fireEvent` does
 * no focus management at all, which is how #20's defect survived 48 passing
 * tests. The one `fireEvent.keyDown` below is deliberate: the ContextMenu
 * key has no `userEvent` spelling.
 */
function describeFieldMenuKeyboardAndFocusReturn(
  mount: () => { container: HTMLElement },
): void {
  // "name" is also a table *column*, whose cell carries the same "Drag to
  // add" title as the field-tree row — so the row query is scoped to the
  // field-tree panel rather than the whole document, for both views.
  const fieldTreeOf = (container: HTMLElement) =>
    container.querySelector('[data-expanded-doc-section="true"]') as HTMLElement;
  const rowOf = (container: HTMLElement) =>
    within(fieldTreeOf(container)).getByTitle(/Drag to add "name/);

  describe('keyboard open and focus return (#68/#69)', () => {
    it('Shift+F10 opens the menu with all three items reachable, and Escape returns focus to the field tree', async () => {
      const user = userEvent.setup();
      const { container } = mount();
      const fieldTree = fieldTreeOf(container);

      await user.click(fieldTree);
      await user.keyboard('{Shift>}{F10}{/Shift}');

      expect(await screen.findByText('Copy value')).toBeTruthy();
      expect(screen.getByText('Copy field path')).toBeTruthy();
      expect(screen.getByText('Add to filter')).toBeTruthy();
      // Focus entered the menu on open — keyboard-only (#69), unlike the
      // mouse path below.
      await waitFor(() =>
        expect(document.activeElement?.closest('[role="group"]')).toBeTruthy(),
      );

      await user.keyboard('{Escape}');

      await waitFor(() => expect(document.activeElement).toBe(fieldTree));
    });

    it('the ContextMenu key opens the same menu', async () => {
      const { container } = mount();

      fireEvent.keyDown(fieldTreeOf(container), { key: 'ContextMenu' });

      expect(await screen.findByText('Copy value')).toBeTruthy();
    });

    // #69 — one mechanism for both open paths: a right-click still does not
    // grab focus into the menu, but Escape now has somewhere real to send
    // focus back to instead of stranding it on `<body>`.
    it('a right-click on a field row, then Escape, returns focus to the field tree — not <body>', async () => {
      const user = userEvent.setup();
      const { container } = mount();
      const fieldTree = fieldTreeOf(container);

      await user.pointer({ keys: '[MouseRight]', target: rowOf(container) });
      expect(await screen.findByText('Copy value')).toBeTruthy();
      // Unchanged from before #69: a mouse open does not steal focus.
      expect(document.activeElement?.closest('[role="group"]')).toBeNull();

      await user.keyboard('{Escape}');

      await waitFor(() => {
        expect(document.activeElement).not.toBe(document.body);
        expect(document.activeElement).toBe(fieldTree);
      });
    });
  });
}


describe(' "Add to filter" on the field-tree context menu', () => {
  // Mantine's notification queue is a module-level singleton, not
  // component state — a toast fired in one test otherwise lingers into the
  // next, which turns `findByText` into a multi-match failure for the two
  // "Nothing added" cases (TreeView's and TableView's) below.
  afterEach(() => {
    notifications.clean();
  });

  describe('TreeView', () => {
    function mount(opts: {
      state?: Partial<CollectionTabState>;
      actions?: Partial<CollectionWorkspaceActions>;
      meta?: Partial<CollectionWorkspaceMeta>;
      doc?: Record<string, unknown>;
    } = {}) {
      const actions = makeActions(opts.actions);
      return {
        actions,
        ...render(
          <CollectionWorkspaceProvider
            state={makeState(opts.state)}
            actions={actions}
            meta={makeMeta(opts.meta)}
          >
            <TreeView
              documents={[opts.doc ?? DOC]}
              expandedRows={EXPANDED}
              onSelect={() => {}}
              onRowExpand={() => {}}
            />
          </CollectionWorkspaceProvider>,
        ),
      };
    }

    it('is present on a field-tree row and adds a root-level condition when invoked', async () => {
      const { actions } = mount();

      fireEvent.contextMenu(screen.getByTitle(/Drag to add "name/));
      const item = screen.getByText('Add to filter');
      fireEvent.click(item);
      await confirmAdd();

      await waitFor(() => expect(actions.patch).toHaveBeenCalledTimes(1));
      expect(actions.expandBuilder).toHaveBeenCalled();
      const patched = (actions.patch as ReturnType<typeof vi.fn>).mock.calls[0][0] as Partial<CollectionTabState>;
      expect(JSON.parse(patched.queryRaw!)).toEqual({ name: { $eq: 'alpha' } });
    });

    it('adds to the existing root filter alongside what is already there', async () => {
      const { actions } = mount({ state: { queryRaw: '{"status":{"$eq":"active"}}' } });

      fireEvent.contextMenu(screen.getByTitle(/Drag to add "name/));
      fireEvent.click(screen.getByText('Add to filter'));
      await confirmAdd();

      await waitFor(() => expect(actions.patch).toHaveBeenCalledTimes(1));
      const patched = (actions.patch as ReturnType<typeof vi.fn>).mock.calls[0][0] as Partial<CollectionTabState>;
      expect(JSON.parse(patched.queryRaw!)).toEqual({
        $and: [{ status: { $eq: 'active' } }, { name: { $eq: 'alpha' } }],
      });
    });

    it('cancelling the confirm leaves the filter untouched', async () => {
      // Patching `state.queryRaw` directly can silently discard newer,
      // local-only input the Filter drawer holds (a pending or
      // print-blocked row) — there's no signal for whether it actually has
      // one, only for whether the drawer is mounted at all, so this
      // confirms whenever the Filter tab is open.
      const { actions } = mount();

      fireEvent.contextMenu(screen.getByTitle(/Drag to add "name/));
      fireEvent.click(screen.getByText('Add to filter'));
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

      await new Promise((r) => setTimeout(r, 0));
      expect(actions.patch).not.toHaveBeenCalled();
    });

    it('does not confirm at all when the Filter tab isn\'t open — nothing there to lose', async () => {
      // The drawer unmounts (`keepMounted={false}`) the moment the user
      // leaves the Filter tab, so there's no local-only state to protect.
      const { actions } = mount({ state: { activeBuilderTab: 'Saved' } });

      fireEvent.contextMenu(screen.getByTitle(/Drag to add "name/));
      fireEvent.click(screen.getByText('Add to filter'));

      await waitFor(() => expect(actions.patch).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    });

    it('is not rendered when the tab is read-only', () => {
      const { actions } = mount({ meta: { isReadOnly: true } });

      fireEvent.contextMenu(screen.getByTitle(/Drag to add "name/));

      expect(screen.queryByText('Add to filter')).toBeNull();
      expect(actions.patch).not.toHaveBeenCalled();
    });

    it('is disabled (not silently no-op) when the query bar holds unparsable JSON', () => {
      // Disabled + titled, not silently enabled and toast-on-click: a click
      // that never does anything reads as broken, not as "there's nothing
      // to add to."
      const { actions } = mount({ state: { queryRaw: 'not json' } });

      fireEvent.contextMenu(screen.getByTitle(/Drag to add "name/));
      const item = screen.getByText('Add to filter');

      expect((item.closest('button') as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(item);
      expect(actions.patch).not.toHaveBeenCalled();
    });

    it('is not offered on a field whose value is undefined — nothing there to add', () => {
      const { actions } = mount({ doc: { _id: DOC._id, ghost: undefined } });

      // An undefined-valued row has no `title` — it's no longer draggable,
      // so it no longer advertises "Drag to add". Select by field-name text
      // instead of the (absent) title.
      const row = screen.getByText('ghost').closest('[draggable]');
      expect(row?.getAttribute('draggable')).toBe('false');
      fireEvent.contextMenu(row!);

      expect(screen.queryByText('Add to filter')).toBeNull();
      expect(actions.patch).not.toHaveBeenCalled();
    });

    describeFieldMenuKeyboardAndFocusReturn(mount);
  });

  describe('TableView', () => {
    function mount(opts: {
      state?: Partial<CollectionTabState>;
      actions?: Partial<CollectionWorkspaceActions>;
      meta?: Partial<CollectionWorkspaceMeta>;
      doc?: Record<string, unknown>;
    } = {}) {
      const actions = makeActions(opts.actions);
      return {
        actions,
        ...render(
          <CollectionWorkspaceProvider
            state={makeState(opts.state)}
            actions={actions}
            meta={makeMeta(opts.meta)}
          >
            <TableView
              documents={[opts.doc ?? DOC]}
              onColumnResize={() => {}}
              expandedRows={EXPANDED}
              onRowExpand={() => {}}
            />
          </CollectionWorkspaceProvider>,
        ),
      };
    }

    // "name" is also a table *column* — its cell carries the same "Drag to
    // add" title as the field-tree row inside the expanded panel — so the
    // query must be scoped to `[data-expanded-doc-section]`, the field-tree
    // panel's own wrapper, not the whole document.
    function fieldTreeRow(container: HTMLElement, field = 'name') {
      const panel = container.querySelector('[data-expanded-doc-section="true"]');
      if (!panel) throw new Error('no expanded field-tree panel rendered');
      return within(panel as HTMLElement).getByTitle(new RegExp(`Drag to add "${field}`));
    }

    it('is present on a field-tree row (inside an expanded row panel) and adds a root-level condition', async () => {
      const { actions, container } = mount();

      fireEvent.contextMenu(fieldTreeRow(container));
      fireEvent.click(screen.getByText('Add to filter'));
      await confirmAdd();

      await waitFor(() => expect(actions.patch).toHaveBeenCalledTimes(1));
      expect(actions.expandBuilder).toHaveBeenCalled();
      const patched = (actions.patch as ReturnType<typeof vi.fn>).mock.calls[0][0] as Partial<CollectionTabState>;
      expect(JSON.parse(patched.queryRaw!)).toEqual({ name: { $eq: 'alpha' } });
    });

    it('is not rendered when the tab is read-only', () => {
      const { container } = mount({ meta: { isReadOnly: true } });

      fireEvent.contextMenu(fieldTreeRow(container));

      expect(screen.queryByText('Add to filter')).toBeNull();
    });

    it('is disabled (not silently no-op) when the query bar holds unparsable JSON', () => {
      const { actions, container } = mount({ state: { queryRaw: 'not json' } });

      fireEvent.contextMenu(fieldTreeRow(container));
      const item = screen.getByText('Add to filter');

      expect((item.closest('button') as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(item);
      expect(actions.patch).not.toHaveBeenCalled();
    });

    it('is not offered on a field whose value is undefined — nothing there to add', () => {
      const { actions, container } = mount({ doc: { _id: DOC._id, ghost: undefined } });

      // Same as TreeView's case above: the crash fix removed the `title`
      // for an undefined-valued row, so it's selected by its field-name
      // text within the expanded field-tree panel instead.
      const panel = container.querySelector('[data-expanded-doc-section="true"]');
      if (!panel) throw new Error('no expanded field-tree panel rendered');
      const row = within(panel as HTMLElement).getByText('ghost').closest('[draggable]');
      expect(row?.getAttribute('draggable')).toBe('false');
      fireEvent.contextMenu(row!);

      expect(screen.queryByText('Add to filter')).toBeNull();
      expect(actions.patch).not.toHaveBeenCalled();
    });

    describeFieldMenuKeyboardAndFocusReturn(mount);
  });

  describe('TableView cell-level menu', () => {
    // Parity with the field-panel menu above: the cell-level menu
    // (right-click a cell directly, no expand-first step) is arguably the
    // *more* discoverable surface for the same action, so it gets the same
    // three-case coverage (present+works, hidden read-only, hidden on an
    // undefined value).
    function mount(opts: {
      state?: Partial<CollectionTabState>;
      actions?: Partial<CollectionWorkspaceActions>;
      meta?: Partial<CollectionWorkspaceMeta>;
      doc?: Record<string, unknown>;
    } = {}) {
      const actions = makeActions(opts.actions);
      return {
        actions,
        ...render(
          <CollectionWorkspaceProvider
            state={makeState(opts.state)}
            actions={actions}
            meta={makeMeta(opts.meta)}
          >
            <TableView
              documents={[opts.doc ?? DOC]}
              onColumnResize={() => {}}
              expandedRows={{}}
              onRowExpand={() => {}}
            />
          </CollectionWorkspaceProvider>,
        ),
      };
    }

    it('is present on a table cell and adds a root-level condition, with no row expansion needed', async () => {
      const { actions } = mount();

      fireEvent.contextMenu(screen.getByTitle(/Drag to add "name/));
      fireEvent.click(screen.getByText('Add to filter'));
      await confirmAdd();

      await waitFor(() => expect(actions.patch).toHaveBeenCalledTimes(1));
      expect(actions.expandBuilder).toHaveBeenCalled();
      const patched = (actions.patch as ReturnType<typeof vi.fn>).mock.calls[0][0] as Partial<CollectionTabState>;
      expect(JSON.parse(patched.queryRaw!)).toEqual({ name: { $eq: 'alpha' } });
    });

    it('is not rendered when the tab is read-only', () => {
      const { actions } = mount({ meta: { isReadOnly: true } });

      fireEvent.contextMenu(screen.getByTitle(/Drag to add "name/));

      expect(screen.queryByText('Add to filter')).toBeNull();
      expect(actions.patch).not.toHaveBeenCalled();
    });

    it('is disabled (not silently no-op) when the query bar holds unparsable JSON', () => {
      const { actions } = mount({ state: { queryRaw: 'not json' } });

      fireEvent.contextMenu(screen.getByTitle(/Drag to add "name/));
      const item = screen.getByText('Add to filter');

      expect((item.closest('button') as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(item);
      expect(actions.patch).not.toHaveBeenCalled();
    });

    it('is not offered on a cell whose value is undefined — nothing there to add', () => {
      const { actions } = mount({ doc: { _id: DOC._id, ghost: undefined } });

      // The cell for an undefined value has no `title` (that's what gates
      // draggability), so it's found by its rendered content instead — the
      // literal string "undefined" `String(display)` renders. `getByText`
      // resolves to the data cell, not the "ghost" column header, since
      // only the cell's own text is "undefined".
      fireEvent.contextMenu(screen.getByText('undefined'));

      expect(screen.queryByText('Add to filter')).toBeNull();
      expect(actions.patch).not.toHaveBeenCalled();
    });
  });

  // The two describe blocks above mount `TreeView`/`TableView` directly
  // against a mocked `actions.patch`, which proves the handler *calls*
  // patch with the right shape but not that the write survives real
  // `useWorkspaceTabs` state (two patches in the same tick — expandBuilder
  // then queryRaw — is exactly where a non-functional update could clobber
  // one). This block mounts the real `Workspace` (mirrors
  // `builder-drag-merge-replace.spec.tsx`) and reads back through the
  // debounced `api.tabs.update` call, the same way the drag path is
  // covered end-to-end.
  describe('end-to-end via the real Workspace state', () => {
    const now = '2026-08-20T12:00:00.000Z';

    function makeCollectionTab(state: CollectionTabState): WorkspaceTab {
      return {
        id: 't1',
        kind: 'collection',
        connectionId: 'c1',
        dbName: 'mydb',
        collection: 'users',
        position: 0,
        isActive: true,
        openedAt: now,
        pinned: false,
        state,
      };
    }

    const CONNECTION = {
      id: 'c1',
      name: 'Local',
      color: '#1A6835',
      host: 'localhost',
      port: 27017,
      connectionType: 'standard' as const,
      readOnly: false,
      status: 'connected' as const,
    };

    /** Most recent `queryRaw` written via `api.tabs.update`, if any. */
    function lastWrittenQueryRaw(updateSpy: ReturnType<typeof vi.fn>): string | undefined {
      for (let i = updateSpy.mock.calls.length - 1; i >= 0; i--) {
        const arg = updateSpy.mock.calls[i]?.[1] as { state?: Partial<CollectionTabState> } | undefined;
        const patch = arg?.state;
        if (patch && 'queryRaw' in patch) return patch.queryRaw;
      }
      return undefined;
    }

    function mountWith(state: CollectionTabState) {
      const updateSpy = vi.fn(async () => makeCollectionTab(state));
      installAtelierMock({
        tabs: {
          list: async () => [makeCollectionTab(state)],
          setActive: async (id) => ({ id }),
          update: updateSpy as unknown as IpcApi['tabs']['update'],
        },
        conn: { list: async () => [CONNECTION] },
        query: { find: vi.fn(async () => ({ documents: [], durationMs: 1, hasMore: false })), count: async () => ({ count: 0 }) },
      });
      const utils = render(
        <MemoryRouter initialEntries={['/workspace']}>
          <Workspace />
        </MemoryRouter>,
      );
      return { ...utils, updateSpy };
    }

    afterEach(() => {
      uninstallAtelierMock();
      vi.restoreAllMocks();
    });

    it('a real "Add to filter" click reaches persisted state, and a second add reads the freshly-patched filter rather than a stale one', async () => {
      const state: CollectionTabState = {
        view: 'Tree',
        builder: { projection: [], sort: '', limit: '' },
        queryRaw: '{}',
        page: 0,
        pageSize: 50,
        activeBuilderTab: 'Builder',
        lastRun: {
          documents: [{ _id: { $oid: DOC_OID }, name: 'alpha', role: 'admin' }],
          durationMs: 2,
          ranAt: now,
        },
      };
      const { updateSpy } = mountWith(state);

      // Expand the doc row, then right-click "name" and add it.
      const expandBtn = await screen.findByRole('button', { name: 'Expand document' });
      fireEvent.click(expandBtn);
      fireEvent.contextMenu(await screen.findByTitle(/Drag to add "name/));
      fireEvent.click(screen.getByText('Add to filter'));
      await confirmAdd();

      await waitFor(() => {
        expect(lastWrittenQueryRaw(updateSpy)).toBeDefined();
        expect(JSON.parse(lastWrittenQueryRaw(updateSpy)!)).toEqual({ name: { $eq: 'alpha' } });
      });

      // Second add, on "role" — the base filter it reads must be the
      // just-patched `{name: ...}`, not the original empty `{}` from
      // props/closure, or this would print `{role: ...}` instead of merging.
      fireEvent.contextMenu(await screen.findByTitle(/Drag to add "role/));
      fireEvent.click(screen.getByText('Add to filter'));
      await confirmAdd();

      await waitFor(() => {
        expect(JSON.parse(lastWrittenQueryRaw(updateSpy)!)).toEqual({
          $and: [{ name: { $eq: 'alpha' } }, { role: { $eq: 'admin' } }],
        });
      });
    });
  });
});
