import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { TreeView } from '../../src/pages/Workspace/views/TreeView';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import type {
  CollectionWorkspaceActions,
  CollectionWorkspaceMeta,
} from '../../src/pages/Workspace/context';
import type { CollectionTabState } from '@shared/types';

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

function emptyActions(overrides: Partial<CollectionWorkspaceActions> = {}): CollectionWorkspaceActions {
  return {
    patch: vi.fn(),
    patchWith: vi.fn(),
    run: vi.fn(),
    openEdit: vi.fn(),
    openDelete: vi.fn(),
    openDeleteAll: vi.fn(),
    openInsert: vi.fn(),
    openSave: vi.fn(),
    ...overrides,
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

function renderTree(documents: unknown[], opts: {
  expanded?: Record<string, true>;
  previewFields?: string[] | null;
  onRowExpand?: (id: string, expanded: boolean) => void;
  onSelect?: (doc: unknown) => void;
  actions?: Partial<CollectionWorkspaceActions>;
} = {}) {
  return render(
      <CollectionWorkspaceProvider
        state={emptyState()}
        actions={emptyActions(opts.actions)}
        meta={emptyMeta()}
      >
        <TreeView
          documents={documents}
          expandedRows={opts.expanded}
          onSelect={opts.onSelect ?? noop}
          onRowExpand={opts.onRowExpand ?? vi.fn()}
          previewFields={opts.previewFields}
        />
      </CollectionWorkspaceProvider>
  );
}

/**
 * P1-11 coverage for TreeView. The existing `treeview-deeppaths-reset.spec.tsx`
 * pins the deepPaths-reset perf fix; these add the basic rendering /
 * interaction surface (collapsed preview, expansion, deletion).
 */
describe('TreeView — rendering and interaction', () => {
  it('renders one row per document and shows a collapsed-preview slice of fields', () => {
    const docs = [
      { _id: { $oid: '507f1f77bcf86cd799439011' }, name: 'alpha', count: 1 },
      { _id: { $oid: '507f1f77bcf86cd799439012' }, name: 'beta', count: 2 },
    ];
    const { container } = renderTree(docs);

    // TreeView's getDocId() shows the last 8 chars of each $oid.
    expect(container.textContent).toContain('99439011');
    expect(container.textContent).toContain('99439012');
    // Collapsed preview includes the non-_id fields by default
    expect(container.textContent).toContain('alpha');
    expect(container.textContent).toContain('beta');
  });

  it('honors previewFields prop, hiding non-listed fields from the collapsed preview', () => {
    const docs = [
      { _id: { $oid: '507f1f77bcf86cd799439011' }, name: 'alpha', secret: 'hidden' },
    ];
    const { container } = renderTree(docs, { previewFields: ['name'] });

    expect(container.textContent).toContain('alpha');
    // `secret` field is not in the previewFields list — must not appear.
    // Strip <style> elements first: Mantine's MantineProvider injects a
    // global stylesheet that mentions the word "hidden" in utility class
    // names (e.g., .mantine-hidden-from-xs), which would otherwise be
    // picked up by container.textContent.
    const rendered = container.cloneNode(true) as HTMLElement;
    rendered.querySelectorAll('style').forEach((el) => el.remove());
    expect(rendered.textContent).not.toContain('hidden');
  });

  it('renders an expanded row with its top-level fields visible', () => {
    const docs = [
      { _id: { $oid: '507f1f77bcf86cd799439011' }, name: 'alpha', visibleField: 'yes' },
    ];
    // TreeView's getDocId() takes the last 8 chars of `$oid` as the row
    // key — so the matching `expandedRows` key for this doc is '99439011',
    // not '39439011'. Earlier this test "passed" because `visibleField` is
    // also visible in the collapsed preview strip; using the real expanded
    // key makes the assertion actually test the expanded code path.
    const { container } = renderTree(docs, { expanded: { '99439011': true } });

    // Expanded view shows the full key list including `_id`
    expect(container.textContent).toContain('visibleField');
    expect(container.textContent).toContain('yes');
  });

  // S6848 a11y fix (row now carries role="treeitem"/tabIndex/onKeyDown for
  // "Click to expand"): the row's onKeyDown must ignore a keydown that
  // bubbles up from the nested expand button, or Enter on that button would
  // call onRowExpand twice (once from the button's own click, once from the
  // row) and net out to a no-op instead of expanding.
  it('pressing Enter on the expand button expands exactly once, not twice', async () => {
    const docs = [
      { _id: { $oid: '507f1f77bcf86cd799439011' }, name: 'alpha' },
    ];
    const onRowExpand = vi.fn();
    renderTree(docs, { onRowExpand });

    const btn = screen.getByRole('button', { name: 'Expand document' });
    btn.focus();
    await userEvent.keyboard('{Enter}');

    expect(onRowExpand).toHaveBeenCalledTimes(1);
    expect(onRowExpand).toHaveBeenCalledWith('507f1f77bcf86cd799439011', true);
  });

  // #20 — roving focus: the tree itself is the widget's only tab stop.
  describe('roving focus (#20)', () => {
    const threeDocs = [
      { _id: { $oid: '507f1f77bcf86cd799439011' }, name: 'a' },
      { _id: { $oid: '507f1f77bcf86cd799439012' }, name: 'b' },
      { _id: { $oid: '507f1f77bcf86cd799439013' }, name: 'c' },
    ];

    it('the tree is a tab stop and names row 0 as the active descendant', () => {
      const { container } = renderTree(threeDocs);
      const tree = container.querySelector('[role="tree"]')!;

      expect(tree.getAttribute('tabindex')).toBe('0');
      expect(tree.getAttribute('aria-activedescendant')).toBe('tree-row-0');
      expect(container.querySelector('#tree-row-0')).not.toBeNull();
    });

    it('ArrowDown/ArrowUp move the active descendant and wrap at both ends', () => {
      const { container } = renderTree(threeDocs);
      const tree = container.querySelector('[role="tree"]')!;

      fireEvent.keyDown(tree, { key: 'ArrowDown' });
      expect(tree.getAttribute('aria-activedescendant')).toBe('tree-row-1');

      fireEvent.keyDown(tree, { key: 'ArrowUp' });
      fireEvent.keyDown(tree, { key: 'ArrowUp' });
      expect(tree.getAttribute('aria-activedescendant')).toBe('tree-row-2');
    });

    it('Home/End jump to the first/last row', () => {
      const { container } = renderTree(threeDocs);
      const tree = container.querySelector('[role="tree"]')!;

      fireEvent.keyDown(tree, { key: 'End' });
      expect(tree.getAttribute('aria-activedescendant')).toBe('tree-row-2');
      fireEvent.keyDown(tree, { key: 'Home' });
      expect(tree.getAttribute('aria-activedescendant')).toBe('tree-row-0');
    });

    it('Enter on the tree itself expands the active row', () => {
      const onRowExpand = vi.fn();
      const { container } = renderTree(threeDocs, { onRowExpand });
      const tree = container.querySelector('[role="tree"]')!;

      fireEvent.keyDown(tree, { key: 'ArrowDown' });
      fireEvent.keyDown(tree, { key: 'Enter' });

      expect(onRowExpand).toHaveBeenCalledWith('507f1f77bcf86cd799439012', true);
    });

    // Mirrors the existing per-row guard test above, at the container level:
    // Enter bubbling from a nested button must not also expand the row.
    it('Enter bubbling up from a nested button does not double-expand', async () => {
      const onRowExpand = vi.fn();
      renderTree([threeDocs[0]], { onRowExpand });

      const btn = screen.getByRole('button', { name: 'Expand document' });
      btn.focus();
      await userEvent.keyboard('{Enter}');

      expect(onRowExpand).toHaveBeenCalledTimes(1);
    });
  });
});
