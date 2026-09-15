import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor, screen, fireEvent } from '../helpers/render';
import { useWorkspaceTabs } from '../../src/state/workspaceTabs';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { CollectionTab } from '@shared/types';
import type { IpcApi } from '@shared/ipc';
import { DEFAULT_AGGREGATION_TAB_STATE } from '@shared/defaults';

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

/**
 * N0.5 regression coverage: dropping/renaming a namespace must not leave an
 * open workspace tab pointing at it. `closeForNamespace` and
 * `retargetCollection` are the two hook-level operations
 * `DbCollectionNavigator`'s drop/rename callbacks drive via `Workspace.tsx`.
 */
describe('useWorkspaceTabs — namespace drop/rename cleanup (N0.5)', () => {
  it('closeForNamespace closes only the tab matching {connectionId, dbName, collection}', async () => {
    const closeSpy = vi.fn(async () => ({ newActiveId: null }));
    installAtelierMock({
      tabs: {
        list: async () => [
          collectionTab({ id: 't1', connectionId: 'c1', dbName: 'db', collection: 'orders' }),
          collectionTab({
            id: 't2',
            connectionId: 'c1',
            dbName: 'db',
            collection: 'users',
            position: 1,
            isActive: false,
          }),
          // Different connection, same db/collection name — must not close.
          collectionTab({
            id: 't3',
            connectionId: 'c2',
            dbName: 'db',
            collection: 'orders',
            position: 2,
            isActive: false,
          }),
        ],
        close: closeSpy as unknown as IpcApi['tabs']['close'],
      },
    });

    const { result } = renderHook(() => useWorkspaceTabs());
    await waitFor(() => expect(result.current.tabs).toHaveLength(3));

    await act(async () => {
      await result.current.closeForNamespace({
        connectionId: 'c1',
        dbName: 'db',
        collection: 'orders',
      });
    });

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledWith('t1');
  });

  it('closeForNamespace with no `collection` closes every tab in the dropped database', async () => {
    const closeSpy = vi.fn(async () => ({ newActiveId: null }));
    installAtelierMock({
      tabs: {
        list: async () => [
          collectionTab({ id: 't1', connectionId: 'c1', dbName: 'db', collection: 'orders' }),
          collectionTab({
            id: 't2',
            connectionId: 'c1',
            dbName: 'db',
            collection: 'users',
            position: 1,
            isActive: false,
          }),
          collectionTab({
            id: 't3',
            connectionId: 'c1',
            dbName: 'otherDb',
            collection: 'orders',
            position: 2,
            isActive: false,
          }),
        ],
        close: closeSpy as unknown as IpcApi['tabs']['close'],
      },
    });

    const { result } = renderHook(() => useWorkspaceTabs());
    await waitFor(() => expect(result.current.tabs).toHaveLength(3));

    await act(async () => {
      await result.current.closeForNamespace({ connectionId: 'c1', dbName: 'db' });
    });

    expect(closeSpy).toHaveBeenCalledTimes(2);
    expect(closeSpy).toHaveBeenCalledWith('t1');
    expect(closeSpy).toHaveBeenCalledWith('t2');
    expect(closeSpy).not.toHaveBeenCalledWith('t3');
  });

  it('closeForNamespace prompts before closing a tab with unsaved pipeline edits, and honors Cancel', async () => {
    const closeSpy = vi.fn(async () => ({ newActiveId: null }));
    installAtelierMock({
      tabs: {
        list: async () => [
          collectionTab({
            id: 't1',
            connectionId: 'c1',
            dbName: 'db',
            collection: 'orders',
            state: {
              view: 'Tree',
              builder: { projection: [], sort: '', limit: '' },
              queryRaw: '{}',
              page: 0,
              pageSize: 50,
              activeBuilderTab: 'Builder',
              aggregation: { ...DEFAULT_AGGREGATION_TAB_STATE, dirty: true },
            },
          }),
        ],
        close: closeSpy as unknown as IpcApi['tabs']['close'],
      },
    });

    const { result } = renderHook(() => useWorkspaceTabs());
    await waitFor(() => expect(result.current.tabs).toHaveLength(1));

    // N4.7 — this was `window.confirm`, which blocks the thread and
    // could be stubbed with a return value. It is now the app's one confirm
    // dialog, so the call does not settle until the dialog is answered. Both
    // production callers fire it with `void`, so nothing waits on the user.
    let settled = false;
    const pending = result.current
      .closeForNamespace({ connectionId: 'c1', dbName: 'db', collection: 'orders' })
      .then(() => { settled = true; });

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Discard unsaved pipeline changes?');
    expect(closeSpy).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await pending;
    });

    expect(settled).toBe(true);
    expect(closeSpy).not.toHaveBeenCalled();
    expect(result.current.tabs).toHaveLength(1);
  });

  it('closeForNamespace closes the dirty tab once the discard is confirmed', async () => {
    const closeSpy = vi.fn(async () => {});
    installAtelierMock({
      tabs: {
        list: async () => [
          collectionTab({
            id: 't1',
            connectionId: 'c1',
            dbName: 'db',
            collection: 'orders',
            state: {
              ...collectionTab({ id: 't1' }).state,
              aggregation: { ...DEFAULT_AGGREGATION_TAB_STATE, dirty: true },
            },
          }),
        ],
        close: closeSpy as unknown as IpcApi['tabs']['close'],
      },
    });

    const { result } = renderHook(() => useWorkspaceTabs());
    await waitFor(() => expect(result.current.tabs).toHaveLength(1));

    const pending = result.current.closeForNamespace({
      connectionId: 'c1',
      dbName: 'db',
      collection: 'orders',
    });

    await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard and close' }));
      await pending;
    });

    expect(closeSpy).toHaveBeenCalledWith('t1');
  });

  it('retargetCollection calls tabs.collectionRenamed with oldCollection/newCollection and refreshes', async () => {
    const renamedSpy = vi.fn(async () => ({ retargeted: true, closed: false }));
    let listCalls = 0;
    installAtelierMock({
      tabs: {
        list: async () => {
          listCalls++;
          return listCalls === 1
            ? [collectionTab({ id: 't1', connectionId: 'c1', dbName: 'db', collection: 'orders' })]
            : [collectionTab({ id: 't1', connectionId: 'c1', dbName: 'db', collection: 'orders2' })];
        },
        collectionRenamed: renamedSpy as unknown as IpcApi['tabs']['collectionRenamed'],
      },
    });

    const { result } = renderHook(() => useWorkspaceTabs());
    await waitFor(() => expect(result.current.tabs).toHaveLength(1));

    await act(async () => {
      await result.current.retargetCollection({
        connectionId: 'c1',
        dbName: 'db',
        collection: 'orders',
        newCollection: 'orders2',
      });
    });

    expect(renamedSpy).toHaveBeenCalledWith({
      connectionId: 'c1',
      dbName: 'db',
      oldCollection: 'orders',
      newCollection: 'orders2',
    });
    expect(result.current.tabs[0]?.collection).toBe('orders2');
  });
});
