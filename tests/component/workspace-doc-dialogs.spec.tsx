// Phase 1 characterization tests (specs/PLAN-workspace-decomposition.md §5,
// T2) for the Insert/Duplicate/Edit wiring at Workspace.tsx:2602-2634, plus
// `openDuplicate` (~1124) and `openInsertModal` (~1068). Every case mounts
// the real `<Workspace />` and drives it through the DOM.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import { installAtelierMock, uninstallAtelierMock, connectionFixture } from '../helpers/atelierMock';
import { stripIdForDuplicate } from '../../src/pages/Workspace/views/docId';
import type { CollectionTab, CollectionTabState } from '@shared/types';

const NOW = '2026-08-01T12:00:00.000Z';
const DOC = { _id: '1', sku: 'widget' };

function tab(
  stateOverrides: Partial<CollectionTabState> = {},
  tabOverrides: Partial<CollectionTab> = {},
): CollectionTab {
  return {
    id: 't1',
    kind: 'collection',
    connectionId: 'c1',
    dbName: 'shop',
    collection: 'orders',
    position: 0,
    isActive: true,
    openedAt: NOW,
    pinned: false,
    state: {
      view: 'Tree',
      builder: { projection: [], sort: '', limit: '' },
      queryRaw: '{}',
      page: 0,
      pageSize: 50,
      activeBuilderTab: 'Builder',
      // Rendered straight from tab state — seeding it shows the row without
      // clicking Run, and skips the auto-run-on-open effect.
      lastRun: { documents: [DOC], durationMs: 1, ranAt: NOW },
      ...stateOverrides,
    },
    ...tabOverrides,
  };
}

function mountWorkspace() {
  return render(
    <MemoryRouter initialEntries={['/workspace']}>
      <Workspace />
    </MemoryRouter>,
  );
}

function mount(overrides: Parameters<typeof installAtelierMock>[0] = {}, t: CollectionTab = tab()) {
  installAtelierMock({
    tabs: { list: async () => [t] },
    conn: { list: async () => [connectionFixture({ id: 'c1' })] },
    ...overrides,
  });
  return mountWorkspace();
}

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('workspace doc dialogs (T2)', () => {
  it('toolbar "Insert" opens InsertDrawer with the default {} document', async () => {
    mount();

    await screen.findByText(/widget/);
    fireEvent.click(screen.getByRole('button', { name: 'Insert document' }));

    const dialog = await screen.findByRole('dialog', { name: 'Insert document' });
    expect((within(dialog).getByRole('textbox') as HTMLTextAreaElement).value).toBe('{}');
  });

  // The header's doc count used to be fetched once at open and never again —
  // a completed insert re-runs the query but the header kept the stale
  // number. This drives the real toolbar Insert flow end to end and checks
  // the header text, not just that a refresh function was called.
  it('a completed insert bumps the header doc count', async () => {
    let call = 0;
    const listCollections = vi.fn(async () => {
      call += 1;
      return [
        {
          name: 'orders',
          type: 'collection' as const,
          documentCount: call === 1 ? 1 : 2,
          sizeBytes: 0,
          indexCount: 1,
          capped: false,
        },
      ];
    });
    const insert = vi.fn().mockResolvedValue({ insertedId: 'x' });
    mount({ meta: { listCollections }, doc: { insert } });

    // Matched by its own textContent ("N docs · 1 indexes") rather than a
    // bare digit — a bare "1" also matches pagination/row-count text
    // elsewhere in the mounted Workspace.
    const headerStats = (n: number) =>
      screen.getByText((_, el) => el?.textContent?.startsWith(`${n} docs`) ?? false);

    await screen.findByText(/widget/);
    await waitFor(() => expect(headerStats(1)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Insert document' }));
    const dialog = await screen.findByRole('dialog', { name: 'Insert document' });
    fireEvent.click(within(dialog).getByRole('button', { name: /^insert/i }));

    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(headerStats(2)).toBeTruthy());
    expect(listCollections).toHaveBeenCalledTimes(2);
  });

  // T2.6 — "Duplicate document" is wired from TableView's row context menu
  // only (TreeView/JsonView don't offer it), so this seeds the tab in Table
  // view rather than driving a view switch through the SegmentedControl.
  it('"Duplicate document" opens InsertDrawer pre-filled with the source doc\'s EJSON minus _id', async () => {
    mount({}, tab({ view: 'Table' }));

    await screen.findByText(/widget/);
    fireEvent.contextMenu(screen.getByTitle(/Drag to add "sku/));
    fireEvent.click(screen.getByText('Duplicate document'));

    const dialog = await screen.findByRole('dialog', { name: 'Insert document' });
    const textarea = within(dialog).getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toBe(stripIdForDuplicate(DOC));
    expect(textarea.value).not.toContain('_id');
  });

  it('closing after a duplicate clears duplicateDocJson, so the next plain Insert opens empty again', async () => {
    mount({}, tab({ view: 'Table' }));

    await screen.findByText(/widget/);
    fireEvent.contextMenu(screen.getByTitle(/Drag to add "sku/));
    fireEvent.click(screen.getByText('Duplicate document'));

    const dupDialog = await screen.findByRole('dialog', { name: 'Insert document' });
    fireEvent.click(within(dupDialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Switch back to Tree so the toolbar "Insert document" button is
    // reachable the same way case 1 above finds it (Table view has no such
    // toolbar button visible without it — CollectionHeader is shared, so
    // this is just re-establishing the same entry point).
    fireEvent.click(screen.getByRole('button', { name: 'Insert document' }));

    const dialog = await screen.findByRole('dialog', { name: 'Insert document' });
    expect((within(dialog).getByRole('textbox') as HTMLTextAreaElement).value).toBe('{}');
  });

  it('onInserted closes the drawer and re-runs the query; onPartialInsert re-runs without closing', async () => {
    const insert = vi.fn(async () => ({ insertedId: 'x' }));
    const find = vi.fn(async () => ({ documents: [], durationMs: 0, hasMore: false }));
    mount({ doc: { insert }, query: { find } });

    await screen.findByText(/widget/);
    fireEvent.click(screen.getByRole('button', { name: 'Insert document' }));
    const dialog = await screen.findByRole('dialog', { name: 'Insert document' });
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: '{"sku":"new"}' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Insert$/ }));

    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(find).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Insert document' })).toBeNull());
  });

  it('onPartialInsert (a failed insertMany with some docs already written) re-runs the query but keeps the drawer open', async () => {
    const insertMany = vi.fn(async () => {
      const err = new Error('duplicate key') as Error & { code?: string; details?: unknown };
      err.code = 'CONFLICT';
      err.details = { insertedCount: 1 };
      throw err;
    });
    const find = vi.fn(async () => ({ documents: [], durationMs: 0, hasMore: false }));
    mount({ doc: { insertMany }, query: { find } });

    await screen.findByText(/widget/);
    fireEvent.click(screen.getByRole('button', { name: 'Insert document' }));
    const dialog = await screen.findByRole('dialog', { name: 'Insert document' });
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: '[{"sku":"a"},{"sku":"b"}]' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Insert/ }));

    await waitFor(() => expect(insertMany).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(find).toHaveBeenCalledTimes(1));
    // Partial-insert path re-runs but does NOT close the drawer.
    expect(screen.getByRole('dialog', { name: 'Insert document' })).toBeTruthy();
  });

  // NOTE: the dialog closing after Save is EditDrawer's OWN doing (it calls
  // `onSaved(); onClose();` itself once the write succeeds — see
  // EditDrawer.tsx:263-264), not something Workspace's `onSaved` wiring is
  // responsible for; that assertion stays here as an honest description of
  // current behavior, but it would pass even if Workspace's `onSaved` did
  // nothing at all. The part of this wiring that's actually Workspace's own
  // — and the part a mutation check confirmed this test catches — is the
  // re-run (`void queryRunner.run()`): drop that and `find` never fires.
  it('row "Edit" opens EditDrawer carrying that document; onSaved re-runs the query, and the drawer closes', async () => {
    const replace = vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const find = vi.fn(async () => ({ documents: [], durationMs: 0, hasMore: false }));
    mount({ doc: { replace }, query: { find } });

    await screen.findByText(/widget/);
    fireEvent.click(screen.getByTitle('Edit document'));

    const dialog = await screen.findByRole('dialog', { name: 'Edit document' });
    const textarea = within(dialog).getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toContain('"widget"');

    fireEvent.change(textarea, { target: { value: '{"_id":"1","sku":"edited"}' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Save$/ }));

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(find).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit document' })).toBeNull());
  });
});
