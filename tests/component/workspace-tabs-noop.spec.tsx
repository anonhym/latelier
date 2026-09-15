import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '../helpers/render';
import { useWorkspaceTabs } from '../../src/state/workspaceTabs';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { CollectionTab, WorkspaceTab } from '@shared/types';
import type { IpcApi } from '@shared/ipc';

// The hook exposes the `WorkspaceTab` union; `state.aggregation` only exists
// on the collection variant.
function asCollectionTab(tab: WorkspaceTab): CollectionTab {
  if (tab.kind !== 'collection') throw new Error(`expected a collection tab, got ${tab.kind}`);
  return tab;
}

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

function aggregationViewTab(overrides: Partial<CollectionTab> = {}): CollectionTab {
  return {
    id: 'a1',
    kind: 'collection',
    connectionId: 'c1',
    dbName: 'db',
    collection: 'coll',
    position: 1,
    isActive: false,
    openedAt: now,
    pinned: false,
    state: {
      activeView: 'aggregation',
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
      aggregation: {
        stages: [],
        activeStageId: null,
        outputHeight: 260,
        outputView: 'Tree',
        dirty: false,
      },
    },
    ...overrides,
  };
}

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

async function mountWithTabs(tabs: WorkspaceTab[]) {
  const updateSpy = vi.fn<IpcApi['tabs']['update']>(async () =>
    collectionTab({ id: 't1', connectionId: 'c1' }),
  );
  installAtelierMock({
    tabs: {
      list: async () => tabs,
      update: updateSpy,
    },
  });
  const hook = renderHook(() => useWorkspaceTabs());
  // Wait for the initial refresh to resolve.
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return { hook, updateSpy };
}

describe('useWorkspaceTabs — no-op patch detection', () => {
  it('passes through a patch that changes a primitive field', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { hook, updateSpy } = await mountWithTabs([collectionTab({ id: 't1' })]);

    act(() => {
      hook.result.current.patchCollectionState('t1', { page: 1 });
    });

    const tabAfter = hook.result.current.tabs.find((t) => t.id === 't1');
    expect(tabAfter && tabAfter.kind === 'collection' && tabAfter.state.page).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('skips when every patch key already equals the current state', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { hook, updateSpy } = await mountWithTabs([collectionTab({ id: 't1' })]);

    const before = hook.result.current.tabs;

    act(() => {
      hook.result.current.patchCollectionState('t1', { page: 0, pageSize: 50 });
    });

    // Tabs array reference must be unchanged — no re-render was scheduled.
    expect(hook.result.current.tabs).toBe(before);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(updateSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('treats a new object reference with the same shape as a change (caller must memoize)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { hook, updateSpy } = await mountWithTabs([collectionTab({ id: 't1' })]);

    act(() => {
      hook.result.current.patchCollectionState('t1', { columns: {} });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(updateSpy).toHaveBeenCalledTimes(1);

    // A second patch with a new {} reference is a new value — it's up to the
    // caller to pass the same ref if they want to skip.
    act(() => {
      hook.result.current.patchCollectionState('t1', { columns: {} });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(updateSpy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('keeps a same-reference object as a no-op', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const sharedColumns = { _id: { width: 200 } };
    const { hook, updateSpy } = await mountWithTabs([
      collectionTab({ id: 't1', state: { ...collectionTab({ id: 't1' }).state, columns: sharedColumns } }),
    ]);

    act(() => {
      hook.result.current.patchCollectionState('t1', { columns: sharedColumns });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(updateSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('a mixed patch (one same-value field, one changed field) still fires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { hook, updateSpy } = await mountWithTabs([collectionTab({ id: 't1' })]);

    act(() => {
      hook.result.current.patchCollectionState('t1', { page: 0, pageSize: 100 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('a burst of identical no-op patches triggers zero IPC calls', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { hook, updateSpy } = await mountWithTabs([collectionTab({ id: 't1' })]);

    act(() => {
      for (let i = 0; i < 20; i++) {
        hook.result.current.patchCollectionState('t1', { page: 0 });
      }
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(updateSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('patchAggregationState applies the same guard on the nested sub-state', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { hook, updateSpy } = await mountWithTabs([aggregationViewTab({ id: 'a1' })]);

    act(() => {
      hook.result.current.patchAggregationState('a1', { dirty: false });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(updateSpy).not.toHaveBeenCalled();

    act(() => {
      hook.result.current.patchAggregationState('a1', { dirty: true });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('ignores a patch for an unknown tab id', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { hook, updateSpy } = await mountWithTabs([collectionTab({ id: 't1' })]);

    act(() => {
      hook.result.current.patchCollectionState('does-not-exist', { page: 99 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(updateSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('patchAggregationState merges into state.aggregation without clobbering top-level fields', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { hook, updateSpy } = await mountWithTabs([aggregationViewTab({ id: 'a1' })]);

    act(() => {
      hook.result.current.patchAggregationState('a1', { dirty: true });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [, patch] = updateSpy.mock.calls[0]!;
    // Aggregation patch should land under state.aggregation, leaving the
    // tab's top-level Documents fields untouched.
    expect((patch as { state: { aggregation?: { dirty?: boolean } } }).state.aggregation?.dirty)
      .toBe(true);
    expect((patch as { state: { page?: number } }).state.page).toBeUndefined();
    vi.useRealTimers();
  });

  it('seeds DEFAULT_AGGREGATION_TAB_STATE when patching a tab without prior aggregation state', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Start from a Documents-only collection tab — `state.aggregation` is
    // undefined. The first patchAggregationState call must seed defaults so
    // the AggregationTab sub-view doesn't crash on a missing `stages`.
    const { hook, updateSpy } = await mountWithTabs([collectionTab({ id: 't1' })]);

    act(() => {
      hook.result.current.patchAggregationState('t1', { dirty: true });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const tab = asCollectionTab(hook.result.current.tabs.find((t) => t.id === 't1')!);
    expect(tab.state.aggregation).toBeDefined();
    expect(tab.state.aggregation!.stages).toEqual([]);
    expect(tab.state.aggregation!.activeStageId).toBeNull();
    expect(tab.state.aggregation!.outputHeight).toBe(260);
    expect(tab.state.aggregation!.outputView).toBe('Tree');
    expect(tab.state.aggregation!.dirty).toBe(true);
  });

  it('successive patchAggregationState calls in the same tick preserve every key', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { hook, updateSpy } = await mountWithTabs([aggregationViewTab({ id: 'a1' })]);

    // Two patches before the debounced flush — the second call sees the
    // pending merged aggregation, not the (stale) tabsRef.current value.
    act(() => {
      hook.result.current.patchAggregationState('a1', {
        stages: [{ id: 1, op: '$match', body: '{}', enabled: true }],
      });
      hook.result.current.patchAggregationState('a1', { activeStageId: 1 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    // The accumulated IPC patch must contain BOTH stages and activeStageId.
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [, patch] = updateSpy.mock.calls[0]! as [
      string,
      { state: { aggregation: { stages: unknown[]; activeStageId: number | null } } },
    ];
    expect(patch.state.aggregation.stages).toHaveLength(1);
    expect(patch.state.aggregation.activeStageId).toBe(1);

    // Local React state must agree.
    const tab = asCollectionTab(hook.result.current.tabs.find((t) => t.id === 'a1')!);
    expect(tab.state.aggregation!.stages).toHaveLength(1);
    expect(tab.state.aggregation!.activeStageId).toBe(1);
    vi.useRealTimers();
  });
});
