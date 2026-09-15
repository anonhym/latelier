import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '../helpers/render';
import { TreeView } from '../../src/pages/Workspace/views/TreeView';
import { TableView } from '../../src/pages/Workspace/views/TableView';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import type {
  CollectionWorkspaceActions,
  CollectionWorkspaceMeta,
} from '../../src/pages/Workspace/context';
import type { CollectionTabState } from '@shared/types';

/**
 * A document whose `_id` collides with an `Object.prototype` member name
 * renders permanently expanded and can never be collapsed, regardless of
 * `expandedRows`'s actual content.
 *
 * `getFullDocId` reaches this collision only through the `$oid`-shaped
 * branch, which returns `id.$oid` unquoted. A plain string `_id` goes
 * through `JSON.stringify` instead, which adds quotes (`"valueOf"` as a
 * docId, not `valueOf`), so an ordinary string `_id` never collides. EJSON
 * arriving at the renderer is not BSON-validated on the way in (plain
 * `JSON.parse` in `electron/preload.ts`), so a malformed or adversarial
 * `$oid` value is the reachable path this test exercises.
 */

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

function emptyActions(): CollectionWorkspaceActions {
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

function emptyMeta(): CollectionWorkspaceMeta {
  return {
    connectionId: 'c1',
    dbName: 'app',
    collection: 'orders',
    tabId: 't1',
    isLoading: false,
  };
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <CollectionWorkspaceProvider state={emptyState()} actions={emptyActions()} meta={emptyMeta()}>
      {children}
    </CollectionWorkspaceProvider>
  );
}

describe.each(['valueOf', '__proto__'])('expandedRows[%s]', (hostileId) => {
  // `getFullDocId` JSON.stringifies a plain string `_id` (adding quotes), so
  // a literal `_id: 'valueOf'` doc would NOT actually collide with
  // `Object.prototype` through this path — only the `$oid`-shaped branch
  // returns its value unquoted. Malformed/adversarial EJSON reaching the
  // renderer as `{ $oid: 'valueOf' }` (the wire is plain `JSON.parse`, not a
  // BSON-validating revive — electron/preload.ts) is the real path that
  // reaches this collision, so that's what this test constructs.
  const doc = { _id: { $oid: hostileId }, name: 'x' };

  describe('TreeView', () => {
    it('renders collapsed by default (no expandedRows entry)', () => {
      const { container } = render(
        <Wrap>
          <TreeView documents={[doc]} expandedRows={{}} onSelect={vi.fn()} onRowExpand={vi.fn()} />
        </Wrap>,
      );
      expect(container.querySelector('[data-expanded-doc-section]')).toBeNull();
      expect(container.querySelector('[aria-label="Expand document"]')).not.toBeNull();
    });

    it('toggles expanded when clicked, and back to collapsed', () => {
      let expandedRows: Record<string, boolean> = {};
      const onRowExpand = vi.fn((docId: string, expanded: boolean) => {
        expandedRows = expanded ? { ...expandedRows, [docId]: true } : {};
      });
      const { container, rerender } = render(
        <Wrap>
          <TreeView
            documents={[doc]}
            expandedRows={expandedRows}
            onSelect={vi.fn()}
            onRowExpand={onRowExpand}
          />
        </Wrap>,
      );

      fireEvent.click(container.querySelector('[aria-label="Expand document"]')!);
      expect(onRowExpand).toHaveBeenCalledWith(hostileId, true);

      rerender(
        <Wrap>
          <TreeView
            documents={[doc]}
            expandedRows={expandedRows}
            onSelect={vi.fn()}
            onRowExpand={onRowExpand}
          />
        </Wrap>,
      );
      expect(container.querySelector('[data-expanded-doc-section]')).not.toBeNull();

      fireEvent.click(container.querySelector('[aria-label="Collapse document"]')!);
      expect(onRowExpand).toHaveBeenCalledWith(hostileId, false);

      rerender(
        <Wrap>
          <TreeView
            documents={[doc]}
            expandedRows={expandedRows}
            onSelect={vi.fn()}
            onRowExpand={onRowExpand}
          />
        </Wrap>,
      );
      expect(container.querySelector('[data-expanded-doc-section]')).toBeNull();
    });
  });

  describe('TableView', () => {
    it('renders collapsed by default (no expandedRows entry)', () => {
      const { container } = render(
        <Wrap>
          <TableView documents={[doc]} onColumnResize={vi.fn()} expandedRows={{}} onRowExpand={vi.fn()} />
        </Wrap>,
      );
      expect(container.querySelector('[data-expanded-doc-section]')).toBeNull();
      expect(container.querySelector('[aria-label="Expand document"]')).not.toBeNull();
    });

    it('toggles expanded when clicked, and back to collapsed', () => {
      let expandedRows: Record<string, boolean> = {};
      const onRowExpand = vi.fn((docId: string, expanded: boolean) => {
        expandedRows = expanded ? { ...expandedRows, [docId]: true } : {};
      });
      const { container, rerender } = render(
        <Wrap>
          <TableView
            documents={[doc]}
            onColumnResize={vi.fn()}
            expandedRows={expandedRows}
            onRowExpand={onRowExpand}
          />
        </Wrap>,
      );

      fireEvent.click(container.querySelector('[aria-label="Expand document"]')!);
      expect(onRowExpand).toHaveBeenCalledWith(hostileId, true);

      rerender(
        <Wrap>
          <TableView
            documents={[doc]}
            onColumnResize={vi.fn()}
            expandedRows={expandedRows}
            onRowExpand={onRowExpand}
          />
        </Wrap>,
      );
      expect(container.querySelector('[data-expanded-doc-section]')).not.toBeNull();

      fireEvent.click(container.querySelector('[aria-label="Collapse document"]')!);
      expect(onRowExpand).toHaveBeenCalledWith(hostileId, false);

      rerender(
        <Wrap>
          <TableView
            documents={[doc]}
            onColumnResize={vi.fn()}
            expandedRows={expandedRows}
            onRowExpand={onRowExpand}
          />
        </Wrap>,
      );
      expect(container.querySelector('[data-expanded-doc-section]')).toBeNull();
    });
  });
});
