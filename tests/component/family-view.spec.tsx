import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { FamilyView } from '../../src/features/connections/FamilyView';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { ConnectionFamily, ConnectionSummary, FamilySettings, ReferenceRule } from '@shared/types';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

function conn(id: string, name: string): ConnectionSummary {
  return {
    id,
    name,
    color: '#1A6835',
    host: 'localhost',
    port: 27017,
    connectionType: 'standard',
    readOnly: false,
    status: 'unknown',
  };
}

const CONNS = [conn('c1', 'Zulu'), conn('c2', 'Alpha'), conn('c3', 'Mike')];

const FAMILY: ConnectionFamily = {
  id: 'fam-1',
  name: 'Acme',
  memberIds: ['c1', 'c2'],
  createdAt: '2026-04-24T00:00:00.000Z',
  updatedAt: '2026-04-24T00:00:00.000Z',
};

const RULE: ReferenceRule = {
  id: 'r1',
  owner: { familyId: 'fam-1' },
  sourceDb: 'shop',
  sourceCollection: 'orders',
  sourceField: 'customerId',
  targetDb: 'shop',
  targetCollection: 'customers',
  targetField: '_id',
  projection: [],
  enabled: true,
  createdAt: '2026-04-24T00:00:00.000Z',
  updatedAt: '2026-04-24T00:00:00.000Z',
};

const SETTINGS: FamilySettings = {
  rules: [RULE, { ...RULE, id: 'r2', sourceField: 'sku', targetCollection: 'products' }],
  rowSummaries: [
    { id: 's1', owner: { familyId: 'fam-1' }, dbName: 'shop', collection: 'orders', fields: ['status', 'total'], updatedAt: '2026-04-24T00:00:00.000Z' },
    { id: 's2', owner: { familyId: 'fam-1' }, dbName: 'shop', collection: 'customers', fields: ['name'], updatedAt: '2026-04-24T00:00:00.000Z' },
  ],
};

describe('FamilyView', () => {
  const rename = vi.fn();
  const del = vi.fn();
  const onClose = vi.fn();
  const onRenamed = vi.fn();
  const onDeleted = vi.fn();

  beforeEach(() => {
    rename.mockReset().mockImplementation(async ({ name }: { name: string }) => ({ ...FAMILY, name }));
    del.mockReset().mockResolvedValue(undefined);
    onClose.mockReset();
    onRenamed.mockReset();
    onDeleted.mockReset();
    installAtelierMock({
      families: {
        settings: async () => SETTINGS,
        overrides: async () => ({
          rules: [{ ruleId: 'r1', connectionIds: ['c2', 'c1'] }],
          rowSummaries: [{ summaryId: 's2', connectionIds: ['c1'] }],
        }),
        rename,
        delete: del,
      } as never,
    });
  });

  function mount(extra: Partial<Parameters<typeof FamilyView>[0]> = {}) {
    return render(
      <FamilyView
        family={FAMILY}
        connections={CONNS}
        onClose={onClose}
        onRenamed={onRenamed}
        onDeleted={onDeleted}
        {...extra}
      />,
    );
  }

  it('lists the members by name, sorted', async () => {
    mount();
    const members = within(await screen.findByRole('list', { name: 'Members' }));
    expect(members.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Alpha', 'Zulu']);
  });

  it('lists the shared rules and row summaries, each with the members that override it', async () => {
    mount();
    const rules = within(await screen.findByRole('list', { name: 'Shared reference rules' }));
    const [overridden, plain] = rules.getAllByRole('listitem');
    expect(overridden!.textContent).toContain('shop.orders.customerId');
    expect(overridden!.textContent).toContain('overridden on Alpha, Zulu');
    expect(plain!.textContent).toContain('shop.orders.sku');
    expect(plain!.textContent).not.toContain('overridden');

    const summaries = within(screen.getByRole('list', { name: 'Shared row summaries' }));
    const [first, second] = summaries.getAllByRole('listitem');
    expect(first!.textContent).toContain('status, total');
    expect(first!.textContent).not.toContain('overridden');
    expect(second!.textContent).toContain('overridden on Zulu');
  });

  it('renames on Rename, and shows a refused name without closing', async () => {
    const user = userEvent.setup();
    mount();
    const input = await screen.findByLabelText('Family name');
    await user.clear(input);
    await user.type(input, 'Globex');
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(rename).toHaveBeenCalledWith({ id: 'fam-1', name: 'Globex' }));
    expect(onRenamed).toHaveBeenCalledWith(expect.objectContaining({ name: 'Globex' }));

    rename.mockRejectedValue({ code: 'CONFLICT', message: 'A family named Initech already exists' });
    await user.clear(input);
    await user.type(input, 'Initech');
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    expect((await screen.findByRole('alert')).textContent).toContain('already exists');
  });

  it('keeps Rename disabled until the name is a new one', async () => {
    mount();
    const btn = (await screen.findByRole('button', { name: 'Rename' })) as HTMLButtonElement;
    expect(btn.hasAttribute('data-disabled') || btn.disabled).toBe(true);
  });

  it('Delete family is type-to-confirm: refused until the exact name, then deletes keeping the settings by default', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Delete family…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(screen.getByText('Delete family "Acme"?')).toBeTruthy();
    expect(within(dialog).getByText('Alpha')).toBeTruthy();
    expect(within(dialog).getByText('Zulu')).toBeTruthy();
    const keep = within(dialog).getByRole('checkbox', { name: /Keep the shared settings on every member as local settings/ }) as HTMLInputElement;
    expect(keep.checked).toBe(true);

    const confirm = within(dialog).getByRole('button', { name: 'Delete family' });
    await user.click(confirm);
    expect(del).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText('Confirm family name'), 'acme');
    await user.click(confirm);
    expect(del).not.toHaveBeenCalled();
    await user.clear(within(dialog).getByLabelText('Confirm family name'));
    await user.type(within(dialog).getByLabelText('Confirm family name'), 'Acme');
    await user.click(confirm);
    await waitFor(() => expect(del).toHaveBeenCalledWith({ id: 'fam-1', keepAsLocal: true }));
    expect(onDeleted).toHaveBeenCalledOnce();
  });

  it('deletes without keeping when the box is unticked', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Delete family…' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('checkbox', { name: /Keep the shared settings/ }));
    await user.type(within(dialog).getByLabelText('Confirm family name'), 'Acme');
    await user.click(within(dialog).getByRole('button', { name: 'Delete family' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith({ id: 'fam-1', keepAsLocal: false }));
  });

  it('Escape on the delete dialog closes only it, not the Family view', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Delete family…' }));
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Family: Acme' })).toBeTruthy();
    expect(del).not.toHaveBeenCalled();
  });

  it('keeps the Family Export buttons disabled with a reason until they are wired, and calls them once they are', async () => {
    const user = userEvent.setup();
    const { unmount } = mount();
    const exportBtn = (await screen.findByRole('button', { name: 'Export…' })) as HTMLButtonElement;
    expect(exportBtn.disabled).toBe(true);
    expect(exportBtn.title).not.toBe('');
    unmount();

    const onExport = vi.fn();
    const onApplyExport = vi.fn();
    mount({ onExport, onApplyExport });
    await user.click(await screen.findByRole('button', { name: 'Export…' }));
    await user.click(screen.getByRole('button', { name: 'Apply a family export…' }));
    expect(onExport).toHaveBeenCalledWith(FAMILY);
    expect(onApplyExport).toHaveBeenCalledWith(FAMILY);
  });

  it('says so when the family has no members or settings', async () => {
    installAtelierMock({ families: { settings: async () => ({ rules: [], rowSummaries: [] }) } as never });
    mount({ family: { ...FAMILY, memberIds: [] } });
    expect(await screen.findByText(/No members yet/)).toBeTruthy();
    expect(await screen.findByText(/A rule saved from a member/)).toBeTruthy();
  });
});
