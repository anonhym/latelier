import { test, expect, type Page } from '@playwright/test';
import { baseConnInput, startMemoryServer, stopAllMemoryServers, withApp } from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import { seedActiveConnectionWithDocs } from './helpers/uiSeed';
import { expectConsoleClean } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

interface RuleRow {
  sourceField: string;
  origin: string;
  enabled: boolean;
}

/** What a Connection uses for `shop.orders`, read through the same channel every surface reads. */
async function effectiveRules(win: Page, connectionId: string): Promise<RuleRow[]> {
  return win.evaluate(async (id) => {
    const api = (
      window as unknown as {
        atelier: {
          refs: {
            list: (i: {
              connectionId: string;
              dbName: string;
              collection: string;
              effective: boolean;
            }) => Promise<RuleRow[]>;
          };
        };
      }
    ).atelier;
    return api.refs.list({ connectionId: id, dbName: 'shop', collection: 'orders', effective: true });
  }, connectionId);
}

const DOCS_ORDERS = [{ _id: 'o1', customerId: 'cust-1', total: 10 }];

/**
 * X23 — two Connections to two servers that hold the same `shop.orders`. They
 * join a Family, a rule saved on one is shared and shows on the other, the
 * other overrides it and resets it, and leaving with "keep" leaves the rule
 * behind as a local one.
 */
test('a shared reference rule reaches a family member, can be overridden and reset, and survives leaving', async () => {
  const serverA = await startMemoryServer();
  const serverB = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      const a = await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(serverA.host, serverA.port), name: 'Client A' },
        { dbName: 'shop', collection: 'orders', docs: DOCS_ORDERS },
      );
      const b = await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(serverB.host, serverB.port), name: 'Client B' },
        { dbName: 'shop', collection: 'orders', docs: DOCS_ORDERS },
      );
      const ws = new WorkspacePage(win);
      const switcher = ws.switcher;

      // --- put both in a new family, from the Connections table --------------
      await switcher.openExpandedTable();
      const table = switcher.expandedTableDialog;
      await table.getByRole('checkbox', { name: 'Check all shown connections' }).check();
      await table.getByRole('button', { name: 'Add to family…' }).click();
      const add = win.getByRole('dialog', { name: /Add 2 connections to a family/ });
      await add.getByRole('combobox', { name: 'Family' }).selectOption({ label: 'New family…' });
      await add.getByLabel('New family name').fill('Acme');
      await add.getByRole('button', { name: 'Create family' }).click();
      await expect(add).toBeHidden();
      await expect(switcher.expandedTableRow('Client A').getByRole('button', { name: 'Acme' })).toBeVisible();
      await expect(switcher.expandedTableRow('Client B').getByRole('button', { name: 'Acme' })).toBeVisible();
      await win.keyboard.press('Escape');
      await expect(table).toBeHidden();

      // --- a rule saved on A is shared by default -----------------------------
      await ws.openCollectionFromNavigator('shop', 'orders');
      await win.getByRole('button', { name: /^References \(/ }).click();
      const refsA = win.getByRole('dialog', { name: /Reference rules/ });
      await refsA.getByRole('button', { name: 'New rule' }).click();
      await refsA.getByLabel('Source field').fill('customerId');
      await refsA.getByPlaceholder('contacts').fill('customers');
      await refsA.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(refsA.getByText('customerId')).toBeVisible({ timeout: 5000 });
      await expect(refsA.getByText('Shared', { exact: true })).toBeVisible();
      await win.keyboard.press('Escape');
      await expect(refsA).toBeHidden();

      // --- B uses it without any setup ----------------------------------------
      expect(await effectiveRules(win, b.id)).toMatchObject([{ sourceField: 'customerId', origin: 'shared' }]);
      // Both roots list a `shop`; collapse A's so the navigator's row names address B's.
      await win.getByRole('treeitem', { name: /^Client A\./ }).click();
      await win.getByRole('treeitem', { name: /^Client B\./ }).click();
      await ws.openCollectionFromNavigator('shop', 'orders');
      await expect(win.getByRole('button', { name: 'References (1)' })).toBeVisible({ timeout: 10_000 });
      // The chip on the shared rule's field, in the Tree view's expanded row.
      await ws.viewTreeButton.click();
      await win.getByRole('button', { name: 'Expand document' }).first().click();
      await expect(win.getByRole('button', { name: 'Open reference to customers' })).toBeVisible({ timeout: 10_000 });

      // --- B overrides it, then resets ----------------------------------------
      await win.getByRole('button', { name: /^References \(/ }).click();
      const refsB = win.getByRole('dialog', { name: /Reference rules/ });
      await expect(refsB.getByText('Shared', { exact: true })).toBeVisible();
      await refsB.getByRole('button', { name: 'Edit rule' }).click();
      await refsB.getByLabel('Projection fields').fill('name');
      await refsB.getByRole('button', { name: 'Save', exact: true }).click();
      await refsB.getByRole('button', { name: 'Override on this connection' }).click();
      await expect(refsB.getByText('Overridden here')).toBeVisible({ timeout: 5000 });
      expect(await effectiveRules(win, a.id)).toMatchObject([{ origin: 'shared' }]);
      expect(await effectiveRules(win, b.id)).toMatchObject([{ origin: 'override' }]);

      await refsB.getByRole('button', { name: 'Reset customerId to shared' }).click();
      await expect(refsB.getByText('Shared', { exact: true })).toBeVisible({ timeout: 5000 });
      expect(await effectiveRules(win, b.id)).toMatchObject([{ origin: 'shared' }]);
      await win.keyboard.press('Escape');
      await expect(refsB).toBeHidden();

      // --- B leaves the family keeping the settings ---------------------------
      await switcher.openExpandedTable();
      await switcher.expandedTableRow('Client B').click();
      await switcher.expandedTableDialog.getByRole('button', { name: 'Actions for Client B' }).click();
      await win.getByRole('menuitem', { name: 'Leave family' }).click();
      const leave = win.getByRole('dialog', { name: /Leave "Acme"\?/ });
      await expect(leave.getByRole('checkbox', { name: /Keep the family's settings/ })).toBeChecked();
      await leave.getByRole('button', { name: 'Leave family' }).click();
      await expect(leave).toBeHidden();
      await expect(switcher.expandedTableRow('Client B').getByRole('button', { name: 'Acme' })).toHaveCount(0);
      await expect(switcher.expandedTableRow('Client A').getByRole('button', { name: 'Acme' })).toBeVisible();

      // B has the same rule it had, now its own; A still has the shared one.
      expect(await effectiveRules(win, b.id)).toMatchObject([{ sourceField: 'customerId', origin: 'local' }]);
      expect(await effectiveRules(win, a.id)).toMatchObject([{ sourceField: 'customerId', origin: 'shared' }]);
    });
  });
});
