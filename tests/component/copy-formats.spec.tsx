import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  act,
  within,
  emptyWorkspaceActions,
  emptyWorkspaceMeta,
} from '../helpers/render';
import { notifications } from '@mantine/notifications';
import { installAtelierMock } from '../helpers/atelierMock';
import { TableView } from '../../src/pages/Workspace/views/TableView';
import { TreeView } from '../../src/pages/Workspace/views/TreeView';
import { JsonView } from '../../src/pages/Workspace/views/JsonView';
import { ResultViewer } from '../../src/pages/Workspace/ResultViewer';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import { copyToClipboard } from '../../src/utils/clipboard';
import type { CollectionTabState } from '@shared/types';
import { MONGOSH_HINT, type CopyFormat } from '../../src/utils/copyFormat';

const OID = '507f1f77bcf86cd799439011';
const DOCS = [
  { _id: { $oid: OID }, qty: { $numberInt: '7' }, name: 'alpha' },
  { _id: { $oid: '507f1f77bcf86cd799439012' }, qty: { $numberInt: '8' }, name: 'beta' },
];

let writeText: ReturnType<typeof vi.fn>;
let originalClipboard: Clipboard | undefined;
let prefSet: ReturnType<typeof vi.fn>;

beforeEach(() => {
  originalClipboard = navigator.clipboard;
  writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => {
  notifications.clean();
  window.getSelection()?.removeAllRanges();
  if (originalClipboard !== undefined) {
    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
  } else {
    delete (navigator as { clipboard?: Clipboard }).clipboard;
  }
});

/** The copy-format store is module-wide: every test states the stored choice it starts from. */
function storedFormat(format: CopyFormat) {
  prefSet = vi.fn(async (_k: string, v: unknown) => v);
  installAtelierMock({
    prefs: {
      get: vi.fn(async (k: string) => (k === 'ui.workspace.copyFormat' ? format : null)),
      set: prefSet,
    },
  } as Parameters<typeof installAtelierMock>[0]);
}

const settle = () => act(async () => {});

function state(view: CollectionTabState['view'], documents: unknown[] = DOCS): CollectionTabState {
  return {
    view,
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    lastRun: { documents, durationMs: 1, ranAt: new Date().toISOString() },
  };
}

function inWorkspace(view: CollectionTabState['view'], children: React.ReactNode, documents?: unknown[]) {
  return (
    <CollectionWorkspaceProvider
      state={state(view, documents)}
      actions={emptyWorkspaceActions()}
      meta={emptyWorkspaceMeta()}
    >
      {children}
    </CollectionWorkspaceProvider>
  );
}

const renderTable = (docs: unknown[] = DOCS) =>
  render(inWorkspace('Table', <TableView documents={docs} onColumnResize={vi.fn()} onRowExpand={vi.fn()} />, docs));
const renderTree = () =>
  render(inWorkspace('Tree', <TreeView documents={DOCS} onSelect={vi.fn()} onRowExpand={vi.fn()} />));
const renderJson = () => render(inWorkspace('JSON', <JsonView documents={DOCS} />));

const copied = () => writeText.mock.calls.map((c) => c[0] as string);

describe('absent fields in Table (W06 §8.5)', () => {
  it('draws a field the document lacks as a titled dash, and leaves null as null', () => {
    storedFormat('readable');
    renderTable([
      { _id: { $numberInt: '1' }, note: null },
      { _id: { $numberInt: '2' } },
    ]);
    const absent = screen.getAllByTitle('Field not present');
    expect(absent).toHaveLength(1);
    expect(absent[0]!.textContent).toBe('—');
    expect(screen.getByText('null')).toBeTruthy();
    expect(screen.queryByText('undefined')).toBeNull();
  });
});

describe('⌘C and ⌘⇧C (W06 §8.6)', () => {
  it('Tree: both copy the active document as readable EJSON', async () => {
    storedFormat('readable');
    renderTree();
    await settle();
    const tree = screen.getByRole('tree', { name: 'Documents' });
    fireEvent.keyDown(tree, { key: 'c', metaKey: true });
    fireEvent.keyDown(tree, { key: 'C', metaKey: true, shiftKey: true });
    await settle();
    const first = JSON.parse(copied()[0]!);
    expect(first).toEqual({ _id: { $oid: OID }, qty: 7, name: 'alpha' });
    expect(copied()).toHaveLength(2);
    expect(copied()[1]).toBe(copied()[0]);
  });

  it('JSON: both copy the active document', async () => {
    storedFormat('readable');
    renderJson();
    await settle();
    const list = screen.getByRole('tree', { name: 'Documents' });
    fireEvent.keyDown(list, { key: 'c', ctrlKey: true });
    fireEvent.keyDown(list, { key: 'c', ctrlKey: true, shiftKey: true });
    await settle();
    expect(copied()).toHaveLength(2);
    expect(JSON.parse(copied()[0]!).name).toBe('alpha');
  });

  it('Table: ⌘C copies the clicked cell, ⌘⇧C the document', async () => {
    storedFormat('readable');
    renderTable();
    await settle();
    const grid = screen.getByRole('grid', { name: 'Documents' });
    fireEvent.click(document.querySelector('[data-cell-key="0:name"]')!);
    fireEvent.keyDown(grid, { key: 'c', metaKey: true });
    await settle();
    expect(copied()).toEqual(['alpha']);
    fireEvent.keyDown(grid, { key: 'c', metaKey: true, shiftKey: true });
    await settle();
    expect(JSON.parse(copied()[1]!)).toEqual({ _id: { $oid: OID }, qty: 7, name: 'alpha' });
  });

  it('Table: with no clicked cell in the active row, ⌘C copies the document', async () => {
    storedFormat('readable');
    renderTable();
    await settle();
    fireEvent.keyDown(screen.getByRole('grid', { name: 'Documents' }), { key: 'c', metaKey: true });
    await settle();
    expect(JSON.parse(copied()[0]!).name).toBe('alpha');
  });

  it('Table: ⌘C on a clicked cell whose field the document lacks copies nothing and toasts nothing', async () => {
    storedFormat('readable');
    renderTable([
      { _id: { $oid: OID }, note: 'kept' },
      { _id: { $oid: '507f1f77bcf86cd799439012' } },
    ]);
    await settle();
    const grid = screen.getByRole('grid', { name: 'Documents' });
    fireEvent.click(document.querySelector('[data-cell-key="1:note"]')!);
    const notPrevented = fireEvent.keyDown(grid, { key: 'c', metaKey: true });
    await settle();
    expect(copied()).toEqual([]);
    expect(document.querySelectorAll('.mantine-Notifications-notification')).toHaveLength(0);
    // The key is still ours: the browser must not copy the grid's own text instead.
    expect(notPrevented).toBe(false);
  });

  it('Table: a new result forgets the clicked cell, so ⌘C copies the active document', async () => {
    storedFormat('readable');
    const view = (docs: unknown[]) =>
      inWorkspace('Table', <TableView documents={docs} onColumnResize={vi.fn()} onRowExpand={vi.fn()} />, docs);
    const { rerender } = render(view(DOCS));
    await settle();
    fireEvent.click(document.querySelector('[data-cell-key="0:name"]')!);
    const next = [{ _id: { $oid: OID }, qty: { $numberInt: '7' }, name: 'gamma' }, DOCS[1]];
    rerender(view(next));
    await settle();
    fireEvent.keyDown(screen.getByRole('grid', { name: 'Documents' }), { key: 'c', metaKey: true });
    await settle();
    expect(JSON.parse(copied()[0]!).name).toBe('gamma');
    expect(copied()[0]).not.toBe('gamma');
  });

  it('copies in the stored format', async () => {
    storedFormat('mongosh');
    renderTree();
    await settle();
    fireEvent.keyDown(screen.getByRole('tree', { name: 'Documents' }), { key: 'c', metaKey: true });
    await settle();
    expect(copied()[0]).toContain(`_id: ObjectId("${OID}")`);
  });

  it('leaves the native copy alone for a text selection', async () => {
    storedFormat('readable');
    renderTree();
    await settle();
    const p = document.createElement('p');
    p.textContent = 'selected words';
    document.body.append(p);
    const range = document.createRange();
    range.selectNodeContents(p);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    const target = screen.getByRole('tree', { name: 'Documents' });
    const notPrevented = fireEvent.keyDown(target, { key: 'c', metaKey: true });
    await settle();
    expect(copied()).toEqual([]);
    expect(notPrevented).toBe(true);
  });

  it('leaves the native copy alone when the key is typed in a text field', async () => {
    storedFormat('readable');
    renderTree();
    await settle();
    const input = document.createElement('input');
    screen.getByRole('tree', { name: 'Documents' }).append(input);
    const notPrevented = fireEvent.keyDown(input, { key: 'c', metaKey: true });
    await settle();
    expect(copied()).toEqual([]);
    expect(notPrevented).toBe(true);
  });

  it('ignores other chords on C', async () => {
    storedFormat('readable');
    renderTree();
    await settle();
    const tree = screen.getByRole('tree', { name: 'Documents' });
    fireEvent.keyDown(tree, { key: 'c' });
    fireEvent.keyDown(tree, { key: 'c', metaKey: true, altKey: true });
    fireEvent.keyDown(tree, { key: 'x', metaKey: true });
    await settle();
    expect(copied()).toEqual([]);
  });
});

describe('Copy ▾ on the selection bar', () => {
  function renderBar() {
    return render(
      inWorkspace(
        'JSON',
        <ResultViewer>
          <ResultViewer.SelectionBar onDeleteSelected={vi.fn()} />
          <ResultViewer.Json />
        </ResultViewer>,
      ),
    );
  }

  it('offers the three formats with a check on the stored one, and copying in one makes it the default', async () => {
    storedFormat('canonical');
    renderBar();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Select document …99439011' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy as…' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['EJSON (readable)', 'Canonical EJSON', 'mongosh']);
    // What mongosh cannot spell is named, not silently left as objects.
    expect(screen.getByTestId('copy-as-hint').textContent).toBe(`mongosh: ${MONGOSH_HINT}`);
    // Mantine draws the check as an svg in the item's right section.
    expect(items[1]!.querySelector('svg')).not.toBeNull();
    expect(items[0]!.querySelector('svg')).toBeNull();
    expect(items[2]!.querySelector('svg')).toBeNull();

    fireEvent.click(items[2]!);
    await settle();
    expect(copied()[0]).toContain(`ObjectId("${OID}")`);
    expect(prefSet).toHaveBeenCalledWith('ui.workspace.copyFormat', 'mongosh');

    // The plain Copy button now writes the new default.
    fireEvent.click(screen.getByTestId('selection-bar-copy'));
    await settle();
    expect(copied()[1]).toBe(copied()[0]);
  });

  it('the plain Copy button writes the stored format', async () => {
    storedFormat('canonical');
    renderBar();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Select document …99439011' }));
    fireEvent.click(screen.getByTestId('selection-bar-copy'));
    await settle();
    expect(JSON.parse(copied()[0]!).qty).toEqual({ $numberInt: '7' });
  });
});

describe('the row id and the document menu', () => {
  it('Tree: the id carries the full id as its title and a copy control', async () => {
    storedFormat('readable');
    renderTree();
    await settle();
    expect(screen.getAllByText('…99439011')[0]!.getAttribute('title')).toBe(OID);
    fireEvent.click(screen.getByRole('button', { name: 'Copy _id of document …99439011' }));
    await settle();
    expect(copied()).toEqual([OID]);
  });

  it('JSON: the More actions menu leads with Copy document and Copy _id', async () => {
    storedFormat('canonical');
    renderJson();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'More actions for document …99439011' }));
    const menu = screen.getByRole('group', { name: 'Document actions' });
    const labels = within(menu).getAllByRole('button').map((b) => b.textContent);
    expect(labels.slice(0, 2)).toEqual(['Copy document', 'Copy _id']);

    fireEvent.click(within(menu).getByRole('button', { name: 'Copy _id' }));
    await settle();
    expect(copied()).toEqual([OID]);

    fireEvent.click(screen.getByRole('button', { name: 'More actions for document …99439011' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy document' }));
    await settle();
    expect(JSON.parse(copied()[1]!).qty).toEqual({ $numberInt: '7' });
  });

  it('a document without an _id offers no Copy _id', async () => {
    storedFormat('readable');
    render(inWorkspace('JSON', <JsonView documents={[{ name: 'x' }]} />, [{ name: 'x' }]));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'More actions for document (no _id)' }));
    expect(screen.queryByRole('button', { name: 'Copy _id' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy document' })).toBeTruthy();
  });
});

describe('the JSON card copy button follows the format', () => {
  it.each([
    ['readable', /^Copy JSON for document/, 'Copy JSON'],
    ['canonical', /^Copy canonical EJSON for document/, 'Copy canonical EJSON'],
    ['mongosh', /^Copy as mongosh for document/, 'Copy as mongosh'],
  ] as const)('%s', async (format, name, tooltip) => {
    storedFormat(format);
    renderJson();
    await settle();
    const [button] = screen.getAllByRole('button', { name });
    expect(button).toBeTruthy();
    fireEvent.focus(button!);
    expect((await screen.findByRole('tooltip')).textContent).toBe(tooltip);
  });
});

describe('one toast for repeated copies', () => {
  it('six copies leave one toast, with the latest message', async () => {
    storedFormat('readable');
    render(<div />);
    for (let i = 0; i < 6; i += 1) {
      await act(async () => {
        await copyToClipboard(`value ${i}`, `Copied number ${i}.`);
      });
    }
    const toasts = document.querySelectorAll('.mantine-Notifications-notification');
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.textContent).toContain('Copied number 5.');
  });
});
