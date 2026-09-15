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

/**
 * T2.6 — in-place cell editing in the Table view. Writes a single-field
 * `$set` directly via `api.doc.updateOne`, with no drawer involved — distinct
 * from W09/T0.3's EditDrawer "Update fields" mode, which goes through the
 * drawer's own textarea. Proves, end-to-end, that only the edited field
 * changes and every other field on the document survives untouched.
 */
test('table inline edit: hover pencil -> edit one cell -> only that field changes', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Inline Edit Target' },
        {
          dbName: 'shop',
          collection: 'orders',
          docs: [{ _id: 30, sku: 'multi-field', status: 'pending', qty: 5 }],
        },
      );
      await expectStatusDot(win, 'Inline Edit Target', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');

      await ws.queryBarRunButton.click();
      await expect(win.getByText('multi-field')).toBeVisible({ timeout: 8000 });

      // Switch to the Table view — the inline-edit affordance is Table-only.
      await ws.viewTableButton.click();
      const statusCell = win.getByTitle(/Drag to add "status/);
      await expect(statusCell).toBeVisible({ timeout: 8000 });

      await statusCell.hover();
      await statusCell.getByRole('button', { name: 'Edit cell value' }).click();

      const input = statusCell.getByRole('textbox');
      await input.fill('shipped');
      await input.press('Enter');

      // Re-run happens automatically on a successful update (Workspace.tsx's
      // `updateField`) — the edited field changes...
      await expect(win.getByText('shipped')).toBeVisible({ timeout: 8000 });
      // ...and the untouched fields survive: the load-bearing $set proof.
      await expect(win.getByText('multi-field')).toBeVisible();
      await expect(win.getByText('5')).toBeVisible();
    });
  });
});
