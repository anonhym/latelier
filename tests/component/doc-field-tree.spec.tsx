import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { DocFieldTree } from '../../src/pages/Workspace/views/DocFieldTree';

function renderFieldTree(
  doc: Record<string, unknown>,
  opts: {
    docId?: string;
    expandedPaths?: Set<string>;
    onToggle?: (path: string) => void;
  } = {},
) {
  return render(
    <DocFieldTree
      doc={doc}
      docId={opts.docId ?? 'doc1'}
      expandedPaths={opts.expandedPaths ?? new Set()}
      onToggle={opts.onToggle ?? vi.fn()}
      copiedPath={null}
      onCopy={vi.fn()}
      onOpenMenu={vi.fn()}
    />,
  );
}

// #20 — roving focus over one expanded document's field tree. Each expanded
// document mounts its own independent `DocFieldTree`, so it owns its own
// single tab stop rather than joining the outer Table/Tree grid's.
describe('DocFieldTree — roving focus (#20)', () => {
  it('is its own tab stop and names the first field row as the active descendant', () => {
    const { container } = renderFieldTree({ a: 1, b: 2, c: 3 });
    const tree = container.querySelector('[role="tree"]')!;
    const rows = container.querySelectorAll('[role="treeitem"]');

    expect(tree.getAttribute('tabindex')).toBe('0');
    expect(rows).toHaveLength(3);
    expect(tree.getAttribute('aria-activedescendant')).toBe(rows[0].id);
    expect(rows[0].id).not.toBe('');
  });

  it('ArrowDown/ArrowUp move the active descendant among top-level fields, wrapping at both ends', () => {
    const { container } = renderFieldTree({ a: 1, b: 2, c: 3 });
    const tree = container.querySelector('[role="tree"]')!;
    const rows = container.querySelectorAll('[role="treeitem"]');

    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    expect(tree.getAttribute('aria-activedescendant')).toBe(rows[1].id);

    fireEvent.keyDown(tree, { key: 'ArrowUp' });
    fireEvent.keyDown(tree, { key: 'ArrowUp' });
    expect(tree.getAttribute('aria-activedescendant')).toBe(rows[2].id);
  });

  it('Home/End jump to the first/last top-level field', () => {
    const { container } = renderFieldTree({ a: 1, b: 2, c: 3 });
    const tree = container.querySelector('[role="tree"]')!;
    const rows = container.querySelectorAll('[role="treeitem"]');

    fireEvent.keyDown(tree, { key: 'End' });
    expect(tree.getAttribute('aria-activedescendant')).toBe(rows[2].id);
    fireEvent.keyDown(tree, { key: 'Home' });
    expect(tree.getAttribute('aria-activedescendant')).toBe(rows[0].id);
  });

  it('Enter on the tree toggles the active expandable field', () => {
    const onToggle = vi.fn();
    const { container } = renderFieldTree(
      { nested: { x: 1 }, leaf: 'v' },
      { onToggle },
    );
    const tree = container.querySelector('[role="tree"]')!;

    fireEvent.keyDown(tree, { key: 'Enter' });
    expect(onToggle).toHaveBeenCalledWith('doc1::nested');
  });

  it('Enter on the tree does nothing for a non-expandable active field', () => {
    const onToggle = vi.fn();
    const { container } = renderFieldTree({ leaf: 'v' }, { onToggle });
    const tree = container.querySelector('[role="tree"]')!;

    fireEvent.keyDown(tree, { key: 'Enter' });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('once a field is expanded, its children join the roving order right after it', () => {
    const { container } = renderFieldTree(
      { nested: { x: 1, y: 2 }, leaf: 'v' },
      { expandedPaths: new Set(['doc1::nested']) },
    );
    const tree = container.querySelector('[role="tree"]')!;
    const rows = container.querySelectorAll('[role="treeitem"]');

    // nested, nested.x, nested.y, leaf — 4 visible rows, children right
    // after their expanded parent.
    expect(rows).toHaveLength(4);

    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    expect(tree.getAttribute('aria-activedescendant')).toBe(rows[1].id);
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    expect(tree.getAttribute('aria-activedescendant')).toBe(rows[2].id);
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    expect(tree.getAttribute('aria-activedescendant')).toBe(rows[3].id);
  });

  // Mirrors the row-level guard elsewhere: Enter bubbling from a nested
  // control (the expand chevron button) must not also toggle via the
  // container's own Enter handling.
  it('Enter bubbling up from the expand button does not double-toggle', () => {
    const onToggle = vi.fn();
    const { container } = renderFieldTree({ nested: { x: 1 } }, { onToggle });
    const chevron = container.querySelector('[aria-label="Expand"]')!;

    fireEvent.keyDown(chevron, { key: 'Enter' });
    expect(onToggle).not.toHaveBeenCalled();
  });

  // Found in review: `tabIndex={-1}` excludes a row from Tab order but (per
  // the HTML focusing-steps algorithm) leaves it click-focusable —
  // `fireEvent.click` above does no focus management at all, which is why
  // this needs `userEvent`'s click specifically, the one that walks up to
  // the nearest focusable ancestor like a real browser.
  it('a real click on a field row does not trap focus there — ArrowDown still moves the tree afterward', async () => {
    const user = userEvent.setup();
    const { container } = renderFieldTree({ a: 1, b: 2, c: 3 });
    const tree = container.querySelector('[role="tree"]')!;
    const rows = container.querySelectorAll('[role="treeitem"]');

    await user.click(rows[0]);
    await user.keyboard('{ArrowDown}');

    expect(document.activeElement).toBe(tree);
    expect(tree.getAttribute('aria-activedescendant')).toBe(rows[1].id);
  });

  it('clicking field row 2 makes it the active row — ArrowDown moves to row 3, not row 1', async () => {
    const user = userEvent.setup();
    const { container } = renderFieldTree({ a: 1, b: 2, c: 3 });
    const tree = container.querySelector('[role="tree"]')!;
    const rows = container.querySelectorAll('[role="treeitem"]');

    await user.click(rows[1]);
    expect(tree.getAttribute('aria-activedescendant')).toBe(rows[1].id);
    await user.keyboard('{ArrowDown}');
    expect(tree.getAttribute('aria-activedescendant')).toBe(rows[2].id);
  });

  // Non-expandable leaf rows have no `onToggle` action, but a click on one
  // must still hand it real focus's substitute (the roving index) — not
  // just expandable rows.
  it('clicking a non-expandable leaf row still makes it the active row', async () => {
    const user = userEvent.setup();
    const { container } = renderFieldTree({ a: 1, b: 2 });
    const tree = container.querySelector('[role="tree"]')!;
    const rows = container.querySelectorAll('[role="treeitem"]');

    await user.click(rows[1]);
    expect(tree.getAttribute('aria-activedescendant')).toBe(rows[1].id);
  });
});
