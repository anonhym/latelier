import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, expectActiveRowOutlineLifecycle } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { DocFieldTree } from '../../src/pages/Workspace/views/DocFieldTree';

function renderFieldTree(
  doc: Record<string, unknown>,
  opts: {
    docId?: string;
    expandedPaths?: Set<string>;
    onToggle?: (path: string) => void;
    onOpenMenu?: (...args: unknown[]) => void;
    copiedPath?: string | null;
  } = {},
) {
  return render(
    <DocFieldTree
      doc={doc}
      docId={opts.docId ?? 'doc1'}
      expandedPaths={opts.expandedPaths ?? new Set()}
      onToggle={opts.onToggle ?? vi.fn()}
      copiedPath={opts.copiedPath ?? null}
      onCopy={vi.fn()}
      onOpenMenu={opts.onOpenMenu ?? vi.fn()}
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

// #60 — the active row is announced (aria-activedescendant, #20) but was
// never drawn. Asserts the real inline outline, not an attribute.
describe('DocFieldTree — active-row visual highlight (#60)', () => {
  it('no row is outlined before focus, the active row gains it on focus, ArrowDown moves it, blur clears it', () => {
    const { container } = renderFieldTree({ a: 1, b: 2, c: 3 });
    const tree = container.querySelector('[role="tree"]')! as HTMLElement;
    const rows = () => Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]'));

    expectActiveRowOutlineLifecycle(tree, rows, { key: 'ArrowDown', from: 0, to: 1 });
  });

  // Found in review. The test above uses a flat document, where every row is
  // a direct child of `DocFieldTree` and reads `activePath` straight from the
  // top — no memo boundary in between. A nested document puts a `FieldNode`
  // between the tree and the rows that matter, and that node's own comparator
  // decides whether its children ever see the new `activePath`. `{ a: { b, c } }`
  // is the smallest case that crosses the boundary twice: the first ArrowDown
  // flips node `a`'s own active flag (so it re-renders either way), the second
  // does not — `a`'s path is neither `a.b` nor `a.c` — which is exactly when a
  // path-only comparator skips the render its children needed.
  it('moves the outline between two children of the same expanded node', async () => {
    const { container } = renderFieldTree(
      { a: { b: 1, c: 2 } },
      { expandedPaths: new Set(['doc1::a']) },
    );
    const tree = container.querySelector('[role="tree"]')! as HTMLElement;
    // Attribute selector, not `#id`: these ids carry `::` and `.`, which a
    // CSS id selector reads as a pseudo-element and a class.
    const rowFor = (path: string) =>
      container.querySelector(`[id="field-row-doc1::${path}"]`) as HTMLElement;

    expect(rowFor('a.b')).not.toBeNull();
    expect(rowFor('a.c')).not.toBeNull();

    tree.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(rowFor('a.b').style.outline).toContain('2px');

    await userEvent.keyboard('{ArrowDown}');
    expect(tree.getAttribute('aria-activedescendant')).toBe('field-row-doc1::a.c');
    expect(rowFor('a.c').style.outline).toContain('2px');
    expect(rowFor('a.b').style.outline).not.toContain('2px');
  });

  // X19 #83 — the flash and this outline are both `var(--atelier-accent)`;
  // clipping the flash to the content box keeps it off the 2px inset band
  // the outline occupies. jsdom paints nothing, so this only guards the
  // style is set — `x19-copy-flash-outline.e2e.ts` proves the pixels
  // actually separate.
  it('a copied row clips its flash background to the content box (#83)', () => {
    const { container } = renderFieldTree({ a: 1 }, { copiedPath: 'doc1::a' });
    const row = container.querySelector('[role="treeitem"]') as HTMLElement;

    expect(row.style.backgroundClip).toBe('content-box');
  });
});

// #85 — `copiedPath` was written to the same own-path-only idiom `activePath`
// had (#60), and has the same bug: a `FieldNode` renders its expanded
// children itself, so moving `copiedPath` between two children of the same
// node — or clearing it while a nested row is marked — leaves that node's own
// flag unchanged, the comparator skips the render, and the children keep the
// stale mark. `{ a: { b, c } }` with `a` expanded is the smallest repro.
describe('DocFieldTree — copy-confirmation mark subtree bug (#85)', () => {
  const rowFor = (container: HTMLElement, path: string) =>
    container.querySelector(`[id="field-row-doc1::${path}"]`) as HTMLElement;
  const isMarked = (row: HTMLElement) => row.textContent?.includes('Copied') ?? false;

  it.each([
    { name: 'moves between two children of the same expanded node', from: 'doc1::a.b', to: 'doc1::a.c' },
    { name: 'clears when copiedPath resets to null', from: 'doc1::a.b', to: null },
    // Entering from nothing: only the *new* value is set, so this is the case
    // that exercises `next.copiedPath` on its own (the move case also needs it,
    // at the child that gains the mark).
    { name: 'appears when copiedPath is set from null', from: null, to: 'doc1::a.c' },
  ])('$name', ({ from, to }) => {
    // Callbacks MUST stay the same instances across the rerender — a fresh
    // vi.fn() per render would make the comparator's identity check return
    // false for an unrelated reason, and the test would pass against the bug.
    const props = {
      doc: { a: { b: 1, c: 2 } },
      docId: 'doc1',
      expandedPaths: new Set(['doc1::a']),
      onToggle: vi.fn(),
      onCopy: vi.fn(),
      onOpenMenu: vi.fn(),
    };

    const { container, rerender } = render(<DocFieldTree {...props} copiedPath={from} />);
    expect(isMarked(rowFor(container, 'a.b'))).toBe(from === 'doc1::a.b');

    rerender(<DocFieldTree {...props} copiedPath={to} />);

    expect(isMarked(rowFor(container, 'a.b'))).toBe(false);
    expect(isMarked(rowFor(container, 'a.c'))).toBe(to === 'doc1::a.c');
  });
});

// #68/#69 — the field menu (Copy value / Copy field path / Add to filter)
// was reachable only by right-click; this covers the keyboard-open path this
// component now owns, and the mouse-path payload shape #69 needs both to
// share.
describe('DocFieldTree — field menu open payload (#68/#69)', () => {
  function stubActiveRowRect(container: HTMLElement, path: string, rect: Partial<DOMRect>) {
    const el = container.querySelector(`[id="field-row-doc1::${path}"]`) as HTMLElement;
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      bottom: 0,
      top: 0,
      right: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => {},
      ...rect,
    } as DOMRect);
    return el;
  }

  it('Shift+F10 opens the menu for the active field row, anchored to its bounding rect', () => {
    const onOpenMenu = vi.fn();
    const { container } = renderFieldTree({ a: 1, b: 2 }, { onOpenMenu });
    const tree = container.querySelector('[role="tree"]')! as HTMLElement;
    stubActiveRowRect(container, 'a', { left: 42, bottom: 84 });

    fireEvent.keyDown(tree, { key: 'F10', shiftKey: true });

    expect(onOpenMenu).toHaveBeenCalledWith({
      anchor: { x: 42, y: 84 },
      fieldPath: 'a',
      value: 1,
      returnFocusTo: tree,
      focusMenuOnOpen: true,
    });
  });

  it('the ContextMenu key opens the same menu, for whichever row is active', () => {
    const onOpenMenu = vi.fn();
    const { container } = renderFieldTree({ a: 1, b: 'two' }, { onOpenMenu });
    const tree = container.querySelector('[role="tree"]')! as HTMLElement;
    fireEvent.keyDown(tree, { key: 'ArrowDown' }); // active row is now "b"
    stubActiveRowRect(container, 'b', { left: 5, bottom: 10 });

    fireEvent.keyDown(tree, { key: 'ContextMenu' });

    expect(onOpenMenu).toHaveBeenCalledWith({
      anchor: { x: 5, y: 10 },
      fieldPath: 'b',
      value: 'two',
      returnFocusTo: tree,
      focusMenuOnOpen: true,
    });
  });

  it('F10 without Shift does not open the menu', () => {
    const onOpenMenu = vi.fn();
    const { container } = renderFieldTree({ a: 1 }, { onOpenMenu });
    const tree = container.querySelector('[role="tree"]')! as HTMLElement;

    fireEvent.keyDown(tree, { key: 'F10', shiftKey: false });

    expect(onOpenMenu).not.toHaveBeenCalled();
  });

  it('opens the menu for a field nested inside an expanded parent', () => {
    const onOpenMenu = vi.fn();
    const { container } = renderFieldTree(
      { nested: { x: 1 } },
      { expandedPaths: new Set(['doc1::nested']), onOpenMenu },
    );
    const tree = container.querySelector('[role="tree"]')! as HTMLElement;
    fireEvent.keyDown(tree, { key: 'ArrowDown' }); // active row is now "nested.x"
    stubActiveRowRect(container, 'nested.x', { left: 1, bottom: 2 });

    fireEvent.keyDown(tree, { key: 'ContextMenu' });

    expect(onOpenMenu).toHaveBeenCalledWith(
      expect.objectContaining({ fieldPath: 'nested.x', value: 1 }),
    );
  });

  // A mouse-driven open can't reach the tree's own container ref (it fires
  // from a `FieldNode` deep in the recursion) — `DocFieldTree` injects
  // `returnFocusTo` on the way up. `focusMenuOnOpen` stays unset: a
  // right-click still shouldn't steal focus into the menu (#69's own
  // "right-click behaviour is otherwise unchanged" requirement).
  it('a right-click on a field row gets returnFocusTo but not focusMenuOnOpen', () => {
    const onOpenMenu = vi.fn();
    const { container } = renderFieldTree({ a: 1 }, { onOpenMenu });
    const tree = container.querySelector('[role="tree"]')! as HTMLElement;
    const row = container.querySelector('[id="field-row-doc1::a"]')! as HTMLElement;

    fireEvent.contextMenu(row, { clientX: 7, clientY: 9 });

    expect(onOpenMenu).toHaveBeenCalledWith({
      anchor: { x: 7, y: 9 },
      fieldPath: 'a',
      value: 1,
      returnFocusTo: tree,
    });
  });
});
