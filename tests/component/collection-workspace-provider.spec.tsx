import { describe, it, expect, vi } from 'vitest';
import { render, renderHook } from '../helpers/render';
import {
  CollectionWorkspaceProvider,
  useCollectionWorkspace,
  type CollectionWorkspaceActions,
  type CollectionWorkspaceMeta,
} from '../../src/pages/Workspace/context';
import type { CollectionTabState } from '@shared/types';

function makeState(): CollectionTabState {
  return {
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
  };
}

function makeActions(): CollectionWorkspaceActions {
  return {
    patch: vi.fn(),
    patchWith: vi.fn(),
    run: vi.fn(),
    openEdit: vi.fn(),
    openDelete: vi.fn(),
    openDeleteAll: vi.fn(),
    openInsert: vi.fn(),
    openSave: vi.fn(),
  };
}

function makeMeta(): CollectionWorkspaceMeta {
  return {
    connectionId: 'c1',
    dbName: 'app',
    collection: 'orders',
    tabId: 't1',
    isLoading: false,
  };
}

describe('CollectionWorkspaceProvider / useCollectionWorkspace', () => {
  it('throws a clear error when used outside the provider', () => {
    // Suppress React's own error-boundary console.error so the test output
    // stays clean — we're asserting on the thrown message.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useCollectionWorkspace())).toThrow(
        /useCollectionWorkspace must be called inside <CollectionWorkspaceProvider>/,
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('exposes state, actions, meta to consumers inside the provider', () => {
    const state = makeState();
    const actions = makeActions();
    const meta = makeMeta();
    const { result } = renderHook(() => useCollectionWorkspace(), {
      wrapper: ({ children }) => (
        <CollectionWorkspaceProvider state={state} actions={actions} meta={meta}>
          {children}
        </CollectionWorkspaceProvider>
      ),
    });
    expect(result.current.state).toBe(state);
    expect(result.current.actions).toBe(actions);
    expect(result.current.meta).toBe(meta);
  });

  it('memoises the context value — same inputs render to identical value identity', () => {
    const state = makeState();
    const actions = makeActions();
    const meta = makeMeta();
    let captured: ReturnType<typeof useCollectionWorkspace> | null = null;
    function Probe() {
      captured = useCollectionWorkspace();
      return null;
    }
    const { rerender } = render(
      <CollectionWorkspaceProvider state={state} actions={actions} meta={meta}>
        <Probe />
      </CollectionWorkspaceProvider>,
    );
    const first = captured;
    rerender(
      <CollectionWorkspaceProvider state={state} actions={actions} meta={meta}>
        <Probe />
      </CollectionWorkspaceProvider>,
    );
    expect(captured).toBe(first);
  });
});
