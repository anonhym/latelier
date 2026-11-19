import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { ConnectionExpandedTable } from '../../src/features/connections/ConnectionExpandedTable';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { ConnectionFamily, ConnectionSummary } from '@shared/types';
import { uniqueFamilyName } from '../../src/features/connections/familyCopy';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

const conn = (over: Partial<ConnectionSummary>): ConnectionSummary => ({
  id: 'c1',
  name: 'Alpha',
  color: '#1A6835',
  host: 'localhost',
  port: 27017,
  connectionType: 'standard',
  readOnly: false,
  status: 'unknown',
  familyId: null,
  familyName: null,
  ...over,
});

const ACME: ConnectionFamily = { id: 'fam-1', name: 'Acme', memberIds: ['c2'], createdAt: 'c', updatedAt: 'u' };
const CONNS = [conn({ id: 'c1', name: 'Alpha' }), conn({ id: 'c2', name: 'Bravo', familyId: 'fam-1', familyName: 'Acme' })];

function renderTable() {
  const onClose = vi.fn();
  render(
    <ConnectionExpandedTable
      connections={CONNS}
      initialQuery=""
      returnFocusTo={null}
      onClose={onClose}
      onConnect={vi.fn()}
      onManage={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onDisconnect={vi.fn()}
      onAdd={vi.fn()}
      onImport={vi.fn()}
      tabCountFor={() => 0}
      onDeleteMany={vi.fn(async () => undefined)}
    />,
  );
  return onClose;
}

describe('Connections table — Family Export', () => {
  const exportFn = vi.fn();
  const readExport = vi.fn();
  const planApply = vi.fn();
  const apply = vi.fn();
  const list = vi.fn();

  beforeEach(() => {
    exportFn.mockReset().mockResolvedValue({ saved: true, path: '/x', ruleCount: 2, rowSummaryCount: 1 });
    readExport.mockReset().mockResolvedValue({ token: 't', familyName: 'Other', ruleCount: 1, rowSummaryCount: 0 });
    planApply.mockReset().mockResolvedValue({ added: [], unchanged: [], conflicts: [] });
    apply.mockReset().mockResolvedValue({ familyId: 'fam-9', added: 1, replaced: 0, kept: 0, unchanged: 0, overriddenBy: [] });
    list.mockReset().mockResolvedValue([ACME]);
    installAtelierMock({ families: { list, export: exportFn, readExport, planApply, apply } as never });
  });

  it('applies from the toolbar with no target chosen', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(await screen.findByRole('button', { name: 'Apply family export…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Apply a family export' });
    await user.click(within(dialog).getByRole('button', { name: 'Choose a file…' }));
    const select = (await within(dialog).findByLabelText('Apply to')) as HTMLSelectElement;
    expect(select.value).toBe('fam-1');
  });

  it('reloads the families after an apply, so a new family appears', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(await screen.findByRole('button', { name: 'Apply family export…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Apply a family export' });
    await user.click(within(dialog).getByRole('button', { name: 'Choose a file…' }));
    await within(dialog).findByLabelText('Apply to');
    const before = list.mock.calls.length;
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(before));
  });

  it('opens from a Family view with that family as the target, and returns to the view on close', async () => {
    const user = userEvent.setup();
    renderTable();
    fireEvent.click(await screen.findByRole('button', { name: 'Acme' }));
    await screen.findByRole('dialog', { name: 'Family: Acme' });
    await user.click(await screen.findByRole('button', { name: 'Apply a family export…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Apply a family export' });
    await user.click(within(dialog).getByRole('button', { name: 'Choose a file…' }));
    expect(((await within(dialog).findByLabelText('Apply to')) as HTMLSelectElement).value).toBe('fam-1');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('dialog', { name: 'Family: Acme' })).toBeTruthy();
  });

  it('exports from the Family view and says what was written', async () => {
    const user = userEvent.setup();
    renderTable();
    fireEvent.click(await screen.findByRole('button', { name: 'Acme' }));
    await user.click(await screen.findByRole('button', { name: 'Export…' }));
    await waitFor(() => expect(exportFn).toHaveBeenCalledWith({ familyId: 'fam-1' }));
    expect(await screen.findByText('Exported 2 rules and 1 row summary from "Acme".')).toBeTruthy();
  });

  it('says so when the exported family shared nothing', async () => {
    exportFn.mockResolvedValue({ saved: true, path: '/x', ruleCount: 0, rowSummaryCount: 0 });
    const user = userEvent.setup();
    renderTable();
    fireEvent.click(await screen.findByRole('button', { name: 'Acme' }));
    await user.click(await screen.findByRole('button', { name: 'Export…' }));
    expect(await screen.findByText(/Saved an empty export: "Acme" shares nothing yet/)).toBeTruthy();
  });

  it('says nothing when the save dialog is cancelled, and shows a failed write', async () => {
    const user = userEvent.setup();
    renderTable();
    fireEvent.click(await screen.findByRole('button', { name: 'Acme' }));
    // Earlier tests' toasts may still be up; only a change in their number counts.
    const toasts = () => screen.queryAllByText(/Exported|Saved an empty/).length;
    const before = toasts();
    exportFn.mockResolvedValueOnce({ saved: false });
    await user.click(await screen.findByRole('button', { name: 'Export…' }));
    await waitFor(() => expect(exportFn).toHaveBeenCalledTimes(1));
    expect(toasts()).toBe(before);
    exportFn.mockRejectedValueOnce({ code: 'INTERNAL', message: 'failed to write family export' });
    await user.click(screen.getByRole('button', { name: 'Export…' }));
    expect(await screen.findByText('failed to write family export')).toBeTruthy();
  });
});

describe('uniqueFamilyName', () => {
  it('keeps a free name', () => {
    expect(uniqueFamilyName('Acme', ['Globex'])).toBe('Acme');
  });
  it('numbers a taken name, ignoring case', () => {
    expect(uniqueFamilyName('Acme', ['acme'])).toBe('Acme (2)');
  });
  it('takes the first free number', () => {
    expect(uniqueFamilyName('Acme', ['Acme', 'Acme (2)', 'acme (3)'])).toBe('Acme (4)');
    expect(uniqueFamilyName('Acme', ['Acme', 'Acme (3)'])).toBe('Acme (2)');
  });
});
