import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor, within } from '../helpers/render';
import type { ConnectionFamily, EffectiveReferenceRule, SettingOrigin } from '@shared/types';
import { ReferenceRulesEditor } from '../../src/features/references/ReferenceRulesEditor';
import { useReferenceRules } from '../../src/features/references/useReferenceRules';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';

const FAMILY: ConnectionFamily = {
  id: 'fam-1',
  name: 'Acme',
  memberIds: ['conn-1', 'conn-2'],
  createdAt: '2026-04-24T00:00:00.000Z',
  updatedAt: '2026-04-24T00:00:00.000Z',
};

function rule(id: string, field: string, origin: SettingOrigin, patch: Partial<EffectiveReferenceRule> = {}): EffectiveReferenceRule {
  return {
    id,
    owner: origin === 'shared' ? { familyId: FAMILY.id } : { connectionId: 'conn-1' },
    sourceDb: 'shop',
    sourceCollection: 'orders',
    sourceField: field,
    targetDb: 'shop',
    targetCollection: 'contacts',
    targetField: '_id',
    projection: [],
    enabled: true,
    createdAt: '2026-04-24T00:00:00.000Z',
    updatedAt: '2026-04-24T00:00:00.000Z',
    origin,
    ...patch,
  };
}

function renderEditor() {
  render(<ReferenceRulesEditor connectionId="conn-1" dbName="shop" collection="orders" onClose={() => {}} />);
}

describe('ReferenceRulesEditor — a Connection in a Family', () => {
  let rows: EffectiveReferenceRule[];
  const create = vi.fn();
  const update = vi.fn();
  const override = vi.fn();
  const resetToShared = vi.fn();
  const del = vi.fn();
  const list = vi.fn();

  beforeEach(() => {
    rows = [rule('s1', 'contact_id', 'shared'), rule('o1', 'owner_id', 'override'), rule('l1', 'tag_id', 'local')];
    create.mockReset().mockResolvedValue(rows[0]);
    update.mockReset().mockResolvedValue(rows[0]);
    override.mockReset().mockResolvedValue(rows[0]);
    resetToShared.mockReset().mockImplementation(async ({ id }: { id: string }) => {
      rows = rows.filter((r) => r.id !== id);
    });
    del.mockReset().mockResolvedValue(undefined);
    list.mockReset().mockImplementation(async () => rows.map((r) => ({ ...r })));
    installAtelierMock({
      refs: { list, create, update, override, resetToShared, delete: del } as never,
      families: { list: async () => [FAMILY] } as never,
    });
  });

  afterEach(() => {
    uninstallAtelierMock();
  });

  async function rowFor(field: string): Promise<HTMLElement> {
    const dialog = await screen.findByRole('dialog');
    const cell = await within(dialog).findByText(field);
    return cell.parentElement as HTMLElement;
  }

  it('asks for the effective set and badges each rule Shared, Overridden here or Local', async () => {
    renderEditor();
    expect(within(await rowFor('contact_id')).getByText('Shared')).toBeTruthy();
    expect(within(await rowFor('owner_id')).getByText('Overridden here')).toBeTruthy();
    expect(within(await rowFor('tag_id')).getByText('Local')).toBeTruthy();
    expect(list).toHaveBeenCalledWith({ connectionId: 'conn-1', dbName: 'shop', collection: 'orders', effective: true });
  });

  it('tells a mounted rules reader about a reset, whatever hosts the editor', async () => {
    const user = userEvent.setup();
    function Reader() {
      const { rules } = useReferenceRules('conn-1', 'shop', 'orders');
      return <div data-testid="reader">{rules.map((r) => r.id).join(',')}</div>;
    }
    render(
      <>
        <Reader />
        <ReferenceRulesEditor connectionId="conn-1" dbName="shop" collection="orders" onClose={() => {}} />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId('reader').textContent).toContain('o1'));
    await user.click(within(await rowFor('owner_id')).getByRole('button', { name: 'Reset owner_id to shared' }));
    await waitFor(() => expect(screen.getByTestId('reader').textContent).not.toContain('o1'));
  });

  it('offers Reset to shared on an Override only, and resets it with no confirm', async () => {
    const user = userEvent.setup();
    renderEditor();
    expect(within(await rowFor('contact_id')).queryByRole('button', { name: /Reset/ })).toBeNull();
    expect(within(await rowFor('tag_id')).queryByRole('button', { name: /Reset/ })).toBeNull();
    await user.click(within(await rowFor('owner_id')).getByRole('button', { name: 'Reset owner_id to shared' }));
    await waitFor(() => expect(resetToShared).toHaveBeenCalledWith({ id: 'o1' }));
    expect(screen.queryByText('Delete?')).toBeNull();
    await waitFor(() => expect(screen.queryByText('owner_id')).toBeNull());
  });

  it('shares a new rule with the family by default', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(await screen.findByRole('button', { name: 'New rule' }));
    await user.type(screen.getByLabelText('Source field'), 'new_id');
    await user.type(screen.getByPlaceholderText('contacts'), 'contacts');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0]![0]).toMatchObject({ owner: { familyId: 'fam-1' }, sourceField: 'new_id' });
  });

  it('keeps a new rule on this connection with "This connection only"', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(await screen.findByRole('button', { name: 'New rule' }));
    await user.type(screen.getByLabelText('Source field'), 'new_id');
    await user.type(screen.getByPlaceholderText('contacts'), 'contacts');
    await user.click(screen.getByRole('button', { name: 'This connection only' }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0]![0]).toMatchObject({ owner: { connectionId: 'conn-1' } });
  });

  it('asks before saving an edit to a shared rule, and changes it for the whole family on request', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(within(await rowFor('contact_id')).getByRole('button', { name: 'Edit rule' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(update).not.toHaveBeenCalled();
    expect(override).not.toHaveBeenCalled();
    const choice = screen.getByRole('group', { name: 'Apply this change to' });
    await user.click(within(choice).getByRole('button', { name: 'Change for the whole family' }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0]![0]).toMatchObject({ id: 's1' });
    expect(override).not.toHaveBeenCalled();
  });

  it('overrides the shared rule on this connection when asked', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(within(await rowFor('contact_id')).getByRole('button', { name: 'Edit rule' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: 'Override on this connection' }));
    await waitFor(() => expect(override).toHaveBeenCalledOnce());
    expect(override.mock.calls[0]![0]).toMatchObject({ connectionId: 'conn-1', sharedRuleId: 's1' });
    expect(update).not.toHaveBeenCalled();
  });

  it('saves an edit to a local rule without asking', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(within(await rowFor('tag_id')).getByRole('button', { name: 'Edit rule' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(screen.queryByRole('group', { name: 'Apply this change to' })).toBeNull();
  });

  it('names a shared rule\'s delete as for the whole family', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(within(await rowFor('contact_id')).getByLabelText('Delete rule'));
    expect(await screen.findByText('Delete for the whole family?')).toBeTruthy();
  });

  it('says the family already has a rule when the create is a CONFLICT, and links to the existing one', async () => {
    const user = userEvent.setup();
    create.mockRejectedValue({ code: 'CONFLICT', message: 'duplicate' });
    renderEditor();
    await user.click(await screen.findByRole('button', { name: 'New rule' }));
    await user.type(screen.getByLabelText('Source field'), 'contact_id');
    await user.type(screen.getByPlaceholderText('contacts'), 'contacts');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    const alert = await screen.findByText(/This family already has a rule for/);
    expect(alert.textContent).toContain('contact_id');
    await user.click(screen.getByRole('button', { name: 'Show it' }));
    expect(await screen.findByText('Edit rule')).toBeTruthy();
    expect((screen.getByLabelText('Source field') as HTMLInputElement).value).toBe('contact_id');
  });
});

describe('ReferenceRulesEditor — a Connection with no Family', () => {
  const create = vi.fn();

  beforeEach(() => {
    create.mockReset().mockResolvedValue(rule('x', 'a', 'local'));
    installAtelierMock({
      refs: { list: (async () => []) as never, create: create as never } as never,
      families: { list: async () => [FAMILY] } as never,
    });
  });

  afterEach(() => {
    uninstallAtelierMock();
  });

  it('offers no sharing choice and creates a local rule', async () => {
    const user = userEvent.setup();
    render(<ReferenceRulesEditor connectionId="conn-9" dbName="shop" collection="orders" onClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'New rule' }));
    await user.type(screen.getByLabelText('Source field'), 'a');
    await user.type(screen.getByPlaceholderText('contacts'), 'contacts');
    expect(screen.queryByRole('button', { name: 'This connection only' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0]![0]).toMatchObject({ owner: { connectionId: 'conn-9' } });
  });
});
