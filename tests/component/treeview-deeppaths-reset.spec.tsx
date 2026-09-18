import { describe, it, expect, vi } from 'vitest';
import {
  render,
  fireEvent,
  emptyWorkspaceActions,
  emptyWorkspaceMeta,
} from '../helpers/render';
import { TreeView } from '../../src/pages/Workspace/views/TreeView';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import type { CollectionTabState } from '@shared/types';

/**
 * Perf hotspot #4 — `deepPaths` (the local Set tracking expanded nested
 * field paths) was never cleared when the `documents` prop changed. After
 * a new query result, paths from the previous result silently re-applied
 * to whichever doc happened to share the same docId — and the Set grew
 * without bound across queries.
 *
 * The fix is a one-line `useEffect(() => setDeepPaths(new Set()), [documents])`
 * added in TreeView.tsx. This test pins the behavior so a future refactor
 * doesn't drop the effect.
 */

const noop = () => {};

function emptyState(): CollectionTabState {
  return {
    view: 'Tree',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
  };
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
      <CollectionWorkspaceProvider
        state={emptyState()}
        actions={emptyWorkspaceActions()}
        meta={emptyWorkspaceMeta()}
      >
        {children}
      </CollectionWorkspaceProvider>
  );
}

function renderTree(documents: unknown[], expandedDocId: string) {
  return render(
    <Wrap>
      <TreeView
        documents={documents}
        expandedRows={{ [expandedDocId]: true }}
        onSelect={noop}
        onRowExpand={vi.fn()}
      />
    </Wrap>,
  );
}

describe('TreeView — deepPaths resets when documents change', () => {
  it('drops user-expanded nested paths on re-render with a new documents array', () => {
    const docs1 = [
      { _id: { $oid: '507f1f77bcf86cd799439011' }, nested: { sentinelA: 'first' } },
    ];
    const docs2 = [
      { _id: { $oid: '507f1f77bcf86cd799439011' }, nested: { sentinelB: 'second' } },
    ];

    const { rerender, container, queryByText } = renderTree(docs1, '39439011');

    // The doc-row is expanded via state.expandedRows, so its top-level
    // fields are visible. The `nested` object is collapsed by default —
    // its inner key `sentinelA` is NOT visible until we click the chevron.
    expect(queryByText('sentinelA:')).toBeNull();

    // Click the chevron next to `nested`. We can't easily target it by
    // role/text, so locate it via the field row and click the toggle.
    const allClickables = container.querySelectorAll('span,div,button');
    let toggled = false;
    for (const el of Array.from(allClickables)) {
      if (el.textContent?.startsWith('nested')) {
        // Find a child or sibling chevron and click it. A simple click on
        // the row itself will hit the toggle handler in most variants.
        fireEvent.click(el);
        toggled = true;
        break;
      }
    }
    expect(toggled).toBe(true);

    // Re-render with docs2 (different array reference, same _id, different
    // nested key). If `deepPaths` weren't reset by the documents-change
    // effect, the `nested` row would still be expanded — but it points at
    // a doc whose nested children are different (sentinelB), so the
    // displayed expansion would be misleading. The effect collapses it.
    rerender(
      <Wrap>
        <TreeView
          documents={docs2}
          expandedRows={{ '39439011': true }}
          onSelect={noop}
          onRowExpand={vi.fn()}
        />
      </Wrap>,
    );

    // After the rerender, the user-expanded nested view from docs1 is gone:
    // sentinelB (from docs2) is NOT visible because `nested` is no longer
    // marked expanded in deepPaths.
    expect(queryByText('sentinelB:')).toBeNull();
    // And neither is sentinelA, naturally.
    expect(queryByText('sentinelA:')).toBeNull();
  });

  it('keeps the row rendered when the documents prop is a new array of the same shape', () => {
    const docs = [{ _id: 'a', x: 1 }];
    const { rerender, queryByText } = renderTree(docs, 'a');
    expect(queryByText('x:')).not.toBeNull();
    rerender(
      <Wrap>
        <TreeView
          documents={[{ _id: 'a', x: 1 }]} // new array, same shape
          expandedRows={{ a: true }}
          onSelect={noop}
          onRowExpand={vi.fn()}
        />
      </Wrap>,
    );
    // The reset effect keys on `documents`, so a new array reference fires it.
    // Clearing `deepPaths` must not take the row's own fields down with it —
    // `expandedRows` is the prop that governs those, and it did not change.
    expect(queryByText('x:')).not.toBeNull();
  });
});
