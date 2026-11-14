import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { fireEvent, render, screen, waitFor, within } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import { useWorkspaceTabs } from '../../src/state/workspaceTabs';
import {
  collectionTabFixture,
  connectionFixture,
  installAtelierMock,
  uninstallAtelierMock,
} from '../helpers/atelierMock';
import type { CollectionTab, ScriptTab, WorkspaceTab } from '@shared/types';

// W01 §14.9 — the preview tab lives in the hook's own state, so these drive
// the real hook against an in-memory tab store: "kept" only shows once a patch
// has round-tripped through the hook's state, which a static-props render
// could never see.

function store(initial: WorkspaceTab[] = []) {
  let rows = [...initial];
  let n = 0;
  const close = vi.fn(async (id: string) => {
    rows = rows.filter((t) => t.id !== id);
    return { newActiveId: rows.find((t) => t.isActive)?.id ?? null };
  });
  const openCollection = vi.fn(
    async (input: { connectionId: string; dbName: string; collection: string; reuseExisting?: boolean }) => {
      const existing = rows.find(
        (t) => t.kind === 'collection' && t.dbName === input.dbName && t.collection === input.collection,
      );
      if (existing && input.reuseExisting !== false) {
        rows = rows.map((t) => ({ ...t, isActive: t.id === existing.id }));
        return existing as CollectionTab;
      }
      const tab = collectionTabFixture({
        id: `t${++n}`,
        connectionId: input.connectionId,
        dbName: input.dbName,
        collection: input.collection,
        position: rows.length,
        isActive: true,
      });
      rows = [...rows.map((t) => ({ ...t, isActive: false })), tab];
      return tab;
    },
  );
  const openScript = vi.fn(async (input: { connectionId: string; initialState?: { title?: string } }) => {
    const tab: ScriptTab = {
      id: `s${++n}`,
      kind: 'script',
      connectionId: input.connectionId,
      dbName: '',
      collection: '',
      position: rows.length,
      isActive: true,
      openedAt: '2026-07-26T12:00:00.000Z',
      pinned: false,
      state: { title: input.initialState?.title ?? '', source: '' } as ScriptTab['state'],
    };
    rows = [...rows, tab];
    return tab;
  });
  const openAggregation = vi.fn(async (input: { connectionId: string; dbName: string; collection: string }) => {
    const tab = await openCollection({ ...input, reuseExisting: true });
    rows = rows.map((t) => (t.id === tab.id ? { ...tab, state: { ...tab.state, activeView: 'aggregation' } } : t));
    return tab;
  });
  return {
    api: {
      list: async () => rows,
      openAggregation: openAggregation as never,
      setActive: async (id: string) => {
        rows = rows.map((t) => ({ ...t, isActive: t.id === id }));
        return { id } as never;
      },
      openCollection: openCollection as never,
      openScript: openScript as never,
      close: close as never,
      update: async () => undefined as never,
      setPinned: async () => undefined as never,
    },
    close,
    openScript,
  };
}

const ns = (collection: string, dbName = 'shop') => ({ connectionId: 'c1', dbName, collection });

async function mount(initial: WorkspaceTab[] = []) {
  const s = store(initial);
  installAtelierMock({ tabs: s.api });
  const hook = renderHook(() => useWorkspaceTabs());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return { ...s, hook };
}

const labels = (tabs: WorkspaceTab[]) => tabs.map((t) => (t.kind === 'collection' ? t.collection : t.state.title));

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('preview tab', () => {
  it('three single clicks on collections leave one tab, the last', async () => {
    const { hook, close } = await mount();
    for (const c of ['orders', 'users', 'events']) {
      await act(() => hook.result.current.openCollection({ ...ns(c), preview: true }));
    }
    expect(labels(hook.result.current.tabs)).toEqual(['events']);
    expect(close).toHaveBeenCalledTimes(2);
    expect(hook.result.current.previewId).toBe(hook.result.current.tabs[0]!.id);
  });

  it('a filter edit keeps the preview, so the next single click opens beside it', async () => {
    const { hook, close } = await mount();
    const first = await act(() => hook.result.current.openCollection({ ...ns('orders'), preview: true }));
    act(() => hook.result.current.patchCollectionState(first.id, { queryRaw: '{"a":1}' }));
    expect(hook.result.current.previewId).toBeNull();

    await act(() => hook.result.current.openCollection({ ...ns('users'), preview: true }));
    expect(labels(hook.result.current.tabs)).toEqual(['orders', 'users']);
    expect(close).not.toHaveBeenCalled();
  });

  it('a run writing results does not keep the preview', async () => {
    const { hook } = await mount();
    const first = await act(() => hook.result.current.openCollection({ ...ns('orders'), preview: true }));
    act(() => hook.result.current.patchCollectionState(first.id, { totalCount: 3, lastRunQueryKey: 'k' }));
    act(() => hook.result.current.patchAggregationState(first.id, { lastRun: undefined }));
    expect(hook.result.current.previewId).toBe(first.id);

    await act(() => hook.result.current.openCollection({ ...ns('users'), preview: true }));
    expect(labels(hook.result.current.tabs)).toEqual(['users']);
  });

  it('a pipeline edit keeps it; pinning keeps it; a non-preview open of it keeps it', async () => {
    const { hook } = await mount();
    const a = await act(() => hook.result.current.openCollection({ ...ns('a'), preview: true }));
    act(() => hook.result.current.patchAggregationState(a.id, { name: 'p' }));
    expect(hook.result.current.previewId).toBeNull();

    const b = await act(() => hook.result.current.openCollection({ ...ns('b'), preview: true }));
    await act(() => hook.result.current.setPinned(b.id, true));
    expect(hook.result.current.previewId).toBeNull();

    const c = await act(() => hook.result.current.openCollection({ ...ns('c'), preview: true }));
    await act(() => hook.result.current.openCollection({ ...ns('c'), reuseExisting: true }));
    expect(hook.result.current.previewId).toBeNull();
    expect(labels(hook.result.current.tabs)).toEqual(['a', 'b', 'c']);
    expect(c.id).toBe(hook.result.current.tabs[2]!.id);
  });

  it('opening its Aggregation view keeps it', async () => {
    const { hook } = await mount();
    const a = await act(() => hook.result.current.openCollection({ ...ns('orders'), preview: true }));
    await act(() => hook.result.current.openAggregation(ns('orders')));
    expect(hook.result.current.previewId).toBeNull();
    expect(a.id).toBe(hook.result.current.tabs[0]!.id);
  });

  it('clicking a collection that already has a kept tab focuses it and leaves the preview alone', async () => {
    const { hook, close } = await mount();
    await act(() => hook.result.current.openCollection({ ...ns('orders') }));
    const p = await act(() => hook.result.current.openCollection({ ...ns('users'), preview: true }));
    await act(() => hook.result.current.openCollection({ ...ns('orders'), preview: true }));
    expect(close).not.toHaveBeenCalled();
    expect(hook.result.current.previewId).toBe(p.id);
  });

  it('a double-click’s two opens, issued without waiting, end with one kept tab', async () => {
    const { hook, close } = await mount();
    await act(async () => {
      const first = hook.result.current.openCollection({ ...ns('orders'), preview: true });
      const second = hook.result.current.openCollection({ ...ns('orders'), reuseExisting: true });
      await Promise.all([first, second]);
    });
    expect(labels(hook.result.current.tabs)).toEqual(['orders']);
    expect(hook.result.current.previewId).toBeNull();
    expect(close).not.toHaveBeenCalled();
  });
});

it('two quick single clicks on different collections still leave one preview', async () => {
  const { hook } = await mount();
  await act(async () => {
    await Promise.all([
      hook.result.current.openCollection({ ...ns('orders'), preview: true }),
      hook.result.current.openCollection({ ...ns('users'), preview: true }),
    ]);
  });
  expect(labels(hook.result.current.tabs)).toEqual(['users']);
});

describe('script titles', () => {
  it('numbers new scripts at open, one past the highest default title open', async () => {
    const { hook, openScript } = await mount();
    await act(() => hook.result.current.openScript({ connectionId: 'c1' }));
    await act(() => hook.result.current.openScript({ connectionId: 'c1' }));
    expect(openScript.mock.calls.map((c) => c[0].initialState?.title)).toEqual(['Script 1', 'Script 2']);
    expect(labels(hook.result.current.tabs)).toEqual(['Script 1', 'Script 2']);
  });

  it('two scripts opened back to back, with no render between, get different numbers', async () => {
    const { hook, openScript } = await mount();
    await act(async () => {
      await hook.result.current.openScript({ connectionId: 'c1' });
      await hook.result.current.openScript({ connectionId: 'c1' });
    });
    expect(openScript.mock.calls.map((c) => c[0].initialState?.title)).toEqual(['Script 1', 'Script 2']);
  });

  it('a title the caller passes wins', async () => {
    const { hook, openScript } = await mount();
    await act(() => hook.result.current.openScript({ connectionId: 'c1', initialState: { title: 'Saved' } }));
    expect(openScript.mock.calls[0]![0].initialState?.title).toBe('Saved');
  });
});

describe('preview tab in the mounted Workspace', () => {
  it('a tab whose views have mounted and run is still replaced by the next single click', async () => {
    // The views, the query bar and the auto-run all write to a tab when it
    // opens; none of those writes may count as an edit.
    const s = store();
    installAtelierMock({
      tabs: s.api,
      conn: { list: async () => [connectionFixture({ id: 'c1', name: 'Prod', status: 'connected' })] },
      meta: {
        listDatabases: async () => [{ name: 'db', sizeOnDisk: 1, empty: false }],
        listCollections: async () =>
          ['alpha', 'bravo'].map((name) => ({ name, type: 'collection' as const, capped: false })),
      },
      query: { find: async () => ({ documents: [{ _id: '1', sku: 'widget' }], durationMs: 1, hasMore: false }) },
    });
    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <Workspace />
      </MemoryRouter>,
    );

    // No tab yet, so no root is open: open Prod's, then its database.
    const tree = within(await screen.findByRole('tree', { name: 'Databases and collections' }));
    if (!screen.queryByTestId('nav-db-db')) fireEvent.click(await tree.findByText('Prod'));
    fireEvent.click(await screen.findByTestId('nav-db-db'));
    fireEvent.click(await screen.findByTestId('nav-coll-db-alpha'));
    await screen.findByText(/widget/);
    // Past the 250ms debounce, so any write the mount made has landed.
    await new Promise((r) => setTimeout(r, 300));

    fireEvent.click(await screen.findByTestId('nav-coll-db-bravo'));
    const strip = within(screen.getByRole('tablist', { name: 'Open tabs' }));
    await waitFor(() => expect(strip.getAllByRole('tab').map((t) => t.getAttribute('aria-label'))).toEqual(['bravo — Prod']));
    expect(strip.getByRole('tab').getAttribute('data-preview')).toBe('true');
    expect(s.close).toHaveBeenCalledTimes(1);
  });
});
