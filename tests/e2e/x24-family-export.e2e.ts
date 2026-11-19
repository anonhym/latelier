import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { baseConnInput, startMemoryServer, stopAllMemoryServers, withApp } from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import { seedActiveConnectionWithDocs } from './helpers/uiSeed';
import { expectConsoleClean } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

/**
 * X24: a Family's shared rule and Row Summary are exported from its view and
 * applied to a second Family whose member already has its own rule for the
 * same field. The summary names that member, its Override still wins in the
 * Tree view, and applying the same file again changes nothing.
 */
test('a family export is written, applied to another family, and applied again as a no-op', async () => {
  const server = await startMemoryServer();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x24-'));
  const file = path.join(dir, 'Source.latelier-family.json');

  try {
    await withApp(async (app) => {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');

      // The native save and open dialogs cannot be driven; main picks the file named here.
      await app.evaluate(({ dialog }, picked) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: picked });
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
      }, file);

      await expectConsoleClean(win, async () => {
        const a = await win.evaluate(async (input) => {
          const api = (window as unknown as { atelier: { conn: { create: (i: unknown) => Promise<{ id: string }> } } }).atelier;
          return api.conn.create(input);
        }, { ...baseConnInput(server.host, server.port), name: 'Client A' });
        const b = await seedActiveConnectionWithDocs(
          win,
          { ...baseConnInput(server.host, server.port), name: 'Client B' },
          { dbName: 'shop', collection: 'orders', docs: [{ _id: 'o1', customerId: 'cust-1', total: 10 }] },
        );

        await win.evaluate(
          async ({ aId, bId }) => {
            const api = (window as unknown as { atelier: Record<string, Record<string, (i: unknown) => Promise<{ id: string }>>> }).atelier;
            const source = await api.families!.create!({ name: 'Source', memberIds: [aId] });
            await api.families!.create!({ name: 'Target', memberIds: [bId] });
            await api.refs!.create!({
              owner: { familyId: source.id },
              sourceDb: 'shop',
              sourceCollection: 'orders',
              sourceField: 'customerId',
              targetDb: 'shop',
              targetCollection: 'customers',
              projection: ['name'],
            });
            await api.rowSummary!.set!({
              owner: { familyId: source.id },
              dbName: 'shop',
              collection: 'orders',
              fields: ['status', 'total'],
            });
            // B's own rule for the same field: an Override once the Target family shares one.
            await api.refs!.create!({
              owner: { connectionId: bId },
              sourceDb: 'shop',
              sourceCollection: 'orders',
              sourceField: 'customerId',
              targetDb: 'shop',
              targetCollection: 'clients',
            });
          },
          { aId: a.id, bId: b.id },
        );

        // Families were made through the bridge, so the connection list has not heard of them yet.
        await win.reload();
        await win.waitForLoadState('domcontentloaded');

        const ws = new WorkspacePage(win);
        const switcher = ws.switcher;

        // --- export from the Source family's view ------------------------------
        await switcher.openExpandedTable();
        const table = switcher.expandedTableDialog;
        await switcher.expandedTableRow('Client A').getByRole('button', { name: 'Source' }).click();
        const view = win.getByRole('dialog', { name: 'Family: Source' });
        await view.getByRole('button', { name: 'Export…', exact: true }).click();
        await expect.poll(() => fs.existsSync(file), { timeout: 5000 }).toBe(true);
        const written = fs.readFileSync(file, 'utf8');
        expect(written).toContain('"referenceRules"');
        expect(written).toContain('customerId');
        expect(written).toContain('"status"');
        expect(written).not.toMatch(/Client A|Client B|localhost|127\.0\.0\.1/);
        await win.keyboard.press('Escape');
        await expect(view).toBeHidden();

        // --- apply it to Target, whose member overrides the rule ----------------
        await switcher.expandedTableRow('Client B').getByRole('button', { name: 'Target' }).click();
        const targetView = win.getByRole('dialog', { name: 'Family: Target' });
        await targetView.getByRole('button', { name: 'Apply a family export…' }).click();
        const apply = win.getByRole('dialog', { name: 'Apply a family export' });
        await apply.getByRole('button', { name: 'Choose a file…' }).click();
        await expect(apply.getByLabel('Apply to')).toHaveValue(/.+/);
        await expect(apply.getByLabel('Apply to').locator('option:checked')).toHaveText('Target');
        await apply.getByRole('button', { name: 'Next' }).click();
        await expect(apply.getByRole('status').first()).toHaveText('2 settings added, 0 replaced, 0 kept, 0 unchanged.');
        const overridden = apply.getByRole('list', { name: 'Members that override what was applied' });
        await expect(overridden).toContainText('Client B');
        await expect(overridden).toContainText('shop.orders.customerId');
        await apply.getByRole('button', { name: 'Done' }).click();
        await expect(apply).toBeHidden();
        await win.keyboard.press('Escape');
        await expect(targetView).toBeHidden();

        // --- the same file again changes nothing --------------------------------
        await table.getByRole('button', { name: 'Apply family export…' }).click();
        const again = win.getByRole('dialog', { name: 'Apply a family export' });
        await again.getByRole('button', { name: 'Choose a file…' }).click();
        await again.getByLabel('Apply to').selectOption({ label: 'Target' });
        await again.getByRole('button', { name: 'Next' }).click();
        await expect(again.getByRole('status').first()).toHaveText('0 settings added, 0 replaced, 0 kept, 2 unchanged.');
        await again.getByRole('button', { name: 'Done' }).click();
        await expect(again).toBeHidden();

        // The reload that picked up the families dropped the active connection; connect B again.
        await switcher.expandedTableRow('Client B').click();
        await switcher.expandedTableConnect('Client B').click();
        await expect(table).toBeHidden();

        // --- B's Override still wins: its chip names its own target -------------
        await ws.openCollectionFromNavigator('shop', 'orders');
        await ws.viewTreeButton.click();
        await win.getByRole('button', { name: 'Expand document' }).first().click();
        await expect(win.getByRole('button', { name: 'Open reference to clients' })).toBeVisible({ timeout: 10_000 });
        await expect(win.getByRole('button', { name: 'Open reference to customers' })).toHaveCount(0);
      });
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
