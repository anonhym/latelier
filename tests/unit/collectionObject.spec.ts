import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectionObject } from '../../src/pages/Workspace/collectionObject';
import { _resetTabRequestsForTests, tabRequested } from '../../src/pages/Workspace/tabRequest';
import type { WorkspaceTabsState } from '../../src/state/workspaceTabs';
import type { PaletteContext } from '../../src/commands/types';
import { notify } from '../../src/theme/notifications';

const ctx: PaletteContext = { pathname: '/workspace', connectionId: 'c1' };

const docs = { documents: [{ _id: 1 }], durationMs: 1, ranAt: '2026-11-11T10:00:00.000Z' };

function build(
  isView = false,
  activeView: string | undefined = 'documents',
  dormant = false,
  lastRun: unknown = docs,
  running = false,
) {
  const tab = { id: 't9', state: { activeView, lastRun } };
  const tabs = {
    openCollection: vi.fn(async () => tab),
    openAggregation: vi.fn(async () => tab),
    setActiveView: vi.fn(),
  };
  const showStructure = vi.fn();
  const requestDialog = vi.fn();
  const obj = collectionObject({
    connectionId: 'c1',
    db: 'shop',
    coll: 'orders',
    isView,
    connectionName: 'Production',
    tabs: () => tabs as unknown as WorkspaceTabsState,
    showStructure,
    requestDialog,
    dormant: () => dormant,
    running: (id: string) => running && id === 't9',
  });
  const action = (id: string) => obj.actions.find((a) => a.id === id)!;
  return { obj, tabs, showStructure, requestDialog, action };
}

const input = { connectionId: 'c1', dbName: 'shop', collection: 'orders' };

afterEach(() => _resetTabRequestsForTests());

describe('collectionObject', () => {
  it('keeps the v1 row id and names the collection', () => {
    const { obj } = build();
    expect(obj).toMatchObject({ id: 'tab.open:c1:shop:orders', kind: 'collection', name: 'shop.orders', subtitle: 'Production' });
    expect(obj.keywords).toBeUndefined();
  });

  it('lists the actions in order, with their verbs, the alternate and the destructive one', () => {
    const { obj } = build();
    expect(obj.actions.map((a) => [a.id, a.verb, a.title, !!a.alternate, !!a.destructive])).toEqual([
      ['open', 'open', 'Open', false, false],
      ['open-new-tab', 'open', 'Open in new tab', true, false],
      ['aggregate', 'aggregate', 'Aggregate', false, false],
      ['schema', 'schema', 'Schema', false, false],
      ['indexes', 'indexes', 'Indexes', false, false],
      ['export', 'export', 'Export…', false, false],
      ['import', 'import', 'Import…', false, false],
      ['rename', 'rename', 'Rename…', false, false],
      ['drop', 'delete', 'Drop collection…', false, true],
    ]);
  });

  it('disables the writing actions on a view only, with a reason', () => {
    const reasons = (isView: boolean) => build(isView).obj.actions.map((a) => a.disabledReason?.(ctx) ?? null);
    expect(reasons(false)).toEqual(Array(9).fill(null));
    expect(reasons(true)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      "This is a view, so documents can't be imported here",
      "This is a view, so it can't be renamed here",
      "This is a view, so it can't be dropped here",
    ]);
  });

  it('opens reusing the tab, or a new one', async () => {
    const { tabs, action } = build();
    await action('open').perform(ctx);
    expect(tabs.openCollection).toHaveBeenLastCalledWith({ ...input, reuseExisting: true });
    await action('open-new-tab').perform(ctx);
    expect(tabs.openCollection).toHaveBeenLastCalledWith(input);
    await action('aggregate').perform(ctx);
    expect(tabs.openAggregation).toHaveBeenCalledWith(input);
  });

  it('shows Schema or Indexes on the reused tab', async () => {
    const { tabs, showStructure, action } = build();
    await action('schema').perform(ctx);
    expect(showStructure).toHaveBeenLastCalledWith('t9', 'Schema');
    await action('indexes').perform(ctx);
    expect(showStructure).toHaveBeenLastCalledWith('t9', 'Indexes');
    expect(tabs.openCollection).toHaveBeenCalledWith({ ...input, reuseExisting: true });
  });

  it('asks the tab for its Export dialog, from the Documents view', async () => {
    const onDocs = build();
    await onDocs.action('export').perform(ctx);
    expect(onDocs.tabs.openCollection).toHaveBeenCalledWith({ ...input, reuseExisting: true });
    expect(onDocs.tabs.setActiveView).not.toHaveBeenCalled();
    expect(tabRequested('export', 't9')).toBe(true);
    _resetTabRequestsForTests();

    const unset = build(false, undefined);
    await unset.action('export').perform(ctx);
    expect(unset.tabs.setActiveView).not.toHaveBeenCalled();

    const onStructure = build(false, 'structure');
    await onStructure.action('export').perform(ctx);
    expect(onStructure.tabs.setActiveView).toHaveBeenCalledWith('t9', 'documents');
    expect(tabRequested('export', 't9')).toBe(true);
  });

  describe('Export… decides from the tab as it stands, and queues nothing it cannot open', () => {
    const RUN_FIRST = 'Run the query, then choose Export again';
    const exportWith = async (...a: Parameters<typeof build>) => {
      const info = vi.spyOn(notify, 'info').mockImplementation(() => '');
      const built = build(...a);
      await built.action('export').perform(ctx);
      return { ...built, info };
    };
    afterEach(() => vi.restoreAllMocks());

    it('asks for the dialog on a settled result with documents', async () => {
      const { info } = await exportWith();
      expect(tabRequested('export', 't9')).toBe(true);
      expect(info).not.toHaveBeenCalled();
    });

    it('says the query matched nothing on a settled result of 0 documents', async () => {
      const { info } = await exportWith(false, 'documents', false, { ...docs, documents: [] });
      expect(info).toHaveBeenCalledWith('The query matched no documents, so there is nothing to export.');
      expect(tabRequested('export', 't9')).toBe(false);
    });

    it.each([
      // A restored tab: its result is not carried over.
      ['no result', null, false],
      ['an errored result', { ...docs, documents: [], error: { code: 'MONGO', message: 'boom' } }, false],
      ['a query running', docs, true],
    ])('says to run the query first with %s', async (_name, lastRun, running) => {
      const { info } = await exportWith(false, 'documents', false, lastRun, running);
      expect(info).toHaveBeenCalledWith(RUN_FIRST);
      expect(info).toHaveBeenCalledTimes(1);
      expect(tabRequested('export', 't9')).toBe(false);
    });

    it('on a dormant Connection, opens the tab and says to connect', async () => {
      const { tabs, info } = await exportWith(false, 'structure', true);
      expect(tabs.openCollection).toHaveBeenCalledWith({ ...input, reuseExisting: true });
      expect(info).toHaveBeenCalledWith('Connect to Production first, then export.');
      expect(info).toHaveBeenCalledTimes(1);
      expect(tabRequested('export', 't9')).toBe(false);
      expect(tabs.setActiveView).not.toHaveBeenCalled();
    });
  });

  it('asks the navigator for its Import, Rename and Drop dialogs', async () => {
    const { requestDialog, action } = build();
    await action('import').perform(ctx);
    expect(requestDialog).toHaveBeenLastCalledWith({ ...input, dialog: 'import' });
    await action('rename').perform(ctx);
    expect(requestDialog).toHaveBeenLastCalledWith({ ...input, dialog: 'rename' });
    await action('drop').perform(ctx);
    expect(requestDialog).toHaveBeenLastCalledWith({ ...input, dialog: 'drop' });
  });
});
