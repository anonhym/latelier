import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
  emptyWorkspaceActions,
  emptyWorkspaceMeta,
} from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { TableView } from '../../src/pages/Workspace/views/TableView';
import { DocFieldTree } from '../../src/pages/Workspace/views/DocFieldTree';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import type { CollectionWorkspaceActions } from '../../src/pages/Workspace/context';
import type { CollectionTabState } from '@shared/types';
import { getCopyOrigin } from '../../src/utils/copyOrigin';

const LONG = 'x'.repeat(300);
const DOC = { _id: 1, note: LONG };

let writeText: ReturnType<typeof vi.fn>;
let originalClipboard: Clipboard;
beforeEach(() => {
  originalClipboard = navigator.clipboard;
  writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
});

const state = (): CollectionTabState => ({
  view: 'Table',
  builder: { projection: [], sort: '', limit: '' },
  queryRaw: '{}',
  page: 0,
  pageSize: 50,
  activeBuilderTab: 'Builder',
});

/** Renders a Table cell's popover under a parent that spies on every key, to prove the Escape stop. */
function renderTable(actions: Partial<CollectionWorkspaceActions> = {}) {
  const parentKeyDown = vi.fn();
  render(
    <div onKeyDown={parentKeyDown}>
      <CollectionWorkspaceProvider state={state()} actions={emptyWorkspaceActions(actions)} meta={emptyWorkspaceMeta()}>
        <TableView documents={[DOC]} onColumnResize={vi.fn()} onRowExpand={vi.fn()} />
      </CollectionWorkspaceProvider>
    </div>,
  );
  return { parentKeyDown };
}

async function openCellPopover() {
  const cell = screen.getByTitle(/Drag to add "note/);
  fireEvent.mouseEnter(cell);
  const trigger = within(cell).getByRole('button', { name: 'Expand cell value' });
  await userEvent.click(trigger);
  return { trigger, dialog: await screen.findByRole('dialog', { name: 'Full value' }) };
}

describe('the Table cell\'s Full value popover', () => {
  it('moves focus into the dropdown when a click opens it', async () => {
    renderTable();
    const { dialog } = await openCellPopover();

    await waitFor(() => expect(document.activeElement).toBe(dialog));
  });

  it('Escape closes a mouse-opened popover, returns focus to its trigger, and does not bubble', async () => {
    const { parentKeyDown } = renderTable();
    const { trigger, dialog } = await openCellPopover();
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    parentKeyDown.mockClear();

    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(parentKeyDown).not.toHaveBeenCalled();
  });

  it('is headed by the field path, the type and the length, and may grow to 60vh', async () => {
    renderTable();
    const { dialog } = await openCellPopover();

    expect(within(dialog).getByText('note')).toBeTruthy();
    expect(within(dialog).getByText('string')).toBeTruthy();
    expect(within(dialog).getByText('300 chars')).toBeTruthy();
    const body = within(dialog).getByText(`"${LONG}"`);
    expect(body.style.maxHeight).toBe('60vh');
  });

  it('Copy puts the untruncated value on the clipboard', async () => {
    renderTable();
    const { dialog } = await openCellPopover();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Copy' }));

    expect(writeText).toHaveBeenCalledWith(LONG);
  });

  it('Open in editor opens the Document Editor on that field and closes the popover', async () => {
    const openEdit = vi.fn();
    renderTable({ openEdit });
    const { dialog } = await openCellPopover();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Open in editor' }));

    expect(openEdit).toHaveBeenCalledWith(DOC, 'note');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('the field tree\'s Full value popover', () => {
  function renderFields(onOpenInEditor?: (fieldPath: string) => void) {
    return render(
      <DocFieldTree
        doc={{ outer: { note: LONG } }}
        docId="doc1"
        expandedPaths={new Set(['doc1::outer'])}
        onToggle={vi.fn()}
        copiedPath={null}
        onCopy={vi.fn()}
        onOpenMenu={vi.fn()}
        onOpenInEditor={onOpenInEditor}
      />,
    );
  }

  it('shows the dotted path in its header and opens the editor on it', async () => {
    const onOpenInEditor = vi.fn();
    renderFields(onOpenInEditor);
    const row = document.getElementById('field-row-doc1::outer.note')!;
    fireEvent.mouseEnter(row);

    await userEvent.click(within(row).getByRole('button', { name: 'Expand field value' }));
    const dialog = await screen.findByRole('dialog', { name: 'Full value' });
    expect(within(dialog).getByText('outer.note')).toBeTruthy();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Open in editor' }));
    expect(onOpenInEditor).toHaveBeenCalledWith('outer.note');
  });

  it('offers no Open in editor where the host gives no editor', async () => {
    renderFields();
    const row = document.getElementById('field-row-doc1::outer.note')!;
    fireEvent.mouseEnter(row);

    await userEvent.click(within(row).getByRole('button', { name: 'Expand field value' }));
    const dialog = await screen.findByRole('dialog', { name: 'Full value' });

    expect(within(dialog).queryByRole('button', { name: 'Open in editor' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Copy' })).toBeTruthy();
  });
});

describe('the Full value popover and the Copy Origin', () => {
  const META = { connectionId: 'conn-a', dbName: 'shop', collection: 'orders' };

  it('a Table cell\'s Copy records the value for its tab', async () => {
    render(
      <CollectionWorkspaceProvider state={state()} actions={emptyWorkspaceActions()} meta={emptyWorkspaceMeta(META)}>
        <TableView documents={[DOC]} onColumnResize={vi.fn()} onRowExpand={vi.fn()} />
      </CollectionWorkspaceProvider>,
    );
    const cell = screen.getByTitle(/Drag to add "note/);
    fireEvent.mouseEnter(cell);
    await userEvent.click(within(cell).getByRole('button', { name: 'Expand cell value' }));
    const dialog = await screen.findByRole('dialog', { name: 'Full value' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(getCopyOrigin()).toMatchObject({ ...META, text: LONG, fieldPath: 'note' }));
  });

  it('a field tree leaf\'s Copy records the value for its tab too', async () => {
    render(
      <CollectionWorkspaceProvider state={state()} actions={emptyWorkspaceActions()} meta={emptyWorkspaceMeta(META)}>
        <DocFieldTree
          doc={{ outer: { note: LONG } }}
          docId="doc1"
          expandedPaths={new Set(['doc1::outer'])}
          onToggle={vi.fn()}
          copiedPath={null}
          onCopy={vi.fn()}
          onOpenMenu={vi.fn()}
        />
      </CollectionWorkspaceProvider>,
    );
    const row = document.getElementById('field-row-doc1::outer.note')!;
    fireEvent.mouseEnter(row);
    await userEvent.click(within(row).getByRole('button', { name: 'Expand field value' }));
    const dialog = await screen.findByRole('dialog', { name: 'Full value' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(getCopyOrigin()).toMatchObject({ ...META, text: LONG, fieldPath: 'outer.note' }));
  });
});
