import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act, within } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import { commandRegistry } from '../../src/commands/registry';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { CollectionTabState, WorkspaceTab } from '@shared/types';
import type { IpcApi } from '@shared/ipc';
import { openQueriesTab } from '../helpers/queriesPopover';

const now = '2026-08-02T12:00:00.000Z';

function makeState(overrides: Partial<CollectionTabState> = {}): CollectionTabState {
  return {
    view: 'Tree',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    // Seeded so the auto-run-on-open effect doesn't fire a background
    // find and desynchronize the call-count assertions below.
    lastRun: { documents: [], durationMs: 0, ranAt: now },
    ...overrides,
  };
}

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

/**
 * Mount Workspace over a single collection tab holding `state`. Returns the
 * `find` spy and the `tabs.update` spy — the latter is how we observe what a
 * UI interaction actually persisted, since tab state is written through IPC.
 */
function mountWith(
  state: CollectionTabState,
  prefs: Record<string, unknown> = {},
) {
  const findSpy = vi.fn<IpcApi['query']['find']>(async () => ({
    documents: [],
    durationMs: 3,
    hasMore: false,
  }));
  const confirmDeleteManySpy = vi.fn<IpcApi['doc']['confirmDeleteMany']>(async () => ({
    count: 0,
    confirmToken: 'tok',
  }));
  const updateSpy = vi.fn(async () => makeCollectionTab(state));

  installAtelierMock({
    tabs: {
      list: async () => [makeCollectionTab(state)],
      setActive: async (id) => ({ id }),
      update: updateSpy as unknown as IpcApi['tabs']['update'],
    },
    conn: { list: async () => [CONNECTION] },
    prefs: {
      // Open unless a test stores otherwise: most of these are about the drawer.
      get: async (key: string) => ({ 'ui.workspace.builderCollapsed': false, ...prefs })[key] ?? null,
      set: async () => undefined,
    } as unknown as IpcApi['prefs'],
    query: { find: findSpy, count: async () => ({ count: 0 }) },
    doc: { confirmDeleteMany: confirmDeleteManySpy } as unknown as IpcApi['doc'],
  });

  const utils = render(
    <MemoryRouter initialEntries={['/workspace']}>
      <Workspace />
    </MemoryRouter>,
  );
  return { ...utils, findSpy, confirmDeleteManySpy, updateSpy };
}

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

// ─── blank or invalid filter text (W13-updated) ────────────────────────────
//
// Pre-W13, this block covered a builder condition the compiler couldn't
// encode (e.g. `$elemMatch`), which still compiled to syntactically-valid,
// semantically-wrong EJSON. W13 deletes that whole failure class: the
// drawer's raw-node degradation (§2) means an `$elemMatch` clause is now just
// ordinary `queryRaw` text, valid and runnable. What's left of that case is the
// blank/invalid-text refusal — `currentFilterJson` returning `null` — and
// this block now covers that instead, through the two paths that don't go
// through a disableable button: the command palette, and delete-all.
describe(' a blank or invalid filter text has no runnable filter', () => {
  it('the runner refuses even when invoked with no button to disable', async () => {
    // Disabling the Run button isn't enough — `query.run` (palette / ⌘↵)
    // calls the runner directly, bypassing the button's disabled state
    // entirely. The guard has to live in the runner itself.
    const { findSpy } = mountWith(makeState({ queryRaw: '   ' }));

    await screen.findByTestId('query-run-btn');
    const ctx = { pathname: '/workspace', connectionId: 'c1' };
    const runCmd = commandRegistry.list().find((c) => c.id === 'query.run');
    expect(runCmd).toBeDefined();

    act(() => {
      void runCmd!.perform(ctx);
    });

    await waitFor(() => {
      // `filterProblem`'s own message, in the pane the refused run left
      // empty: blank text is a missing filter.
      expect(screen.getByTestId('error-details').textContent).toMatch(/^VALIDATION: Enter a filter, like/);
    });
    expect(findSpy).not.toHaveBeenCalled();
  });

  it('delete-all refuses to arm on blank filter text — the confirm dialog never mounts', async () => {
    // This is the regression proof for the ticket's `currentFilterJson`
    // contract: if a `?? '{}'`-shaped fallback ever crept into
    // `openDeleteAllModal`'s guard or `currentFilterJson` itself, this test
    // would instead see the confirm dialog mount (and, given more time,
    // `doc.confirmDeleteMany` fire against the whole collection). Assert on
    // the dialog's absence — not the toast wording — so a message reword
    // can't silently defang the guard.
    const { confirmDeleteManySpy } = mountWith(makeState({ queryRaw: '   ' }));

    const overflow = await screen.findByRole('button', { name: 'More actions' });
    fireEvent.click(overflow);
    const deleteAllItem = await screen.findByRole('menuitem', { name: /Delete matching/ });
    fireEvent.click(deleteAllItem);

    // Give the (wrongly) armed modal a tick to mount, then assert it didn't.
    // Matches DeleteConfirm's dialog title exactly ("Delete matching
    // documents?" / "Delete N matching document(s)?") rather than a bare
    // "matching document" substring, which also appears in the result bar's
    // own empty-results text ("No matching documents") and would false-pass.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/^Delete .*matching document/)).toBeNull();
    expect(confirmDeleteManySpy).not.toHaveBeenCalled();
  });
});

// ─── builder edits do not clobber a hand-edited filter ─────────────────────

describe(' builder edits do not clobber a hand-edited filter', () => {
  const HAND_WRITTEN_RAW = '{"$expr":{"$gt":["$a","$b"]}}';

  it('a drawer edit leaves the hand-written filter in the bar', async () => {
    mountWith(makeState({ queryRaw: HAND_WRITTEN_RAW }));

    // "add condition…" is the drawer's own affordance — the interaction most
    // likely to happen right after someone hand-writes a filter.
    const addCond = await screen.findByRole('button', { name: 'Add condition' });
    fireEvent.click(addCond);

    // The pending row renders…
    await waitFor(() => {
      expect(screen.getByPlaceholderText('field')).toBeTruthy();
    });
    // …and a pending row (§5) never writes `queryRaw` — the bar still holds
    // exactly the text the user typed.
    const textarea = (await screen.findByTestId('query-bar-input')) as HTMLTextAreaElement;
    expect(textarea.value).toBe(HAND_WRITTEN_RAW);
  });

  it('removing the last condition collapses the filter to {} in the bar', async () => {
    // W13 deletes the SYNCED/DIRTY distinction entirely (spec §5, §6a): the
    // drawer always writes straight to `queryRaw` through `printFilter`,
    // seeded from `queryRaw` alone — `builder.conditions` plays no part in
    // what the drawer renders.
    mountWith(makeState({ queryRaw: '{"name":{"$eq":"alice"}}' }));

    const textarea = (await screen.findByTestId('query-bar-input')) as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value).toBe('{"name":{"$eq":"alice"}}'));

    fireEvent.click(await screen.findByRole('button', { name: 'Remove condition name' }));

    await waitFor(() => {
      expect(textarea.value).toBe('{}');
    });
  });
});

// ─── one SaveModal, owned above the builder pane ───────────────────────────

describe(' one SaveModal, owned above the builder pane', () => {
  // X15 T5 moved SaveModal onto a Mantine `Modal`, so its panel now lives in a
  // portal on `document.body` rather than beside the builder. The Name field
  // stays the reliable per-instance marker — it is an accessible query, so it
  // counts mounted modals wherever they render.
  const mountedSaveModals = () => screen.queryAllByLabelText(/Name/).length;

  it('exactly one Save button renders in the Documents view, and it carries the save hint anchor', async () => {
    mountWith(makeState());

    // The toolbar's Save exists…
    await screen.findByRole('button', { name: /^Save$/ });
    // …and the drawer footer's copy is gone rather than just hidden —
    // `queryAllByRole` over the whole rendered tree, not a scoped query, so a
    // stray second Save anywhere in the Documents view would fail this.
    expect(screen.queryAllByRole('button', { name: /^Save$/ })).toHaveLength(1);

    // The `saved.create` feature hint moved with the toolbar Save.
    expect(document.querySelectorAll('[data-hint-anchor="saved.create"]')).toHaveLength(1);
  });

  it('the toolbar Save opens exactly one modal', async () => {
    mountWith(makeState());

    // The toolbar button is labelled by its visible text, not an aria-label —
    // it is the only Save button left; the builder-drawer footer's copy is
    // gone.
    const toolbarSave = await screen.findByRole('button', { name: /^Save$/ });
    expect(mountedSaveModals()).toBe(0);
    fireEvent.click(toolbarSave);

    await waitFor(() => expect(mountedSaveModals()).toBe(1));
  });

  it('the query.save command survives a collapsed builder pane', async () => {
    // The behavioural half of the fix: `query.save` used to be registered
    // inside BuilderPane, which is unmounted while collapsed — so the palette
    // command silently vanished exactly when the drawer's own Save button was
    // also unreachable. The toolbar Save lives in QueryBar, outside
    // BuilderPane, so it — and the command — survive the collapse.
    mountWith(makeState(), { 'ui.workspace.builderCollapsed': true });

    await screen.findByRole('button', { name: /^Save$/ });

    const ctx = { pathname: '/workspace', connectionId: 'c1' };
    const saveCmd = commandRegistry.list().find((c) => c.id === 'query.save');
    expect(saveCmd).toBeDefined();
    expect(saveCmd!.when?.(ctx) ?? true).toBe(true);

    act(() => {
      void saveCmd!.perform(ctx);
    });
    await waitFor(() => expect(mountedSaveModals()).toBe(1));
  });
});

// ─── History works with the builder drawer collapsed ───────────────────────
//
// History used to be a tab of the drawer, so its button had to expand the
// drawer first. It is a popover of the Filter Bar row now (W05 §9.6): the
// drawer's state has nothing to do with it and is left as it was.

describe(' History works with the builder drawer collapsed', () => {
  it('opens its list over a collapsed drawer, which stays collapsed', async () => {
    mountWith(makeState(), { 'ui.workspace.builderCollapsed': true });

    // Collapsed: BuilderPane is not mounted, so its tab strip is absent.
    await screen.findByTestId('query-bar-saved-btn');
    await waitFor(() => {
      expect(screen.queryByRole('tab', { name: 'Filter' })).toBeNull();
    });

    await openQueriesTab('History');

    expect(await screen.findByRole('textbox', { name: 'Search recent queries' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Filter' })).toBeNull();
  });

  it('opens its list beside an open drawer, which keeps its filter', async () => {
    mountWith(makeState(), { 'ui.workspace.builderCollapsed': false });

    await screen.findByRole('button', { name: 'Reset' });
    await openQueriesTab('History');

    expect(await screen.findByRole('textbox', { name: 'Search recent queries' })).toBeTruthy();
    // The Inspector's two tabs, and they did not move.
    const drawerTabs = within(screen.getByRole('tablist', { name: 'Inspector view' })).getAllByRole('tab');
    expect(drawerTabs.map((tab) => tab.textContent)).toEqual(['Filter', 'Plan']);
    expect(screen.getByRole('button', { name: 'Reset' })).toBeTruthy();
  });
});

// ─── W13 §7 ──────────────────────────────────────────────────────────────────

describe('W13 §7 — single owner, single Run', () => {
  it('exactly one Run button renders in the Documents view', async () => {
    mountWith(makeState());

    // The bar's Run exists…
    await screen.findByTestId('query-run-btn');
    // …and the drawer's is gone rather than just hidden — `getAllByTestId`
    // over the whole rendered tree, not a scoped query, so a stray second
    // Run anywhere in the Documents view would fail this.
    expect(screen.queryAllByTestId('builder-run-btn')).toHaveLength(0);
  });

  it('⌘/Ctrl+Enter runs from inside a drawer input, not just the query bar', async () => {
    // Removing BuilderPane's footer Run (§7) only costs no reach if ⌘↵
    // actually reaches drawer inputs — prove it by dispatching the key event
    // on a real drawer input (the condition row's field TextInput, which
    // renders entirely inside BuilderPane), not on `document` or the query
    // bar's own textarea.
    const { findSpy } = mountWith(makeState());

    const addCond = await screen.findByRole('button', { name: 'Add condition' });
    fireEvent.click(addCond);
    const fieldInput = await screen.findByPlaceholderText('field');
    expect(findSpy).not.toHaveBeenCalled();

    fireEvent.keyDown(fieldInput, { key: 'Enter', metaKey: true });

    await waitFor(() => expect(findSpy).toHaveBeenCalledTimes(1));
  });

  it('⌘/Ctrl+Enter from a drawer input stays inert when the bar holds invalid JSON', async () => {
    // Same rule, same button, two entry points: the bar's own Run is
    // disabled here (`isValidEjson` fails), so a drawer input's ⌘↵ must be
    // inert too — otherwise the drawer becomes a second Run under a looser
    // rule than the bar's, which is the exact defect this section exists to kill.
    //
    // W13 §6a freezes the drawer read-only while the bar holds invalid
    // JSON — every add/edit control is disabled, so there's no editable
    // condition row to dispatch on here. The "Filter" tab button is still
    // inside the Documents view the ⌘↵ handler covers (`PanelBody`'s panel
    // group) and stays enabled even while frozen, so it still proves the
    // handler is reachable — and inert — from within the drawer.
    const { findSpy } = mountWith(makeState({ queryRaw: 'not valid json{{{' }));

    const runBtn = await screen.findByTestId('query-run-btn');
    expect(runBtn).toHaveProperty('disabled', true);

    await screen.findByText(/isn't valid JSON/);
    const filterTabBtn = screen.getByRole('tab', { name: 'Filter' });

    fireEvent.keyDown(filterTabBtn, { key: 'Enter', metaKey: true });

    // Give any (wrongly) queued run a tick to land, then assert it didn't.
    await new Promise((r) => setTimeout(r, 0));
    expect(findSpy).not.toHaveBeenCalled();
  });
});

// ─── ⌘↵ from anywhere in the Documents view ──────────────────────────────
//
// The key used to be bound to the filter textarea and the drawer root only,
// so after dragging a field from the results into the drawer — focus stays
// on the result row — ⌘↵ did nothing. One handler on the panel group now
// covers the whole view, and repairs every draft before it gates.
describe('W13 §7 — ⌘↵ runs from anywhere in the Documents view', () => {
  const DOC = { _id: '1', sku: 'widget' };
  const cmdEnter = { key: 'Enter', metaKey: true };

  it('runs once from the result tree without expanding the focused row', async () => {
    const { findSpy } = mountWith(
      makeState({ lastRun: { documents: [DOC], durationMs: 0, ranAt: now } }),
    );
    const tree = await screen.findByRole('tree', { name: 'Documents' });

    fireEvent.keyDown(tree, cmdEnter);

    // Checked before the run lands, whose empty result unmounts the row. The
    // tree's own Enter expands the active row; ⌘↵ must not also do that.
    expect(within(tree).queryByRole('button', { name: 'Collapse document' })).toBeNull();
    await waitFor(() => expect(findSpy).toHaveBeenCalledTimes(1));
  });

  it('runs once from the result table without toggling the row selection', async () => {
    const { findSpy } = mountWith(
      makeState({ view: 'Table', lastRun: { documents: [DOC], durationMs: 0, ranAt: now } }),
    );
    const grid = await screen.findByRole('grid');
    act(() => grid.focus()); // focus makes the first row the active one

    fireEvent.keyDown(grid, cmdEnter);

    // Checked before the run lands: its empty result would clear a selection
    // anyway. The table's own ⌘+Space (and, before, ⌘+Enter) toggles it.
    expect(screen.queryByTestId('selection-bar-count')).toBeNull();
    await waitFor(() => expect(findSpy).toHaveBeenCalledTimes(1));
  });

  it('repairs a Shell Syntax sort that was never blurred, and runs it', async () => {
    const { findSpy } = mountWith(
      makeState({ builder: { projection: [], sort: '{sku: 1}', limit: '' } }),
    );

    // From the pill, which is in the Documents view and not in a dialog.
    fireEvent.keyDown(await screen.findByTestId('option-pill-sort'), { key: 'Enter', ctrlKey: true });

    await waitFor(() => expect(findSpy).toHaveBeenCalledTimes(1));
    expect(findSpy.mock.calls[0][0].sort).toBe('{"sku": 1}');
  });

  // The pill's editor sits in a popover, a dialog the panel-level ⌘↵ skips —
  // so the popover runs this one itself, with what was just typed.
  it('repairs and runs a sort typed in its pill\'s editor, on ⌘↵ there', async () => {
    const { findSpy } = mountWith(makeState());
    fireEvent.click(await screen.findByTestId('option-pill-sort'));
    const sort = await screen.findByTestId('query-bar-sort');

    fireEvent.change(sort, { target: { value: '{sku: -1}' } });
    fireEvent.keyDown(sort, cmdEnter);

    await waitFor(() => expect(findSpy).toHaveBeenCalledTimes(1));
    expect(findSpy.mock.calls[0][0].sort).toBe('{"sku": -1}');
  });

  // The projection's input sits in the Project pill's dropdown, a dialog
  // the panel-level ⌘↵ skips — so the control runs this one itself.
  it('commits a projection draft that was never blurred, and runs it', async () => {
    const { findSpy } = mountWith(makeState());
    fireEvent.click(await screen.findByRole('button', { name: /^project/i }));
    const projection = await screen.findByTestId('fields-projection');

    fireEvent.change(projection, { target: { value: '{sku: 1}' } });
    fireEvent.keyDown(projection, cmdEnter);

    await waitFor(() => expect(findSpy).toHaveBeenCalledTimes(1));
    expect(findSpy.mock.calls[0][0].projection).toContain('sku');
  });

  it('refuses an invalid sort from a drawer input, says why, and clears on the next edit', async () => {
    const { findSpy } = mountWith(
      makeState({ builder: { projection: [], sort: '[1,2]', limit: '' } }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Add condition' }));

    fireEvent.keyDown(await screen.findByPlaceholderText('field'), cmdEnter);

    const line = await screen.findByTestId('query-bar-strip');
    expect(line.getAttribute('role')).toBe('alert');
    expect(line.textContent).toMatch(/Sort — A sort must be a document/);
    expect(screen.getByTestId('query-run-btn').textContent).toBe('Fix sort to run');
    await new Promise((r) => setTimeout(r, 0));
    expect(findSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('option-pill-sort'));
    fireEvent.change(await screen.findByTestId('query-bar-sort'), { target: { value: '{"sku": 1}' } });
    await waitFor(() => expect(screen.queryByTestId('query-bar-strip')).toBeNull());
  });

  it('announces a repeated refused press again', async () => {
    mountWith(makeState({ builder: { projection: [], sort: '[1,2]', limit: '' } }));
    const sort = await screen.findByTestId('option-pill-sort');

    fireEvent.keyDown(sort, cmdEnter);
    const first = await screen.findByTestId('query-bar-strip');
    fireEvent.keyDown(sort, cmdEnter);

    // A new alert node, not the same one re-rendered — only a fresh
    // `role="alert"` is announced.
    await waitFor(() => expect(screen.getByTestId('query-bar-strip')).not.toBe(first));
    expect(screen.getByTestId('query-bar-strip').textContent).toBe(first.textContent);
  });

  // W14 §9 — the shortcut's gate reads the find options too, or ⌘↵ would
  // run a query the disabled Run button refuses.
  it('refuses a find option that cannot run, and says so', async () => {
    const { findSpy } = mountWith(
      makeState({ builder: { projection: [], sort: '', limit: '', collation: 'en' } }),
    );

    // A set option is a pill of its own.
    fireEvent.keyDown(await screen.findByTestId('option-pill-collation'), cmdEnter);

    expect((await screen.findByTestId('query-bar-strip')).textContent).toMatch(
      /Collation — Can't parse this collation/,
    );
    expect(screen.getByTestId('query-run-btn').textContent).toBe('Fix collation to run');
    await new Promise((r) => setTimeout(r, 0));
    expect(findSpy).not.toHaveBeenCalled();
  });

  it('names a refused filter whose notice was already on screen', async () => {
    const { findSpy } = mountWith(makeState({ queryRaw: '[1,2]' }));
    const textarea = await screen.findByTestId('query-bar-input');
    fireEvent.blur(textarea);
    const before = await screen.findByTestId('query-bar-strip');
    expect(before.textContent).toMatch(/A filter must be a document/);

    // That notice is old news by now; the press has to say something itself:
    // the same sentence, in a fresh alert.
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Filter' }), cmdEnter);

    await waitFor(() => expect(screen.getByTestId('query-bar-strip')).not.toBe(before));
    expect(screen.getByTestId('query-bar-strip').textContent).toMatch(/A filter must be a document/);
    expect(screen.getByTestId('query-run-btn').textContent).toBe('Fix filter to run');
    expect(findSpy).not.toHaveBeenCalled();
  });

  it('leaves ⌘↵ inside a dialog to that dialog', async () => {
    const { findSpy } = mountWith(makeState());
    fireEvent.click(await screen.findByTestId('query-bar-expand-btn'));
    const dialog = await screen.findByRole('dialog');

    fireEvent.keyDown(within(dialog).getByRole('textbox'), cmdEnter);

    // The expand modal's own ⌘↵ applies and closes; the find query stays put.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(findSpy).not.toHaveBeenCalled();
  });

  it('does not run a find query from the Aggregation view', async () => {
    const { findSpy } = mountWith(makeState({ activeView: 'aggregation' }));
    // The toolbar's Run; the output pane offers its own "Run pipeline" too.
    const result = await screen.findByRole('button', { name: /^Run$/ });

    fireEvent.keyDown(result, cmdEnter);

    await new Promise((r) => setTimeout(r, 0));
    expect(findSpy).not.toHaveBeenCalled();
  });

  it('puts Run last in the toolbar, after Queries', async () => {
    mountWith(makeState());
    const run = await screen.findByTestId('query-run-btn');
    const history = screen.getByTestId('query-bar-saved-btn');

    expect(history.compareDocumentPosition(run) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// ─── X15 T5 — the ⌘⇧B guard survives portaling ─────────────────────────
//
// `Workspace.tsx`'s window-level ⌘⇧B handler skips the toggle when the event
// originates inside `[role="dialog"]` (a review finding — ⌘B inside a
// modal toggled the builder *behind* it and pulled focus out). SaveModal and
// NewTabPicker used to satisfy that check through the normal tree; they now
// render in Mantine's portal on `document.body`. `closest` walks the DOM, not
// React's tree, so the ancestry still holds — these two tests are the proof,
// and the first is the positive control without which the second passes even
// if ⌘⇧B were wired to nothing at all.
describe('X15 T5 — ⌘⇧B does not reach the builder from inside a dialog', () => {
  it('control: ⌘⇧B from outside a dialog does toggle the builder', async () => {
    mountWith(makeState());
    await screen.findByRole('tab', { name: 'Filter' });

    fireEvent.keyDown(document.body, { key: 'B', metaKey: true, shiftKey: true });

    // Collapsed means BuilderPane is unmounted, so its tab strip goes with it.
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Filter' })).toBeNull());
  });

  it('⌘⇧B from inside the portaled SaveModal leaves the builder alone', async () => {
    mountWith(makeState());

    fireEvent.click(await screen.findByRole('button', { name: /^Save$/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Save query' });

    fireEvent.keyDown(within(dialog).getByLabelText(/Name/), { key: 'B', metaKey: true, shiftKey: true });

    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('tab', { name: 'Filter' })).not.toBeNull();
  });

  it('⌘⇧B from inside the portaled NewTabPicker leaves the builder alone', async () => {
    mountWith(makeState());
    await screen.findByRole('tab', { name: 'Filter' });

    // ⌘T is the picker's own shortcut, registered by the same handler.
    fireEvent.keyDown(document.body, { key: 't', metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Open collection' });

    fireEvent.keyDown(within(dialog).getByLabelText('Database'), { key: 'B', metaKey: true, shiftKey: true });

    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('tab', { name: 'Filter' })).not.toBeNull();
  });
});
