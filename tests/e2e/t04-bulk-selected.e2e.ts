import { test, expect } from '@playwright/test';
import {
  baseConnInput,
  startMemoryServer,
  stopAllMemoryServers,
  withApp,
} from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import { seedActiveConnectionWithDocs } from './helpers/uiSeed';
import { expectConsoleClean, expectStatusDot } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

// Ctrl on Windows/Linux, Cmd on macOS — matches TreeView's documented
// "⌘/Ctrl+click to select" affordance.
const MULTI_SELECT_MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * (T0.4) — bulk actions on selected result rows. Selection was
 * previously a dead-ended cosmetic highlight; this wires "Delete selected"
 * to the shared DeleteConfirm count+token flow, scoped to a
 * `{_id:{$in:[...]}}` filter built from the selected rows. A selection of 20
 * or fewer is checked by eye: no typing (W08 §10).
 */
test('delete selected: three selected rows go after a plain confirm, with no typing', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Bulk Select Target' },
        {
          dbName: 'shop',
          collection: 'orders',
          docs: [
            { sku: 'row-001', status: 'pending' },
            { sku: 'row-002', status: 'pending' },
            { sku: 'row-003', status: 'shipped' },
            { sku: 'row-004', status: 'shipped' },
          ],
        },
      );
      await expectStatusDot(win, 'Bulk Select Target', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');

      // Auto-run lands the unfiltered base query; the default view is
      // Tree (shared/defaults.ts), so rows render via TreeView's collapsed
      // preview strip.
      await expect(win.getByText('row-001')).toBeVisible({ timeout: 8000 });
      await expect(win.getByText('row-002')).toBeVisible();
      await expect(win.getByText('row-003')).toBeVisible();
      await expect(win.getByText('row-004')).toBeVisible();

      // No selection yet — the bulk-action bar isn't rendered (AC1).
      await expect(ws.selectionBarCount).toHaveCount(0);

      // ⌘/Ctrl+click three rows to bulk-select them (AC2).
      for (const sku of ['row-001', 'row-002', 'row-003']) {
        await win.getByText(sku).click({ modifiers: [MULTI_SELECT_MODIFIER] });
      }
      await expect(ws.selectionBarCount).toHaveText('3 selected');

      // The plain tier: named by namespace, the three ids listed, nothing to type.
      await ws.selectionBarDeleteButton.click();
      const dialog = win.getByRole('dialog', { name: 'Delete 3 selected documents from shop.orders?' });
      await expect(dialog).toBeVisible({ timeout: 5000 });
      await expect(dialog.getByRole('list', { name: 'Documents to delete' }).getByRole('listitem')).toHaveCount(3);
      await expect(dialog.getByRole('textbox')).toHaveCount(0);
      // Enter on open lands on Cancel, never on Delete.
      await win.keyboard.press('Enter');
      await expect(dialog).toHaveCount(0);
      await expect(win.getByText('row-001')).toBeVisible();

      await ws.selectionBarDeleteButton.click();
      const confirmDeleteBtn = dialog.getByRole('button', { name: 'Delete', exact: true });
      await expect(confirmDeleteBtn).toBeEnabled({ timeout: 5000 });
      await confirmDeleteBtn.click();

      // Only the 3 selected rows are gone; the untouched row and the
      // selection state both reset (AC4, AC6).
      await expect(win.getByText('row-001')).not.toBeVisible({ timeout: 8000 });
      await expect(win.getByText('row-002')).not.toBeVisible();
      await expect(win.getByText('row-003')).not.toBeVisible();
      await expect(win.getByText('row-004')).toBeVisible();
      await expect(ws.selectionBarCount).toHaveCount(0);
    });
  });
});
