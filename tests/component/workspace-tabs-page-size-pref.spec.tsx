import { describe, it, expect, afterEach, vi } from 'vitest';
import type { IpcApi } from '@shared/ipc';
import { renderHook, act, waitFor } from '../helpers/render';
import { useWorkspaceTabs } from '../../src/state/workspaceTabs';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { CollectionTab } from '@shared/types';

const now = '2026-04-21T12:00:00.000Z';

function collectionTab(overrides: Partial<CollectionTab> = {}): CollectionTab {
  return {
    id: 't1',
    kind: 'collection',
    connectionId: 'c1',
    dbName: 'db',
    collection: 'coll',
    position: 0,
    isActive: true,
    openedAt: now,
    pinned: false,
    state: {
      view: 'Tree',
      builder: {
        projection: [],
        sort: '',
        limit: '',
      },
      queryRaw: '{}',
      page: 0,
      pageSize: 50,
      activeBuilderTab: 'Builder',
    },
    ...overrides,
  };
}

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

// W07 §5 / T0.5: openCollection reads the sticky `ui.workspace.defaultPageSize`
// pref and seeds a brand-new tab's `initialState.pageSize` from it — but only
// when the stored value is a member of the fixed option set
// {10,25,50,100,250,500}. A corrupted/out-of-range value must be treated the
// same as a never-set pref (omit `initialState`, let the server default of
// 50 apply) rather than seeding an unbounded page size.
describe('useWorkspaceTabs — openCollection page-size pref validation', () => {
  it('omits initialState when the stored pref is not in the allowed set', async () => {
    const openCollectionSpy = vi.fn<IpcApi['tabs']['openCollection']>(async () => collectionTab());
    installAtelierMock({
      tabs: {
        list: async () => [],
        openCollection: openCollectionSpy as unknown as import('@shared/ipc').IpcApi['tabs']['openCollection'],
      },
      prefs: {
        get: (async () => 99999) as unknown as import('@shared/ipc').IpcApi['prefs']['get'],
      },
    });

    const { result } = renderHook(() => useWorkspaceTabs());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.openCollection({
        connectionId: 'c1',
        dbName: 'db',
        collection: 'coll',
      });
    });

    expect(openCollectionSpy).toHaveBeenCalledTimes(1);
    const call = openCollectionSpy.mock.calls[0]![0] as { initialState?: unknown };
    expect(call.initialState).toBeUndefined();
  });

  it('seeds initialState.pageSize when the stored pref is a member of the allowed set', async () => {
    const openCollectionSpy = vi.fn<IpcApi['tabs']['openCollection']>(async () => collectionTab());
    installAtelierMock({
      tabs: {
        list: async () => [],
        openCollection: openCollectionSpy as unknown as import('@shared/ipc').IpcApi['tabs']['openCollection'],
      },
      prefs: {
        get: (async () => 250) as unknown as import('@shared/ipc').IpcApi['prefs']['get'],
      },
    });

    const { result } = renderHook(() => useWorkspaceTabs());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.openCollection({
        connectionId: 'c1',
        dbName: 'db',
        collection: 'coll',
      });
    });

    expect(openCollectionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ initialState: { pageSize: 250 } }),
    );
  });
});
