import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, fireEvent, waitFor } from '../helpers/render';
import type { EffectiveReferenceRule } from '@shared/types';
import { ReferenceRulesEditor } from '../../src/features/references/ReferenceRulesEditor';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';

function withTheme(ui: React.ReactElement) {
  return ui;
}

const RULE: EffectiveReferenceRule = {
  origin: 'local',
  id: 'rule-1',
  owner: { connectionId: 'conn-1' },
  sourceDb: 'shop',
  sourceCollection: 'orders',
  sourceField: 'contact_id',
  targetDb: 'shop',
  targetCollection: 'contacts',
  targetField: '_id',
  projection: [],
  enabled: true,
  createdAt: '2026-04-24T00:00:00.000Z',
  updatedAt: '2026-04-24T00:00:00.000Z',
};

describe('ReferenceRulesEditor — delete confirm', () => {
  let listSpy: ReturnType<typeof vi.fn>;
  let deleteSpy: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<void>>>;

  beforeEach(() => {
    listSpy = vi.fn(async () => [RULE]);
    deleteSpy = vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
    installAtelierMock({
      refs: {
        list: listSpy as never,
        delete: deleteSpy as never,
      } as never,
    });
  });

  afterEach(() => {
    uninstallAtelierMock();
  });

  it('shows the Delete rule tooltip when keyboard focus lands on the icon button', async () => {
    render(
      <ReferenceRulesEditor
        connectionId="conn-1"
        dbName="shop"
        collection="orders"
        onClose={() => {}}
      />,
    );

    fireEvent.focus(await screen.findByLabelText('Delete rule'));

    const tip = await screen.findByRole('tooltip');
    expect(tip.textContent).toBe('Delete rule');
  });

  it('does not delete on the first click — surfaces an inline confirm row', async () => {
    render(
      withTheme(
        <ReferenceRulesEditor
          connectionId="conn-1"
          dbName="shop"
          collection="orders"
          onClose={() => {}}
        />,
      ),
    );

    const deleteBtn = await screen.findByLabelText('Delete rule');
    fireEvent.click(deleteBtn);

    // Inline confirm appears, IPC has not been called.
    expect(await screen.findByLabelText('Confirm delete')).toBeTruthy();
    expect(screen.getByLabelText('Cancel delete')).toBeTruthy();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('Cancel returns to the original delete affordance without calling IPC', async () => {
    render(
      withTheme(
        <ReferenceRulesEditor
          connectionId="conn-1"
          dbName="shop"
          collection="orders"
          onClose={() => {}}
        />,
      ),
    );

    fireEvent.click(await screen.findByLabelText('Delete rule'));
    fireEvent.click(await screen.findByLabelText('Cancel delete'));

    // Original trash button is back.
    expect(await screen.findByLabelText('Delete rule')).toBeTruthy();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('only the second click (Confirm delete) calls api.refs.delete', async () => {
    const onChanged = vi.fn();
    render(
      withTheme(
        <ReferenceRulesEditor
          connectionId="conn-1"
          dbName="shop"
          collection="orders"
          onClose={() => {}}
          onChanged={onChanged}
        />,
      ),
    );

    fireEvent.click(await screen.findByLabelText('Delete rule'));
    fireEvent.click(await screen.findByLabelText('Confirm delete'));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith({ id: 'rule-1' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  /**
   * #91 — Confirm delete is a native `<button>` that no longer goes
   * real-`disabled` while deleting (only `data-disabled`/`aria-disabled` —
   * a focused button that goes real `disabled` gets blurred to `<body>` by
   * Chromium, with nothing to restore it on a failure). `handleDelete`'s own
   * `deletingId` guard has to stop a second click from firing a second
   * `api.refs.delete` now.
   */
  it('a second click on Confirm delete while a delete is in flight calls api.refs.delete once', async () => {
    let resolveDelete!: () => void;
    deleteSpy.mockImplementation(() => new Promise<void>((r) => (resolveDelete = r)));

    render(
      withTheme(
        <ReferenceRulesEditor
          connectionId="conn-1"
          dbName="shop"
          collection="orders"
          onClose={() => {}}
        />,
      ),
    );

    fireEvent.click(await screen.findByLabelText('Delete rule'));
    const confirmBtn = await screen.findByLabelText('Confirm delete');
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn);

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    resolveDelete();
  });
});

describe('ReferenceRulesEditor — focus after the rule form closes', () => {
  beforeEach(() => {
    installAtelierMock({
      refs: {
        list: (async () => []) as never,
        create: (async () => RULE) as never,
      } as never,
    });
  });

  afterEach(() => {
    uninstallAtelierMock();
  });

  async function openNewRuleForm() {
    const user = userEvent.setup();
    render(
      <ReferenceRulesEditor
        connectionId="conn-1"
        dbName="shop"
        collection="orders"
        onClose={() => {}}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'New rule' }));
    return user;
  }

  function expectFocusOnNewRuleButton() {
    const newRule = screen.getByRole('button', { name: 'New rule' });
    expect(document.activeElement).toBe(newRule);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  }

  it('returns focus to New rule after a successful save unmounts the form', async () => {
    const user = await openNewRuleForm();
    await user.type(screen.getByLabelText('Source field'), 'contact_id');
    await user.type(screen.getByPlaceholderText('contacts'), 'contacts');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(screen.queryByText('Edit rule')).toBeNull());
    await waitFor(() => expectFocusOnNewRuleButton());
  });

  it('returns focus to New rule after Cancel unmounts the form', async () => {
    const user = await openNewRuleForm();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expectFocusOnNewRuleButton());
  });
});

describe('ReferenceRulesEditor — target database and collection suggestions', () => {
  const listDatabases = vi.fn();
  const listCollections = vi.fn();
  const create = vi.fn();

  beforeEach(() => {
    listDatabases.mockReset().mockResolvedValue([{ name: 'shop' }, { name: 'crm' }]);
    listCollections
      .mockReset()
      .mockImplementation(async ({ dbName }: { dbName: string }) =>
        dbName === 'crm' ? [{ name: 'contacts' }, { name: 'accounts' }] : [{ name: 'orders' }],
      );
    create.mockReset().mockResolvedValue(RULE);
    installAtelierMock({
      meta: { listDatabases, listCollections, sampleSchema: async () => ({ docs: [] }) } as never,
      refs: { list: (async () => []) as never, create: create as never } as never,
    });
  });

  afterEach(() => {
    uninstallAtelierMock();
  });

  async function openForm() {
    const user = userEvent.setup();
    render(<ReferenceRulesEditor connectionId="conn-1" dbName="shop" collection="orders" onClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'New rule' }));
    await screen.findByRole('combobox', { name: 'Target database' });
    return user;
  }

  it('offers the connection\'s databases and fills the field from the one picked', async () => {
    const user = await openForm();
    const db = screen.getByRole('combobox', { name: 'Target database' }) as HTMLInputElement;
    await user.clear(db);
    await user.click(db);
    await user.click(await screen.findByRole('option', { name: 'crm' }));
    expect(db.value).toBe('crm');
    expect(listDatabases).toHaveBeenCalledWith({ connectionId: 'conn-1' });
  });

  it('asks for the typed database\'s collections and offers them', async () => {
    const user = await openForm();
    const db = screen.getByRole('combobox', { name: 'Target database' }) as HTMLInputElement;
    await user.clear(db);
    await user.type(db, 'crm');
    await waitFor(() => expect(listCollections).toHaveBeenCalledWith({ connectionId: 'conn-1', dbName: 'crm', includeStats: false }));
    expect(listCollections).not.toHaveBeenCalledWith({ connectionId: 'conn-1', dbName: 'c', includeStats: false });
    const coll = screen.getByRole('combobox', { name: 'Target collection' }) as HTMLInputElement;
    await user.click(coll);
    await user.click(await screen.findByRole('option', { name: 'accounts' }));
    expect(coll.value).toBe('accounts');
  });

  it('keeps a database and collection that are in no list, and saves them', async () => {
    const user = await openForm();
    const db = screen.getByRole('combobox', { name: 'Target database' }) as HTMLInputElement;
    await user.clear(db);
    await user.type(db, 'brand_new');
    await user.type(screen.getByLabelText('Source field'), 'contact_id');
    await user.type(screen.getByRole('combobox', { name: 'Target collection' }), 'not_yet_there');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0]![0]).toMatchObject({ targetDb: 'brand_new', targetCollection: 'not_yet_there' });
  });

  it('says so when the lists cannot be read, and typing still works', async () => {
    listDatabases.mockRejectedValue(new Error('not authorized'));
    listCollections.mockRejectedValue(new Error('not authorized'));
    const user = await openForm();
    expect(await screen.findByText('Could not list databases; type a name.')).toBeTruthy();
    const db = screen.getByRole('combobox', { name: 'Target database' }) as HTMLInputElement;
    await user.clear(db);
    await user.type(db, 'crm');
    expect(db.value).toBe('crm');
    expect(await screen.findByText('Could not list collections; type a name.')).toBeTruthy();
    await user.type(screen.getByRole('combobox', { name: 'Target collection' }), 'contacts');
    expect((screen.getByRole('combobox', { name: 'Target collection' }) as HTMLInputElement).value).toBe('contacts');
  });

  it('asks for a database\'s collections once, however often it is typed again', async () => {
    const user = await openForm();
    const db = screen.getByRole('combobox', { name: 'Target database' }) as HTMLInputElement;
    await user.clear(db);
    await user.type(db, 'crm');
    await waitFor(() => expect(listCollections).toHaveBeenCalledWith({ connectionId: 'conn-1', dbName: 'crm', includeStats: false }));
    await user.clear(db);
    await user.type(db, 'crm');
    await new Promise((r) => setTimeout(r, 400));
    expect(listCollections.mock.calls.filter(([a]) => (a as { dbName: string }).dbName === 'crm')).toHaveLength(1);
  });
});
