import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor, emptyWorkspaceActions, emptyWorkspaceMeta } from '../helpers/render';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { TreeView } from '../../src/pages/Workspace/views/TreeView';
import { ResultBar } from '../../src/pages/Workspace/ResultBar';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import type { CollectionTabState, EffectiveRowSummary, RowSummary, SettingOwner } from '@shared/types';

const DOCS = [
  { _id: { $oid: '507f1f77bcf86cd799439011' }, name: 'alpha', city: 'Paris', plan: { tier: 'gold' }, zip: '75001' },
  { _id: { $oid: '507f1f77bcf86cd799439012' }, name: 'beta', city: 'Oslo', plan: { tier: 'free' }, zip: '0150' },
];

const STATE: CollectionTabState = {
  view: 'Tree',
  builder: { projection: [], sort: '', limit: '' },
  queryRaw: '{}',
  page: 0,
  pageSize: 50,
  activeBuilderTab: 'Builder',
  lastRun: { documents: DOCS, durationMs: 1, ranAt: '2026-01-01T00:00:00Z' },
};

const previewKeys = (c: HTMLElement) =>
  [...c.querySelectorAll('[data-testid="tree-preview-key"]')].map((k) => k.textContent);

/**
 * A Tree view and the result bar's menu on one workspace, over an in-memory
 * store behind `api.rowSummary`. The stateful store is what lets a save made in
 * the picker come back through `get` into the strip, which a static mock cannot.
 */
function Harness({ state = STATE }: { state?: CollectionTabState }) {
  return (
    <CollectionWorkspaceProvider
      state={state}
      actions={emptyWorkspaceActions()}
      meta={emptyWorkspaceMeta({ connectionId: 'c1', dbName: 'shop', collection: 'customers' })}
    >
      <ResultBar />
      <TreeView documents={DOCS} onSelect={() => {}} onRowExpand={() => {}} />
    </CollectionWorkspaceProvider>
  );
}

describe('TreeView — Row Summary', () => {
  let stored: EffectiveRowSummary | null;
  let set: ReturnType<typeof vi.fn>;
  let clear: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stored = null;
    set = vi.fn(async (input: { owner: SettingOwner; dbName: string; collection: string; fields: string[] }) => {
      stored = {
        id: 'rs1',
        owner: input.owner,
        dbName: input.dbName,
        collection: input.collection,
        fields: input.fields,
        updatedAt: '2026-01-01T00:00:00Z',
        origin: 'local',
      };
      return stored as RowSummary;
    });
    clear = vi.fn(async () => {
      stored = null;
    });
    installAtelierMock({
      rowSummary: { get: (async () => (stored ? { ...stored } : null)) as never, set: set as never, clear: clear as never },
    });
  });

  afterEach(() => uninstallAtelierMock());

  it('falls back to the first fields of the document when none is saved', async () => {
    const { container } = render(<Harness />);
    await waitFor(() => expect(previewKeys(container).length).toBeGreaterThan(0));
    expect(previewKeys(container).slice(0, 4)).toEqual(['name', 'city', 'plan', 'zip']);
  });

  it('shows a saved summary\'s fields in its order, a nested path included', async () => {
    stored = {
      id: 'rs1',
      owner: { connectionId: 'c1' },
      dbName: 'shop',
      collection: 'customers',
      fields: ['plan.tier', 'name'],
      updatedAt: '2026-01-01T00:00:00Z',
      origin: 'shared',
    };
    const { container } = render(<Harness />);
    await waitFor(() => expect(previewKeys(container).slice(0, 2)).toEqual(['plan.tier', 'name']));
    expect(container.textContent).toContain('gold');
    expect(previewKeys(container)).not.toContain('city');
  });

  it('does not show a saved summary field the Fields list hides, nor one under a hidden parent', async () => {
    stored = {
      id: 'rs1',
      owner: { connectionId: 'c1' },
      dbName: 'shop',
      collection: 'customers',
      fields: ['city', 'plan.tier', 'name'],
      updatedAt: '2026-01-01T00:00:00Z',
      origin: 'local',
    };
    const hidden = { ...STATE, columnConfig: { hidden: ['city', 'plan'] } } as CollectionTabState;
    const { container } = render(<Harness state={hidden} />);
    await waitFor(() => expect(previewKeys(container)).toContain('name'));
    expect(previewKeys(container)).not.toContain('city');
    expect(previewKeys(container)).not.toContain('plan.tier');
    expect(container.textContent).not.toContain('Paris');
    expect(container.textContent).not.toContain('gold');
  });

  it('round-trips: picking fields in the picker redraws the strip, and clearing brings the fallback back', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    await waitFor(() => expect(previewKeys(container).length).toBeGreaterThan(0));

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Row summary…' }));
    const input = await screen.findByLabelText('Field to add');
    await user.type(input, 'city{Enter}');
    await user.type(screen.getByLabelText('Field to add'), 'name{Enter}');
    await user.click(screen.getByRole('button', { name: 'Move name up' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(set).toHaveBeenCalledOnce());
    expect(set.mock.calls[0]![0]).toMatchObject({ owner: { connectionId: 'c1' }, dbName: 'shop', collection: 'customers', fields: ['name', 'city'] });
    await waitFor(() => expect(previewKeys(container).slice(0, 2)).toEqual(['name', 'city']));
    expect(previewKeys(container)).not.toContain('plan');

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Row summary…' }));
    await user.click(await screen.findByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(clear).toHaveBeenCalledOnce());
    await waitFor(() => expect(previewKeys(container).slice(0, 4)).toEqual(['name', 'city', 'plan', 'zip']));
  });

  it('refuses a fifth field and _id before asking main', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Row summary…' }));
    const typeField = async (f: string) => user.type(await screen.findByLabelText('Field to add'), `${f}{Enter}`);
    await typeField('_id');
    expect((await screen.findByRole('alert')).textContent).toContain('_id');
    for (const f of ['a', 'b', 'c', 'd']) await typeField(f);
    expect(screen.getByLabelText('Field to add')).toHaveProperty('disabled', true);
    expect(set).not.toHaveBeenCalled();
  });
});
