import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, renderHook, emptyWorkspaceActions, emptyWorkspaceMeta } from '../helpers/render';
import { TreeView } from '../../src/pages/Workspace/views/TreeView';
import { useScrollMemory } from '../../src/pages/Workspace/views/useScrollMemory';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import { recallScroll, forgetScroll, rememberScroll } from '../../src/pages/Workspace/views/scrollMemory';
import type { CollectionTabState } from '@shared/types';

const DOCS = Array.from({ length: 40 }, (_, i) => ({ _id: i, name: `n${i}` }));

function state(): CollectionTabState {
  return {
    view: 'Tree',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    lastRun: { documents: DOCS, durationMs: 1, ranAt: '2026-01-01T00:00:00Z' },
  };
}

function wrapperFor(tabId: string) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <CollectionWorkspaceProvider
        state={state()}
        actions={emptyWorkspaceActions()}
        meta={emptyWorkspaceMeta({ tabId })}
      >
        {children}
      </CollectionWorkspaceProvider>
    );
  };
}

describe('useScrollMemory', () => {
  it('starts a view that was never scrolled at the top', () => {
    forgetScroll('hook-fresh');
    const { result } = renderHook(() => useScrollMemory('Table'), { wrapper: wrapperFor('hook-fresh') });

    expect(result.current.defaultScrollOffset).toBe(0);
  });

  it('hands the list the offset it was left at, per tab and per view', () => {
    forgetScroll('hook-a');
    rememberScroll('hook-a', 'Tree', 210);
    rememberScroll('hook-a', 'JSON', 9);

    const tree = renderHook(() => useScrollMemory('Tree'), { wrapper: wrapperFor('hook-a') });
    const json = renderHook(() => useScrollMemory('JSON'), { wrapper: wrapperFor('hook-a') });
    const other = renderHook(() => useScrollMemory('Tree'), { wrapper: wrapperFor('hook-b') });

    expect(tree.result.current.defaultScrollOffset).toBe(210);
    expect(json.result.current.defaultScrollOffset).toBe(9);
    expect(other.result.current.defaultScrollOffset).toBe(0);
  });

  it('follows a tab switch on a reused view: each tab gets its own offset and a fresh list key', () => {
    forgetScroll('sw-a');
    forgetScroll('sw-b');
    rememberScroll('sw-a', 'Tree', 300);
    let tabId = 'sw-a';
    const { result, rerender } = renderHook(() => useScrollMemory('Tree'), {
      wrapper: ({ children }: { children: React.ReactNode }) => wrapperFor(tabId)({ children }),
    });
    expect(result.current).toMatchObject({ defaultScrollOffset: 300, listKey: 'sw-a' });

    tabId = 'sw-b';
    rerender();
    expect(result.current).toMatchObject({ defaultScrollOffset: 0, listKey: 'sw-b' });
    result.current.onScroll({ currentTarget: { scrollTop: 40 } } as React.UIEvent<HTMLElement>);

    tabId = 'sw-a';
    rerender();
    expect(result.current.defaultScrollOffset).toBe(300);
    expect(recallScroll('sw-b', 'Tree')).toBe(40);
  });

  it('records the element scrollTop on scroll', () => {
    forgetScroll('hook-rec');
    const { result } = renderHook(() => useScrollMemory('Table'), { wrapper: wrapperFor('hook-rec') });

    result.current.onScroll({ currentTarget: { scrollTop: 64 } } as React.UIEvent<HTMLElement>);

    expect(recallScroll('hook-rec', 'Table')).toBe(64);
  });
});

describe('TreeView scroll memory', () => {
  it('writes its list scroll into the memory under its own tab', () => {
    forgetScroll('tree-tab');
    render(
      <CollectionWorkspaceProvider
        state={state()}
        actions={emptyWorkspaceActions()}
        meta={emptyWorkspaceMeta({ tabId: 'tree-tab' })}
      >
        <TreeView documents={DOCS} onRowExpand={vi.fn()} onSelect={vi.fn()} />
      </CollectionWorkspaceProvider>,
    );
    const list = screen.getByRole('tree', { name: 'Documents' });

    // jsdom keeps scrollTop at 0 and ignores writes; make it a plain value.
    Object.defineProperty(list, 'scrollTop', { value: 321, configurable: true });
    fireEvent.scroll(list);

    expect(recallScroll('tree-tab', 'Tree')).toBe(321);
  });
});
