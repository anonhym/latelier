import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectionObject } from '../../src/pages/Workspace/collectionObject';
import { _resetExportRequestForTests, exportRequested } from '../../src/pages/Workspace/exportRequest';
import type { WorkspaceTabsState } from '../../src/state/workspaceTabs';
import type { PaletteContext } from '../../src/commands/types';

const ctx: PaletteContext = { pathname: '/workspace', connectionId: 'c1' };

function build(isView = false, activeView: string | undefined = 'documents') {
  const tab = { id: 't9', state: { activeView } };
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
  });
  const action = (id: string) => obj.actions.find((a) => a.id === id)!;
  return { obj, tabs, showStructure, requestDialog, action };
}

const input = { connectionId: 'c1', dbName: 'shop', collection: 'orders' };

afterEach(() => _resetExportRequestForTests());

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
    expect(exportRequested('t9')).toBe(true);
    _resetExportRequestForTests();

    const unset = build(false, undefined);
    await unset.action('export').perform(ctx);
    expect(unset.tabs.setActiveView).not.toHaveBeenCalled();

    const onStructure = build(false, 'structure');
    await onStructure.action('export').perform(ctx);
    expect(onStructure.tabs.setActiveView).toHaveBeenCalledWith('t9', 'documents');
    expect(exportRequested('t9')).toBe(true);
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
