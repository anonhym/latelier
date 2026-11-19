import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  emptyWorkspaceActions,
  emptyWorkspaceMeta,
} from '../helpers/render';
import { TableView } from '../../src/pages/Workspace/views/TableView';
import { TreeView } from '../../src/pages/Workspace/views/TreeView';
import { JsonView } from '../../src/pages/Workspace/views/JsonView';
import { DocIdLabel } from '../../src/pages/Workspace/views/DocIdLabel';
import { ResultViewer } from '../../src/pages/Workspace/ResultViewer';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import { docMenuItems, fieldMenuItems, headerMenuItems } from '../../src/pages/Workspace/views/menuItems';
import { getCopyOrigin, recordCopyOrigin } from '../../src/utils/copyOrigin';
import type { ContextMenuItem } from '../../src/components/ContextMenu';
import type { CollectionTabState } from '@shared/types';

/**
 * Which copies the app remembers as the Copy Origin and which forget it, and
 * the `copy` listener on each result view for text selected inside it.
 */

const ID = '507f1f77bcf86cd799439011';
const DOCS = [
  { _id: { $oid: ID }, name: 'Alice Wonderland' },
  { _id: { $oid: '507f1f77bcf86cd799439012' }, name: 'Bob Builderson' },
];
const META = { connectionId: 'conn-a', dbName: 'shop', collection: 'orders' };
const OLD = { connectionId: 'conn-z', dbName: 'old', collection: 'old' };

let writeText: ReturnType<typeof vi.fn>;
let originalClipboard: Clipboard | undefined;
beforeEach(() => {
  originalClipboard = navigator.clipboard;
  writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => {
  if (originalClipboard !== undefined) {
    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
  } else {
    delete (navigator as { clipboard?: Clipboard }).clipboard;
  }
  vi.restoreAllMocks();
});

function state(view: CollectionTabState['view']): CollectionTabState {
  return {
    view,
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    lastRun: { documents: DOCS, durationMs: 1, ranAt: '2026-01-01T00:00:00Z' },
  };
}

function wrap(view: CollectionTabState['view'], node: React.ReactNode) {
  return render(
    <CollectionWorkspaceProvider
      state={state(view)}
      actions={emptyWorkspaceActions()}
      meta={emptyWorkspaceMeta(META)}
    >
      {node}
    </CollectionWorkspaceProvider>,
  );
}

function select(text: string) {
  vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => text } as Selection);
}

describe('text selected inside a result view', () => {
  const views: Array<[string, () => HTMLElement]> = [
    [
      'Table',
      () => {
        const { container } = wrap('Table', <TableView documents={DOCS} onColumnResize={vi.fn()} onRowExpand={vi.fn()} />);
        return container.querySelector<HTMLElement>('[role="grid"]')!;
      },
    ],
    [
      'Tree',
      () => {
        const { container } = wrap('Tree', <TreeView documents={DOCS} expandedRows={{}} onSelect={vi.fn()} onRowExpand={vi.fn()} />);
        return container.querySelector<HTMLElement>('[role="tree"]')!;
      },
    ],
    [
      'JSON',
      () => {
        const { container } = wrap('JSON', <JsonView documents={DOCS} />);
        return container.querySelector<HTMLElement>('[role="tree"]')!;
      },
    ],
  ];

  describe.each(views)('%s view', (_name, mount) => {
    it('records the selection against the Focused Tab, and leaves the copy to the browser', () => {
      const container = mount();
      select('Alice Wonderland');
      const event = createEvent.copy(container);
      fireEvent(container, event);
      expect(event.defaultPrevented).toBe(false);
      expect(getCopyOrigin()).toMatchObject({ ...META, text: 'Alice Wonderland', distinctive: ['Alice Wonderland'] });
    });

    it('records nothing for an empty selection, and keeps what was remembered', () => {
      const container = mount();
      recordCopyOrigin(OLD, 'older-value-here');
      select('');
      fireEvent.copy(container);
      expect(getCopyOrigin()).toMatchObject({ ...OLD, text: 'older-value-here' });
    });

    it('records nothing when there is no selection object at all', () => {
      const container = mount();
      vi.spyOn(window, 'getSelection').mockReturnValue(null);
      fireEvent.copy(container);
      expect(getCopyOrigin()).toBeNull();
    });
  });
});

describe('copies that record the origin', () => {
  const click = (items: ContextMenuItem[], label: string) => {
    const item = items.find((i) => i.kind === 'item' && i.label === label);
    if (!item || item.kind !== 'item') throw new Error(`no menu item ${label}`);
    item.onClick?.();
  };

  const field = (origin?: typeof META) =>
    fieldMenuItems({
      fieldPath: 'name',
      value: 'Alice Wonderland',
      hasValue: true,
      filterBarValid: true,
      onAddToFilter: vi.fn(async () => undefined),
      origin,
    });
  const doc = (origin?: typeof META) =>
    docMenuItems({ doc: DOCS[0], copyFormat: 'canonical', onEdit: vi.fn(), onDelete: vi.fn(), origin });

  it.each([
    ['Copy value', () => field(META), 'Alice Wonderland'],
    ['Copy document', () => doc(META), '"Alice Wonderland"'],
    ['Copy _id', () => doc(META), ID],
  ])('%s records it', async (label, items, expectedText) => {
    recordCopyOrigin(OLD, 'older-value-here');
    click(items(), label);
    await vi.waitFor(() => expect(getCopyOrigin()).toMatchObject(META));
    expect(getCopyOrigin()!.text).toContain(expectedText);
  });

  it('names the field a value or an id came from, and no field for a whole document', async () => {
    click(field(META), 'Copy value');
    await vi.waitFor(() => expect(getCopyOrigin()).toMatchObject({ ...META, fieldPath: 'name' }));
    click(doc(META), 'Copy _id');
    await vi.waitFor(() => expect(getCopyOrigin()).toMatchObject({ ...META, fieldPath: '_id' }));
    click(doc(META), 'Copy document');
    await vi.waitFor(() => expect(getCopyOrigin()!.text).toContain('Alice'));
    expect(getCopyOrigin()).not.toHaveProperty('fieldPath');
  });

  it('a value inside an array names no field', async () => {
    click(
      fieldMenuItems({
        fieldPath: 'items.0.sku',
        value: 'ABCDEF-1',
        hasValue: true,
        filterBarValid: true,
        onAddToFilter: vi.fn(async () => undefined),
        origin: META,
      }),
      'Copy value',
    );
    await vi.waitFor(() => expect(getCopyOrigin()).toMatchObject({ ...META, text: 'ABCDEF-1' }));
    expect(getCopyOrigin()).not.toHaveProperty('fieldPath');
  });

  it('Copy field path clears it', async () => {
    recordCopyOrigin(OLD, 'older-value-here');
    click(field(META), 'Copy field path');
    await vi.waitFor(() => expect(getCopyOrigin()).toBeNull());
  });

  it('the column header Copy field path clears it', async () => {
    recordCopyOrigin(OLD, 'older-value-here');
    click(
      headerMenuItems({
        fieldPath: 'name',
        sampleValue: 'x',
        hasSample: true,
        filterBarValid: true,
        onAddToFilter: vi.fn(async () => undefined),
        onHide: vi.fn(),
      }),
      'Copy field path',
    );
    await vi.waitFor(() => expect(getCopyOrigin()).toBeNull());
  });

  it('a menu given no origin clears it rather than recording one', async () => {
    recordCopyOrigin(OLD, 'older-value-here');
    click(doc(), 'Copy document');
    await vi.waitFor(() => expect(getCopyOrigin()).toBeNull());
  });

  it('the row id copy button records the document id for its tab', async () => {
    wrap('Tree', <DocIdLabel doc={DOCS[0]} />);
    fireEvent.click(screen.getByRole('button', { name: /Copy _id of document/ }));
    await vi.waitFor(() => expect(getCopyOrigin()).toMatchObject({ ...META, text: ID, fieldPath: '_id' }));
  });

  it('the row id copy button outside any tab has no origin to record, so it clears', async () => {
    recordCopyOrigin(OLD, 'older-value-here');
    render(<DocIdLabel doc={DOCS[0]} />);
    fireEvent.click(screen.getByRole('button', { name: /Copy _id of document/ }));
    await vi.waitFor(() => expect(getCopyOrigin()).toBeNull());
  });

  it('⌘C on a Table cell and ⌘⇧C on the row both record the tab', async () => {
    const { container } = wrap('Table', <TableView documents={DOCS} onColumnResize={vi.fn()} onRowExpand={vi.fn()} />);
    const grid = container.querySelector<HTMLElement>('[role="grid"]')!;
    grid.focus();
    fireEvent.keyDown(grid, { key: 'c', metaKey: true, shiftKey: true });
    await vi.waitFor(() => expect(getCopyOrigin()).toMatchObject(META));
    expect(getCopyOrigin()!.distinctive).toContain(ID);
  });

  it('⌘C on a clicked Table cell records the value with its field, and a double-click does too', async () => {
    const { container } = wrap('Table', <TableView documents={DOCS} onColumnResize={vi.fn()} onRowExpand={vi.fn()} />);
    const grid = container.querySelector<HTMLElement>('[role="grid"]')!;
    const cell = container.querySelector<HTMLElement>('[data-cell-key$=":name"]')!;
    fireEvent.click(cell);
    grid.focus();
    fireEvent.keyDown(grid, { key: 'c', metaKey: true });
    await vi.waitFor(() => expect(getCopyOrigin()).toMatchObject({ ...META, text: 'Alice Wonderland', fieldPath: 'name' }));
    recordCopyOrigin(OLD, 'older-value-here');
    fireEvent.doubleClick(cell);
    await vi.waitFor(() => expect(getCopyOrigin()).toMatchObject({ ...META, text: 'Alice Wonderland', fieldPath: 'name' }));
  });

  it('a double-click on a field of an expanded Tree row records the value with its field', async () => {
    const { container } = wrap('Tree', <TreeView documents={DOCS} expandedRows={{ [ID]: true }} onSelect={vi.fn()} onRowExpand={vi.fn()} />);
    const row = container.querySelector<HTMLElement>('[id$="::name"]');
    if (row === null) throw new Error(`no field row: ${[...container.querySelectorAll('[id]')].map((e) => e.id).join(', ')}`);
    fireEvent.doubleClick(row);
    await vi.waitFor(() => expect(getCopyOrigin()).toMatchObject({ ...META, text: 'Alice Wonderland', fieldPath: 'name' }));
  });

  it('⌘C on a Tree row records the document for its tab', async () => {
    const { container } = wrap('Tree', <TreeView documents={DOCS} expandedRows={{}} onSelect={vi.fn()} onRowExpand={vi.fn()} />);
    const tree = container.querySelector<HTMLElement>('[role="tree"]')!;
    tree.focus();
    fireEvent.keyDown(tree, { key: 'c', metaKey: true });
    await vi.waitFor(() => expect(getCopyOrigin()).toMatchObject(META));
  });

  it('the selection bar copies several documents and records them for its tab', async () => {
    const { container } = wrap(
      'JSON',
      <ResultViewer>
        <ResultViewer.SelectionBar onDeleteSelected={vi.fn()} />
        <ResultViewer.Json />
      </ResultViewer>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select document …99439011' }));
    fireEvent.click(container.querySelector('[data-testid="selection-bar-copy"]')!);
    await act(async () => {});
    expect(getCopyOrigin()).toMatchObject(META);
    expect(getCopyOrigin()!.distinctive).toContain(ID);
  });

  it('⌘C on a JSON card records the document for its tab', async () => {
    const { container } = wrap('JSON', <JsonView documents={DOCS} />);
    const tree = container.querySelector<HTMLElement>('[role="tree"]')!;
    tree.focus();
    fireEvent.keyDown(tree, { key: 'c', metaKey: true });
    await vi.waitFor(() => expect(getCopyOrigin()).toMatchObject(META));
    expect(getCopyOrigin()!.distinctive).toContain(ID);
  });
});
