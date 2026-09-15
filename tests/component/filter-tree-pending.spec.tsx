// W13 §11 — "filter-tree-pending.spec.tsx: the pending-row lifecycle of §5,
// including a bar edit landing underneath a pending row, and switching tabs
// discarding pending rows even when both tabs' text is identical (the
// drawer remounts on `key={tabId}`)."
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { CollectionTabState, WorkspaceTab } from '@shared/types';
import type { IpcApi } from '@shared/ipc';

const now = '2026-08-04T12:00:00.000Z';

function makeState(overrides: Partial<CollectionTabState> = {}): CollectionTabState {
  return {
    view: 'Tree',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    lastRun: { documents: [], durationMs: 0, ranAt: now },
    ...overrides,
  };
}

function makeCollectionTab(
  id: string,
  collection: string,
  state: CollectionTabState,
  position: number,
  isActive: boolean,
): WorkspaceTab {
  return {
    id,
    kind: 'collection',
    connectionId: 'c1',
    dbName: 'mydb',
    collection,
    position,
    isActive,
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

function lastWrittenQueryRaw(updateSpy: ReturnType<typeof vi.fn>): string | undefined {
  for (let i = updateSpy.mock.calls.length - 1; i >= 0; i--) {
    const arg = updateSpy.mock.calls[i]?.[1] as { state?: Partial<CollectionTabState> } | undefined;
    const patch = arg?.state;
    if (patch && 'queryRaw' in patch) return patch.queryRaw;
  }
  return undefined;
}

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('Filter drawer — pending-row lifecycle (W13 §5, §11)', () => {
  it('"+ Condition" adds a row that persists on screen and does not change queryRaw', async () => {
    const state = makeState();
    const updateSpy = vi.fn(async () => makeCollectionTab('t1', 'users', state, 0, true));
    installAtelierMock({
      tabs: {
        list: async () => [makeCollectionTab('t1', 'users', state, 0, true)],
        setActive: async (id) => ({ id }),
        update: updateSpy as unknown as IpcApi['tabs']['update'],
      },
      conn: { list: async () => [CONNECTION] },
      query: { find: vi.fn(async () => ({ documents: [], durationMs: 1, hasMore: false })), count: async () => ({ count: 0 }) },
    });
    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <Workspace />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Add condition' }));

    const fieldInput = await screen.findByPlaceholderText('field');
    expect(fieldInput).toBeTruthy();
    // The query bar's textarea mirrors `state.queryRaw` synchronously (it's
    // a controlled input) — unlike `tabs.update`, which is 250ms-debounced
    // (`src/state/workspaceTabs.ts`), so it's an immediate, race-free
    // oracle for "did queryRaw change" instead of racing a fixed sleep
    // against that debounce.
    const bar = (await screen.findByTestId('query-bar-input')) as HTMLTextAreaElement;
    expect(bar.value).toBe('{}');
    // Wait past the debounce window too, to also rule out an eventual write
    // that the bar's local state wouldn't reflect (it always would, but this
    // keeps the assertion honest about what `tabs.update` actually saw).
    await new Promise((r) => setTimeout(r, 350));
    expect(lastWrittenQueryRaw(updateSpy)).toBeUndefined();
  });

  it('"+ Raw" adds a row that persists on screen and does not change queryRaw', async () => {
    const state = makeState();
    const updateSpy = vi.fn(async () => makeCollectionTab('t1', 'users', state, 0, true));
    installAtelierMock({
      tabs: {
        list: async () => [makeCollectionTab('t1', 'users', state, 0, true)],
        setActive: async (id) => ({ id }),
        update: updateSpy as unknown as IpcApi['tabs']['update'],
      },
      conn: { list: async () => [CONNECTION] },
      query: { find: vi.fn(async () => ({ documents: [], durationMs: 1, hasMore: false })), count: async () => ({ count: 0 }) },
    });
    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <Workspace />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Add raw clause' }));

    const rawInput = await screen.findByLabelText('Raw clause');
    expect(rawInput).toBeTruthy();
    const bar = (await screen.findByTestId('query-bar-input')) as HTMLTextAreaElement;
    expect(bar.value).toBe('{}');
    await new Promise((r) => setTimeout(r, 350));
    expect(lastWrittenQueryRaw(updateSpy)).toBeUndefined();
  });

  it('typing in the query bar re-seeds the tree and discards a pending row', async () => {
    const state = makeState();
    const updateSpy = vi.fn(async () => makeCollectionTab('t1', 'users', state, 0, true));
    installAtelierMock({
      tabs: {
        list: async () => [makeCollectionTab('t1', 'users', state, 0, true)],
        setActive: async (id) => ({ id }),
        update: updateSpy as unknown as IpcApi['tabs']['update'],
      },
      conn: { list: async () => [CONNECTION] },
      query: { find: vi.fn(async () => ({ documents: [], durationMs: 1, hasMore: false })), count: async () => ({ count: 0 }) },
    });
    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <Workspace />
      </MemoryRouter>,
    );

    // A pending row landing underneath a bar edit — add it, then type in the
    // bar out from under it.
    fireEvent.click(await screen.findByRole('button', { name: 'Add condition' }));
    await screen.findByPlaceholderText('field');

    const bar = (await screen.findByTestId('query-bar-input')) as HTMLTextAreaElement;
    fireEvent.change(bar, { target: { value: '{"a":1}' } });

    await waitFor(() => {
      // The pending row is gone — only the one real cond from the bar text
      // renders now.
      const fields = screen.getAllByPlaceholderText('field') as HTMLInputElement[];
      expect(fields).toHaveLength(1);
      expect(fields[0]!.value).toBe('a');
    });
  });

  it('switching tabs discards pending rows and re-seeds from queryRaw, even when both tabs share the same text', async () => {
    // §5.6 — the crux of the test: BOTH tabs hold the default '{}' text, so
    // text equality alone can never detect the switch. Only remounting on
    // `key={tabId}` catches it.
    const stateA = makeState();
    const stateB = makeState();
    const tabs = [
      makeCollectionTab('tA', 'orders', stateA, 0, true),
      makeCollectionTab('tB', 'users', stateB, 1, false),
    ];
    const updateSpy = vi.fn(async (id: string) => tabs.find((t) => t.id === id)!);
    const setActiveSpy = vi.fn(async (id: string) => ({ id }));
    installAtelierMock({
      tabs: {
        list: async () => tabs,
        setActive: setActiveSpy as unknown as IpcApi['tabs']['setActive'],
        update: updateSpy as unknown as IpcApi['tabs']['update'],
      },
      conn: { list: async () => [CONNECTION] },
      query: { find: vi.fn(async () => ({ documents: [], durationMs: 1, hasMore: false })), count: async () => ({ count: 0 }) },
    });
    const { container } = render(
      <MemoryRouter initialEntries={['/workspace']}>
        <Workspace />
      </MemoryRouter>,
    );

    // Both tabs render (TabStrip) — wait for tab A's collection to load.
    await screen.findByRole('tab', { name: /orders/ });

    // Add a pending condition row on tab A.
    fireEvent.click(await screen.findByRole('button', { name: 'Add condition' }));
    await screen.findByPlaceholderText('field');
    expect(screen.getAllByPlaceholderText('field')).toHaveLength(1);

    // Switch to tab B.
    const tabBEl = container.querySelector('[data-tab-id="tB"]');
    expect(tabBEl).toBeTruthy();
    fireEvent.click(tabBEl!);
    await waitFor(() => expect(setActiveSpy).toHaveBeenCalledWith('tB'));

    // Tab B has no conditions of its own — the drawer must show zero field
    // rows, not tab A's pending one.
    await waitFor(() => {
      expect(screen.queryAllByPlaceholderText('field')).toHaveLength(0);
    });

    // Switch back to tab A — its pending row must be gone too (discarded on
    // the switch away, not merely hidden).
    const tabAEl = container.querySelector('[data-tab-id="tA"]');
    fireEvent.click(tabAEl!);
    await waitFor(() => expect(setActiveSpy).toHaveBeenCalledWith('tA'));

    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryAllByPlaceholderText('field')).toHaveLength(0);
  });
});
