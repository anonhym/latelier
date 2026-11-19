import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor, within } from '../helpers/render';
import type {
  ConnectionFamily,
  ConnectionSummary,
  FamilyApplyPlan,
  FamilyApplyResult,
  FamilyExportItem,
  FamilyReadExportResult,
} from '@shared/types';
import { ApplyFamilyExportDialog } from '../../src/features/connections/ApplyFamilyExportDialog';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';

const FAMILIES: ConnectionFamily[] = [
  { id: 'f1', name: 'Acme', memberIds: ['c1'], createdAt: 'c', updatedAt: 'u' },
  { id: 'f2', name: 'Client deployments', memberIds: [], createdAt: 'c', updatedAt: 'u' },
];

const conn = (id: string, name: string): ConnectionSummary => ({
  id,
  name,
  color: '#1A6835',
  host: 'localhost',
  port: 27017,
  connectionType: 'standard',
  readOnly: false,
  status: 'unknown',
});
const CONNS = [conn('c1', 'Alpha'), conn('c2', 'Bravo')];

const READ: Extract<FamilyReadExportResult, { token: string }> = {
  token: 'tok',
  familyName: 'Client deployments',
  ruleCount: 2,
  rowSummaryCount: 1,
};

const ruleItem = (field: string, detail: string): FamilyExportItem => ({
  key: `rule:["shop","orders","${field}"]`,
  kind: 'rule',
  dbName: 'shop',
  collection: 'orders',
  field,
  detail,
});
const summaryItem = (detail: string): FamilyExportItem => ({
  key: 'summary:["shop","orders"]',
  kind: 'rowSummary',
  dbName: 'shop',
  collection: 'orders',
  detail,
});

const PLAN_CLEAN: FamilyApplyPlan = { added: [ruleItem('a', 'x')], unchanged: [], conflicts: [] };
const PLAN_CONFLICTS: FamilyApplyPlan = {
  added: [ruleItem('new', 'shop.t._id')],
  unchanged: [ruleItem('same', 'shop.t._id')],
  conflicts: [
    { key: ruleItem('customerId', '').key, current: ruleItem('customerId', 'shop.clients._id'), incoming: ruleItem('customerId', 'shop.customers._id') },
    { key: summaryItem('').key, current: summaryItem('old'), incoming: summaryItem('status, total') },
  ],
};
const RESULT: FamilyApplyResult = { familyId: 'f1', added: 1, replaced: 1, kept: 1, unchanged: 1, overriddenBy: [] };

/** Holds the family list the way the table does, so a created family shows up in the next open. */
function Harness({ onClose, initialFamilyId }: { onClose: () => void; initialFamilyId?: string | null }) {
  const [families, setFamilies] = React.useState(FAMILIES);
  return (
    <>
      <span data-testid="family-names">{families.map((f) => f.name).join('|')}</span>
      <ApplyFamilyExportDialog
        families={families}
        connections={CONNS}
        initialFamilyId={initialFamilyId}
        onClose={onClose}
        onApplied={(r) => {
          if (!families.some((f) => f.id === r.familyId)) {
            setFamilies([...families, { id: r.familyId, name: 'Created', memberIds: [], createdAt: 'c', updatedAt: 'u' }]);
          }
        }}
      />
    </>
  );
}

describe('ApplyFamilyExportDialog', () => {
  const readExport = vi.fn();
  const planApply = vi.fn();
  const apply = vi.fn();
  const onClose = vi.fn();
  const rulesList = vi.fn();

  beforeEach(() => {
    readExport.mockReset().mockResolvedValue(READ);
    planApply.mockReset().mockResolvedValue(PLAN_CLEAN);
    apply.mockReset().mockResolvedValue(RESULT);
    onClose.mockReset();
    rulesList.mockReset().mockResolvedValue([]);
    installAtelierMock({
      families: { readExport, planApply, apply } as never,
      refs: { list: rulesList } as never,
    });
  });
  afterEach(() => uninstallAtelierMock());

  const progress = () => screen.getByLabelText('Progress').textContent;

  async function toTarget(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Choose a file…' }));
    await screen.findByText(/reference rules and/);
  }

  it('starts on Open and moves to Target once a file is read, naming what it carries', async () => {
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    expect(progress()).toBe('Step 1 of 4: Open');
    await toTarget(user);
    expect(progress()).toBe('Step 2 of 4: Target');
    expect(screen.getByText(/2 reference rules and 1 row summary/)).toBeTruthy();
  });

  it('stays on Open when the dialog is cancelled', async () => {
    readExport.mockResolvedValue({ cancelled: true });
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    await user.click(await screen.findByRole('button', { name: 'Choose a file…' }));
    await waitFor(() => expect(readExport).toHaveBeenCalled());
    expect(progress()).toBe('Step 1 of 4: Open');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows why a file was refused, changes nothing, and offers another file', async () => {
    readExport.mockRejectedValueOnce({ code: 'VALIDATION', message: 'This is a Connection Export. Use Import in the Connections table.' });
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    await user.click(await screen.findByRole('button', { name: 'Choose a file…' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This is a Connection Export. Use Import in the Connections table.',
    );
    expect(progress()).toBe('Step 1 of 4: Open');
    expect(apply).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Choose another file…' }));
    await screen.findByText(/reference rules and/);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers every family plus a new one, preselecting the family it was opened from', async () => {
    const user = userEvent.setup();
    render(<Harness onClose={onClose} initialFamilyId="f2" />);
    await toTarget(user);
    const select = screen.getByLabelText('Apply to') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Acme', 'Client deployments', 'New family from this file']);
    expect(select.value).toBe('f2');
  });

  it('proposes the file name made unique for a new family, and sends it', async () => {
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    await toTarget(user);
    await user.selectOptions(screen.getByLabelText('Apply to'), 'New family from this file');
    expect((screen.getByLabelText('New family name') as HTMLInputElement).value).toBe('Client deployments (2)');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(planApply).toHaveBeenCalledWith({ token: 'tok', target: { newName: 'Client deployments (2)' } }));
  });

  it('does not let the name of the file pick an existing family, and blocks an empty new name', async () => {
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    await toTarget(user);
    expect((screen.getByLabelText('Apply to') as HTMLSelectElement).value).toBe('f1');
    await user.selectOptions(screen.getByLabelText('Apply to'), 'New family from this file');
    await user.clear(screen.getByLabelText('New family name'));
    const next = screen.getByRole('button', { name: 'Next' });
    expect(next.hasAttribute('data-disabled') || (next as HTMLButtonElement).disabled).toBe(true);
  });

  it('skips Conflicts and applies straight away when the plan has none', async () => {
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    await toTarget(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith({ token: 'tok', target: { familyId: 'f1' }, resolutions: {} }));
    expect(progress()).toBe('Step 4 of 4: Summary');
    expect(screen.getByRole('status').textContent).toBe('1 setting added, 1 replaced, 1 kept, 1 unchanged.');
  });

  describe('conflicts', () => {
    beforeEach(() => planApply.mockResolvedValue(PLAN_CONFLICTS));

    async function toConflicts(user: ReturnType<typeof userEvent.setup>) {
      await toTarget(user);
      await user.click(screen.getByRole('button', { name: 'Next' }));
      await screen.findByRole('list', { name: 'Conflicting settings' });
    }
    const applyButton = () => screen.getByRole('button', { name: 'Apply' });
    const disabled = (b: HTMLElement) => b.hasAttribute('data-disabled') || (b as HTMLButtonElement).disabled;

    it('shows current and incoming side by side and applies nothing yet', async () => {
      const user = userEvent.setup();
      render(<Harness onClose={onClose} />);
      await toConflicts(user);
      expect(progress()).toBe('Step 3 of 4: Conflicts');
      const list = within(screen.getByRole('list', { name: 'Conflicting settings' }));
      expect(list.getAllByRole('listitem')).toHaveLength(2);
      expect(list.getByText('shop.clients._id')).toBeTruthy();
      expect(list.getByText('shop.customers._id')).toBeTruthy();
      expect(screen.getByText(/1 setting will be added and 1 setting already match/)).toBeTruthy();
      expect(apply).not.toHaveBeenCalled();
    });

    it('needs an answer for every conflict before Apply, then sends them', async () => {
      const user = userEvent.setup();
      render(<Harness onClose={onClose} />);
      await toConflicts(user);
      expect(disabled(applyButton())).toBe(true);
      const [first, second] = within(screen.getByRole('list', { name: 'Conflicting settings' })).getAllByRole('listitem');
      await user.click(within(first!).getByLabelText(/Take the file's/));
      expect(disabled(applyButton())).toBe(true);
      await user.click(within(second!).getByLabelText(/Keep current/));
      expect(disabled(applyButton())).toBe(false);
      await user.click(applyButton());
      await waitFor(() =>
        expect(apply).toHaveBeenCalledWith({
          token: 'tok',
          target: { familyId: 'f1' },
          resolutions: { [PLAN_CONFLICTS.conflicts[0]!.key]: 'take', [PLAN_CONFLICTS.conflicts[1]!.key]: 'keep' },
        }),
      );
      expect(await screen.findByText('Step 4 of 4: Summary', { exact: false })).toBeTruthy();
    });

    it('"for all remaining" answers only the conflicts not yet answered', async () => {
      const user = userEvent.setup();
      render(<Harness onClose={onClose} />);
      await toConflicts(user);
      const [first] = within(screen.getByRole('list', { name: 'Conflicting settings' })).getAllByRole('listitem');
      await user.click(within(first!).getByLabelText(/Keep current/));
      await user.click(screen.getByRole('button', { name: "Take the file's for all remaining" }));
      expect(disabled(applyButton())).toBe(false);
      await user.click(applyButton());
      await waitFor(() =>
        expect(apply).toHaveBeenCalledWith(
          expect.objectContaining({
            resolutions: { [PLAN_CONFLICTS.conflicts[0]!.key]: 'keep', [PLAN_CONFLICTS.conflicts[1]!.key]: 'take' },
          }),
        ),
      );
    });

    it('turns the "all remaining" buttons off once everything is answered', async () => {
      const user = userEvent.setup();
      render(<Harness onClose={onClose} />);
      await toConflicts(user);
      await user.click(screen.getByRole('button', { name: 'Keep current for all remaining' }));
      expect(disabled(screen.getByRole('button', { name: 'Keep current for all remaining' }))).toBe(true);
      expect(disabled(screen.getByRole('button', { name: "Take the file's for all remaining" }))).toBe(true);
    });

    it('goes back to Target from Conflicts', async () => {
      const user = userEvent.setup();
      render(<Harness onClose={onClose} />);
      await toConflicts(user);
      await user.click(screen.getByRole('button', { name: 'Back' }));
      expect(progress()).toBe('Step 2 of 4: Target');
    });

    it('forgets the answers when Back leads to another family, since they were about the first one\'s settings', async () => {
      const user = userEvent.setup();
      render(<Harness onClose={onClose} />);
      await toConflicts(user);
      await user.click(screen.getByRole('button', { name: 'Keep current for all remaining' }));
      expect(disabled(applyButton())).toBe(false);
      await user.click(screen.getByRole('button', { name: 'Back' }));
      await user.selectOptions(screen.getByLabelText('Apply to'), 'f2');
      await user.click(screen.getByRole('button', { name: 'Next' }));
      await screen.findByRole('list', { name: 'Conflicting settings' });
      expect(disabled(applyButton())).toBe(true);
    });

    it('checks again when the family changed meanwhile, keeping answers that still apply', async () => {
      const user = userEvent.setup();
      render(<Harness onClose={onClose} />);
      await toConflicts(user);
      await user.click(screen.getByRole('button', { name: 'Keep current for all remaining' }));
      apply.mockRejectedValueOnce({ code: 'CONFLICT', message: 'The family changed' });
      // The new plan has only the first conflict left.
      planApply.mockResolvedValueOnce({ ...PLAN_CONFLICTS, conflicts: [PLAN_CONFLICTS.conflicts[0]!] });
      await user.click(applyButton());
      await waitFor(() => expect(planApply).toHaveBeenCalledTimes(2));
      expect(await screen.findByText(/The family changed while you were choosing/)).toBeTruthy();
      expect(within(screen.getByRole('list', { name: 'Conflicting settings' })).getAllByRole('listitem')).toHaveLength(1);
      expect(disabled(applyButton())).toBe(false);
      await user.click(applyButton());
      await waitFor(() =>
        expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ resolutions: { [PLAN_CONFLICTS.conflicts[0]!.key]: 'keep' } })),
      );
    });

    it('returns to Target when the family was deleted meanwhile', async () => {
      const user = userEvent.setup();
      render(<Harness onClose={onClose} />);
      await toConflicts(user);
      await user.click(screen.getByRole('button', { name: 'Keep current for all remaining' }));
      apply.mockRejectedValueOnce({ code: 'NOT_FOUND', message: 'family f1 not found' });
      await user.click(applyButton());
      expect((await screen.findByRole('alert')).textContent).toBe('family f1 not found');
      expect(progress()).toBe('Step 2 of 4: Target');
    });

    it('shows a write failure and stays on Conflicts so nothing is lost', async () => {
      const user = userEvent.setup();
      render(<Harness onClose={onClose} />);
      await toConflicts(user);
      await user.click(screen.getByRole('button', { name: 'Take the file\'s for all remaining' }));
      apply.mockRejectedValueOnce({ code: 'INTERNAL', message: 'disk full' });
      await user.click(applyButton());
      expect((await screen.findByRole('alert')).textContent).toBe('disk full');
      expect(progress()).toBe('Step 3 of 4: Conflicts');
      expect(disabled(applyButton())).toBe(false);
    });
  });

  describe('summary', () => {
    const OVERRIDDEN: FamilyApplyResult = {
      ...RESULT,
      overriddenBy: [
        {
          connectionId: 'c1',
          keys: [ruleItem('customerId', '').key, summaryItem('').key],
          items: [ruleItem('customerId', 'x'), summaryItem('y')],
        },
      ],
    };

    async function toSummary(user: ReturnType<typeof userEvent.setup>) {
      apply.mockResolvedValue(OVERRIDDEN);
      render(<Harness onClose={onClose} />);
      await toTarget(user);
      await user.click(screen.getByRole('button', { name: 'Next' }));
      await screen.findByRole('list', { name: 'Members that override what was applied' });
    }

    it('lists the members that override what was brought in, by name', async () => {
      const user = userEvent.setup();
      await toSummary(user);
      const list = within(screen.getByRole('list', { name: 'Members that override what was applied' }));
      expect(list.getByText('Alpha')).toBeTruthy();
      expect(list.getByText('shop.orders.customerId')).toBeTruthy();
      expect(list.getByText('shop.orders (row summary)')).toBeTruthy();
    });

    it('links each overridden rule, not a row summary, to its Reference Rules editor', async () => {
      const user = userEvent.setup();
      await toSummary(user);
      expect(screen.getAllByRole('button', { name: /Open the reference rules/ })).toHaveLength(1);
      await user.click(screen.getByRole('button', { name: 'Open the reference rules of Alpha for shop.orders' }));
      await waitFor(() => expect(rulesList).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'c1', dbName: 'shop', collection: 'orders' })));
      expect(await screen.findByText(/Reference rules/i)).toBeTruthy();
    });

    it('shows no override list when nothing is overridden', async () => {
      const user = userEvent.setup();
      render(<Harness onClose={onClose} />);
      await toTarget(user);
      await user.click(screen.getByRole('button', { name: 'Next' }));
      await screen.findByRole('status');
      expect(screen.queryByRole('list', { name: /override/ })).toBeNull();
    });

    it('lists a family created by the apply for the next open', async () => {
      const user = userEvent.setup();
      apply.mockResolvedValue({ ...RESULT, familyId: 'new-id' });
      render(<Harness onClose={onClose} />);
      await toTarget(user);
      await user.selectOptions(screen.getByLabelText('Apply to'), 'New family from this file');
      await user.click(screen.getByRole('button', { name: 'Next' }));
      await screen.findByRole('status');
      expect(screen.getByTestId('family-names').textContent).toBe('Acme|Client deployments|Created');
    });

    it('Done closes', async () => {
      const user = userEvent.setup();
      await toSummary(user);
      await user.click(screen.getByRole('button', { name: 'Done' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Escape', () => {
    it('closes the dialog when nothing is stacked on it', async () => {
      const user = userEvent.setup();
      render(<Harness onClose={onClose} />);
      await screen.findByRole('button', { name: 'Choose a file…' });
      await user.keyboard('{Escape}');
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });

    it('closes only the Reference Rules editor stacked on it, not the dialog', async () => {
      const user = userEvent.setup();
      apply.mockResolvedValue({
        ...RESULT,
        overriddenBy: [{ connectionId: 'c1', keys: ['k'], items: [ruleItem('customerId', 'x')] }],
      });
      render(<Harness onClose={onClose} />);
      await toTarget(user);
      await user.click(screen.getByRole('button', { name: 'Next' }));
      await user.click(await screen.findByRole('button', { name: /Open the reference rules/ }));
      await waitFor(() => expect(rulesList).toHaveBeenCalled());
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(1));
      expect(onClose).not.toHaveBeenCalled();
      expect(progress()).toBe('Step 4 of 4: Summary');
    });
  });

  it('Cancel closes from any step before the summary', async () => {
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    await toTarget(user);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
  });
});
