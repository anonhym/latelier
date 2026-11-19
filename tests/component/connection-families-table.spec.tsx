import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { ConnectionExpandedTable } from '../../src/features/connections/ConnectionExpandedTable';
import { ConnectionSwitcher } from '../../src/features/connections/ConnectionSwitcher';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { ConnectionFamily, ConnectionSummary } from '@shared/types';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

function conn(overrides: Partial<ConnectionSummary>): ConnectionSummary {
  return {
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
    ...overrides,
  };
}

const ACME: ConnectionFamily = {
  id: 'fam-1',
  name: 'Acme',
  memberIds: ['c2'],
  createdAt: '2026-04-24T00:00:00.000Z',
  updatedAt: '2026-04-24T00:00:00.000Z',
};

const CONNS = [
  conn({ id: 'c1', name: 'Alpha' }),
  conn({ id: 'c2', name: 'Bravo', familyId: 'fam-1', familyName: 'Acme' }),
  conn({ id: 'c3', name: 'Charlie' }),
];

function renderTable(onClose = vi.fn()) {
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

async function openRowMenu(name: string) {
  // The row's actions show on the selected row only; a row already open stays open.
  if (!screen.queryByRole('button', { name: `Actions for ${name}` })) fireEvent.click(await screen.findByText(name));
  fireEvent.click(await screen.findByRole('button', { name: `Actions for ${name}` }));
}

describe('Connections table — families', () => {
  const setMembership = vi.fn();
  const create = vi.fn();

  beforeEach(() => {
    setMembership.mockReset().mockResolvedValue([ACME]);
    create.mockReset().mockResolvedValue({ ...ACME, id: 'fam-2', name: 'Globex', memberIds: [] });
    installAtelierMock({ families: { list: async () => [ACME], setMembership, create } as never });
  });

  it('shows each connection\'s Family in its own column, empty for none', async () => {
    renderTable();
    expect(await screen.findByRole('columnheader', { name: 'Family' })).toBeTruthy();
    const bravo = screen.getByText('Bravo').closest('tr') as HTMLElement;
    expect(within(bravo).getByRole('button', { name: 'Acme' })).toBeTruthy();
    const alpha = screen.getByText('Alpha').closest('tr') as HTMLElement;
    expect(within(alpha).queryByRole('button')).toBeNull();
  });

  it('adds a connection to an existing family from the row menu', async () => {
    const user = userEvent.setup();
    renderTable();
    await openRowMenu('Alpha');
    await user.click(await screen.findByRole('menuitem', { name: 'Add to family…' }));
    const dialog = await screen.findByRole('dialog', { name: /Add "Alpha" to a family/ });
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(setMembership).toHaveBeenCalledOnce());
    expect(setMembership.mock.calls[0]![0]).toMatchObject({ connectionIds: ['c1'], familyId: 'fam-1' });
  });

  it('makes a new family from "New family…" and moves the connection into it', async () => {
    const user = userEvent.setup();
    setMembership.mockResolvedValue([{ ...ACME, id: 'fam-2', name: 'Globex', memberIds: ['c1'] }]);
    renderTable();
    await openRowMenu('Alpha');
    await user.click(await screen.findByRole('menuitem', { name: 'Add to family…' }));
    const dialog = await screen.findByRole('dialog', { name: /Add "Alpha" to a family/ });
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Family' }), 'New family…');
    await user.type(within(dialog).getByLabelText('New family name'), 'Globex');
    await user.click(within(dialog).getByRole('button', { name: 'Create family' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: 'Globex' }));
    await waitFor(() => expect(setMembership).toHaveBeenCalledOnce());
    expect(setMembership.mock.calls[0]![0]).toMatchObject({ connectionIds: ['c1'], familyId: 'fam-2' });
  });

  it('shows a refused family name in the dialog and keeps it open', async () => {
    const user = userEvent.setup();
    create.mockRejectedValue({ code: 'CONFLICT', message: 'A family named Globex already exists' });
    renderTable();
    await openRowMenu('Alpha');
    await user.click(await screen.findByRole('menuitem', { name: 'Add to family…' }));
    const dialog = await screen.findByRole('dialog', { name: /Add "Alpha" to a family/ });
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Family' }), 'New family…');
    await user.type(within(dialog).getByLabelText('New family name'), 'Globex');
    await user.click(within(dialog).getByRole('button', { name: 'Create family' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('already exists');
    expect(setMembership).not.toHaveBeenCalled();
  });

  it('Leave family is disabled for a connection with no family', async () => {
    renderTable();
    await openRowMenu('Alpha');
    const item = await screen.findByRole('menuitem', { name: 'Leave family' });
    expect(item.hasAttribute('disabled') || item.getAttribute('aria-disabled') === 'true' || item.hasAttribute('data-disabled')).toBe(true);
    expect(item.getAttribute('title')).toBe('Not in a family');
  });

  it('leaves with the keep box ticked by default, and leaves without keeping when it is unticked', async () => {
    const user = userEvent.setup();
    setMembership.mockResolvedValue([ACME]);
    renderTable();
    await openRowMenu('Bravo');
    await user.click(await screen.findByRole('menuitem', { name: 'Leave family' }));
    let dialog = await screen.findByRole('dialog', { name: /Leave "Acme"\?/ });
    const keep = within(dialog).getByRole('checkbox', { name: /Keep the family's settings on this connection/ }) as HTMLInputElement;
    expect(keep.checked).toBe(true);
    await user.click(within(dialog).getByRole('button', { name: 'Leave family' }));
    await waitFor(() => expect(setMembership).toHaveBeenCalledOnce());
    expect(setMembership.mock.calls[0]![0]).toEqual({ connectionIds: ['c2'], familyId: null, keepAsLocal: true });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Leave/ })).toBeNull());
    await openRowMenu('Bravo');
    await user.click(await screen.findByRole('menuitem', { name: 'Leave family' }));
    dialog = await screen.findByRole('dialog', { name: /Leave "Acme"\?/ });
    await user.click(within(dialog).getByRole('checkbox', { name: /Keep the family's settings/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Leave family' }));
    await waitFor(() => expect(setMembership).toHaveBeenCalledTimes(2));
    expect(setMembership.mock.calls[1]![0]).toEqual({ connectionIds: ['c2'], familyId: null, keepAsLocal: false });
  });

  it('Escape closes the stacked dialog and leaves the table open', async () => {
    const user = userEvent.setup();
    const onClose = renderTable();
    await openRowMenu('Bravo');
    await user.click(await screen.findByRole('menuitem', { name: 'Leave family' }));
    await screen.findByRole('dialog', { name: /Leave "Acme"\?/ });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Leave/ })).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Connections' })).toBeTruthy();
  });

  it('batch actions on the checked rows: Add to family for all, Leave family only for those in one', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(await screen.findByRole('checkbox', { name: 'Check Alpha' }));
    const bar = screen.getByRole('toolbar', { name: 'Checked connections' });
    const leave = within(bar).getByRole('button', { name: 'Leave family' }) as HTMLButtonElement;
    expect(leave.disabled).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: 'Check Bravo' }));
    expect(leave.disabled).toBe(false);
    await user.click(within(bar).getByRole('button', { name: 'Add to family…' }));
    const dialog = await screen.findByRole('dialog', { name: /Add 2 connections to a family/ });
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(setMembership).toHaveBeenCalledOnce());
    expect(setMembership.mock.calls[0]![0].connectionIds).toEqual(['c1', 'c2']);
  });

  it('batch Leave family sends only the checked connections that are in a family', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(await screen.findByRole('checkbox', { name: 'Check Alpha' }));
    await user.click(screen.getByRole('checkbox', { name: 'Check Bravo' }));
    await user.click(within(screen.getByRole('toolbar', { name: 'Checked connections' })).getByRole('button', { name: 'Leave family' }));
    const dialog = await screen.findByRole('dialog', { name: /Leave "Acme"\?/ });
    await user.click(within(dialog).getByRole('button', { name: 'Leave family' }));
    await waitFor(() => expect(setMembership).toHaveBeenCalledOnce());
    expect(setMembership.mock.calls[0]![0].connectionIds).toEqual(['c2']);
  });

  it('the Family name opens the Family view without toggling the row', async () => {
    const user = userEvent.setup();
    renderTable();
    const row = (await screen.findByText('Bravo')).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Acme' }));
    expect(await screen.findByRole('dialog', { name: 'Family: Acme' })).toBeTruthy();
    expect(row.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('Connection Switcher — the Family name', () => {
  it('shows it after the connection name, read-only, and adds no control', () => {
    installAtelierMock();
    render(
      <ConnectionSwitcher
        connections={CONNS}
        focusedConnectionId="c1"
        onSwitch={vi.fn()}
        onManage={vi.fn()}
        onDisconnect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onExpand={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Alpha/ }));
    const row = screen.getByRole('option', { name: 'Bravo' });
    expect(within(row).getByText('Acme')).toBeTruthy();
    expect(row.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(row.getAttribute('aria-describedby')!)?.textContent).toContain('Family: Acme');
    expect(within(row).queryByRole('button', { name: /Acme/ })).toBeNull();
    expect(screen.getByRole('option', { name: 'Alpha' })).toBeTruthy();
  });
});
