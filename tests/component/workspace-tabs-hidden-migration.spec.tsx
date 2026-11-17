import { describe, it, expect, afterEach, vi } from 'vitest';
import type { IpcApi } from '@shared/ipc';
import { renderHook, act, waitFor } from '../helpers/render';
import { useWorkspaceTabs } from '../../src/state/workspaceTabs';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { resultQueryKey } from '../../src/pages/Workspace/builder';
import { isResultStale } from '../../src/pages/Workspace/resultPaneState';
import type { CollectionTab, CollectionTabState } from '@shared/types';

const now = '2026-04-21T12:00:00.000Z';

function stateWith(over: Partial<CollectionTabState> = {}): CollectionTabState {
  const state: CollectionTabState = {
    view: 'Table',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    ...over,
  };
  return { ...state, lastRunQueryKey: resultQueryKey(state)! };
}

function collectionTab(id: string, state: CollectionTabState): CollectionTab {
  return {
    id,
    kind: 'collection',
    connectionId: 'c1',
    dbName: 'db',
    collection: id,
    position: 0,
    isActive: false,
    openedAt: now,
    pinned: false,
    state,
  };
}

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

// W14 §11.6: a tab saved with a hidden-column list is read as the projection
// that hides the same fields, wherever its state enters the renderer.
describe('useWorkspaceTabs — tabs saved with hidden columns', () => {
  it('a listed tab gets the equivalent exclusion, stays current, and is saved that way', async () => {
    const update = vi.fn<IpcApi['tabs']['update']>(async () => collectionTab('a', stateWith()));
    const saved = collectionTab('a', stateWith({ columnConfig: { hidden: ['x', 'y'], order: ['y'] } }));
    const untouched = collectionTab('b', stateWith());
    installAtelierMock({
      tabs: {
        list: async () => [saved, untouched],
        update: update as unknown as IpcApi['tabs']['update'],
      },
    });
    const { result } = renderHook(() => useWorkspaceTabs());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const a = result.current.tabs.find((t) => t.id === 'a') as CollectionTab;
    expect(a.state.builder.projectionRaw).toBe('{"x":0,"y":0}');
    expect(a.state.columnConfig).toEqual({ order: ['y'] });
    expect(a.state.lastRun).toBeUndefined();
    expect(a.state.lastRunQueryKey).toBe(resultQueryKey(a.state));
    expect(isResultStale({ ...a.state, lastRun: { documents: [], durationMs: 1, ranAt: now } })).toBe(false);
    // A tab with nothing to migrate is the very object main listed.
    expect(result.current.tabs.find((t) => t.id === 'b')).toBe(untouched);

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const [id, patch] = update.mock.calls[0]!;
    expect(id).toBe('a');
    expect(patch.state).toEqual({
      builder: a.state.builder,
      columnConfig: { order: ['y'] },
      lastRunQueryKey: a.state.lastRunQueryKey,
    });
  });

  it('a failed save keeps the migrated tab working in memory', async () => {
    installAtelierMock({
      tabs: {
        list: async () => [collectionTab('a', stateWith({ columnConfig: { hidden: ['x'] } }))],
        update: (async () => {
          throw new Error('disk full');
        }) as unknown as IpcApi['tabs']['update'],
      },
    });
    const { result } = renderHook(() => useWorkspaceTabs());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const a = result.current.tabs[0] as CollectionTab;
    expect(a.state.builder.projectionRaw).toBe('{"x":0}');
  });

  it('a reopened tab\'s seed is migrated before main opens it', async () => {
    const openCollection = vi.fn<IpcApi['tabs']['openCollection']>(async () => collectionTab('t', stateWith()));
    installAtelierMock({
      tabs: {
        list: async () => [],
        openCollection: openCollection as unknown as IpcApi['tabs']['openCollection'],
      },
    });
    const { result } = renderHook(() => useWorkspaceTabs());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.openCollection({
        connectionId: 'c1',
        dbName: 'db',
        collection: 't',
        reuseExisting: false,
        initialState: { columnConfig: { hidden: ['x'] }, view: 'JSON' },
      });
    });

    const seed = openCollection.mock.calls[0]![0].initialState!;
    expect(seed.builder?.projectionRaw).toBe('{"x":0}');
    expect(seed.columnConfig).toEqual({});
    expect(seed.view).toBe('JSON');
  });
});
