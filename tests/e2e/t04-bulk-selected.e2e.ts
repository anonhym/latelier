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
 * to the shared DeleteConfirm count+token+type-to-confirm flow, scoped
 * to a `{_id:{$in:[...]}}` filter built from the selected rows.
 */
test('delete selected: bulk-selecting rows and confirming deletes only those rows', async () => {
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

      // No selection yet — the bulk-action bar isn't rendered (AC1).
      await expect(ws.selectionBarCount).toHaveCount(0);

      // ⌘/Ctrl+click two rows to bulk-select them (AC2).
      await win.getByText('row-001').click({ modifiers: [MULTI_SELECT_MODIFIER] });
      await win.getByText('row-002').click({ modifiers: [MULTI_SELECT_MODIFIER] });
      await expect(ws.selectionBarCount).toHaveText('2 selected');

      // Delete selected opens the shared DeleteConfirm flow scoped to just
      // the 2 selected rows (AC4) — same count+token+type-to-confirm path
      // as "Delete all matching".
      await ws.selectionBarDeleteButton.click();
      await expect(win.getByText('Delete 2 matching documents?')).toBeVisible({
        timeout: 5000,
      });

      // Scope to the modal — the bulk-action bar's own "Delete" button is
      // still on screen behind it and would otherwise collide with a bare
      // role query.
      const confirmDeleteBtn = win
        .getByLabel('Delete 2 matching documents?')
        .getByRole('button', { name: 'Delete', exact: true });
      await expect(confirmDeleteBtn).toBeDisabled();
      await win.getByPlaceholder('orders').fill('orders');
      await expect(confirmDeleteBtn).toBeEnabled({ timeout: 5000 });
      await confirmDeleteBtn.click();

      // Only the 2 selected rows are gone; the untouched row and the
      // selection state both reset (AC4, AC6).
      await expect(win.getByText('row-001')).not.toBeVisible({ timeout: 8000 });
      await expect(win.getByText('row-002')).not.toBeVisible();
      await expect(win.getByText('row-003')).toBeVisible();
      await expect(ws.selectionBarCount).toHaveCount(0);
    });
  });
});
