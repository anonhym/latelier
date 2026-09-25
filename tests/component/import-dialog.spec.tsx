import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, emptyWorkspaceActions, emptyWorkspaceMeta } from '../helpers/render';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { ImportDialog } from '../../src/pages/Workspace/ImportDialog';
import { ResultBar } from '../../src/pages/Workspace/ResultBar';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import type { DataImportInput, ImportReport } from '@shared/types';
import type { PickFilePurpose } from '@shared/ipc';

const REPORT: ImportReport = {
  fileName: 'people.jsonl',
  format: 'jsonl',
  inserted: 1200,
  failed: 2,
  errors: [
    { at: 3, message: 'invalid document: Unexpected end of JSON input' },
    { at: 9, message: 'E11000 duplicate key error' },
  ],
  errorsTruncated: false,
};

function mockApi(opts: { path?: string | null; report?: ImportReport; fail?: unknown } = {}) {
  const pickFile = vi.fn<(purpose: PickFilePurpose) => Promise<{ path: string | null }>>(
    async () => ({ path: opts.path === undefined ? '/home/me/people.jsonl' : opts.path }),
  );
  const importFn = vi.fn<(input: DataImportInput) => Promise<ImportReport>>(async () => {
    if (opts.fail) throw opts.fail;
    return opts.report ?? REPORT;
  });
  installAtelierMock({ app: { pickFile } as never, data: { import: importFn } });
  return { pickFile, importFn };
}

function renderDialog(props: Partial<React.ComponentProps<typeof ImportDialog>> = {}) {
  const onClose = vi.fn();
  const onImported = vi.fn();
  render(
    <ImportDialog connectionId="c1" dbName="shop" collection="people" onClose={onClose} onImported={onImported} {...props} />,
  );
  return { onClose, onImported };
}

const choose = () => fireEvent.click(screen.getByRole('button', { name: 'Choose file…' }));

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('ImportDialog', () => {
  it('picks a data-import file, imports it and reports what landed and what failed', async () => {
    const { pickFile, importFn } = mockApi();
    const { onImported, onClose } = renderDialog();
    choose();

    expect((await screen.findByRole('status')).textContent).toBe(
      'Imported 1,200 documents from people.jsonl; 2 documents failed.',
    );
    expect(pickFile).toHaveBeenCalledWith('data-import');
    expect(importFn).toHaveBeenCalledWith({ connectionId: 'c1', dbName: 'shop', collection: 'people', path: '/home/me/people.jsonl' });
    expect(onImported).toHaveBeenCalledWith(REPORT);
    expect(onClose).not.toHaveBeenCalled();
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual([
      'Line 3: invalid document: Unexpected end of JSON input',
      'Line 9: E11000 duplicate key error',
    ]);
    expect(screen.queryByText(/Only the first/)).toBeNull();

    // The header's close button shares the name; this is the footer one.
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).find((b) => b.textContent === 'Close')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('labels array failures by index, says when the list is cut short, and omits the failure clause when none failed', async () => {
    mockApi({ report: { ...REPORT, format: 'json', errors: [{ at: 0, message: 'bad' }], errorsTruncated: true } });
    renderDialog();
    choose();
    expect(await screen.findByText('Index 0:')).toBeTruthy();
    expect(screen.getByText('Only the first 1 failures are listed.')).toBeTruthy();

    uninstallAtelierMock();
    mockApi({ report: { ...REPORT, inserted: 1, failed: 0, errors: [] } });
    fireEvent.click(screen.getByRole('button', { name: 'Import another file…' }));
    expect(await screen.findByText('Imported 1 document from people.jsonl.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('a cancelled picker runs nothing and leaves the dialog as it was', async () => {
    const { pickFile, importFn } = mockApi({ path: null });
    const { onImported } = renderDialog();
    choose();
    await vi.waitFor(() => expect(pickFile).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: 'Choose file…' })).toBeTruthy();
    expect(importFn).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ignores a second click while the first pick is still open', async () => {
    const { pickFile } = mockApi();
    let release!: () => void;
    pickFile.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ path: null }); }));
    renderDialog();
    choose();
    fireEvent.click(await screen.findByRole('button', { name: 'Importing…' }));
    expect(pickFile).toHaveBeenCalledTimes(1);
    release();
    expect(await screen.findByRole('button', { name: 'Choose file…' })).toBeTruthy();
  });

  it('shows a refused import in an alert and reports nothing', async () => {
    mockApi({ fail: { code: 'READ_ONLY', message: 'Connection "prod" is read-only.' } });
    const { onImported } = renderDialog();
    choose();
    expect((await screen.findByRole('alert')).textContent).toBe('Connection "prod" is read-only.');
    expect(onImported).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('disables the import on a connection known to be read-only', () => {
    const { pickFile } = mockApi();
    renderDialog({ readOnly: true });
    expect(screen.getByRole('alert').textContent).toMatch(/read-only/);
    const button = screen.getByRole('button', { name: 'Choose file…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(pickFile).not.toHaveBeenCalled();
  });
});

describe('ResultBar — Import documents', () => {
  beforeEach(() => mockApi({ report: { ...REPORT, failed: 0, errors: [] } }));

  it('opens the import dialog on this collection and re-runs the query once documents landed', async () => {
    const actions = emptyWorkspaceActions();
    render(
      <CollectionWorkspaceProvider
        state={{ view: 'Tree', builder: { projection: [], sort: '', limit: '' }, queryRaw: '{}', page: 0, pageSize: 50, activeBuilderTab: 'Builder' }}
        actions={actions}
        meta={emptyWorkspaceMeta({ collection: 'people' })}
      >
        <ResultBar />
      </CollectionWorkspaceProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Documents' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Import documents…/ }));
    expect(await screen.findByRole('dialog', { name: /Import into "people"/ })).toBeTruthy();
    expect(actions.run).not.toHaveBeenCalled();
    choose();
    await screen.findByRole('status');
    expect(actions.run).toHaveBeenCalledTimes(1);
  });
});
