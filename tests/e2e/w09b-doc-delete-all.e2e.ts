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
 * (T0.2) — bulk delete-by-query. The results overflow menu's
 * "Delete matching…" action scopes the existing two-step confirm flow
 * (type-collection-name + `doc:confirmDeleteMany` → token → `doc:deleteMany`)
 * to the tab's *current* query filter, so a user can delete every document
 * matching a filter without deleting one row at a time.
 */
test('delete all matching: overflow action deletes only the filtered rows and re-runs', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Bulk Delete Target' },
        {
          dbName: 'shop',
          collection: 'orders',
          docs: [
            { sku: 'stale-001', status: 'pending' },
            { sku: 'stale-002', status: 'pending' },
            { sku: 'keep-001', status: 'shipped' },
          ],
        },
      );
      await expectStatusDot(win, 'Bulk Delete Target', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');

      // Auto-run lands the unfiltered base query first; wait for it
      // before typing a filter (see w04-raw-query-bar for the same guard).
      await expect(win.getByText('keep-001')).toBeVisible({ timeout: 8000 });

      // Scope the tab to the "pending" rows via the raw query bar.
      await ws.queryBarTextarea.fill('{"status":"pending"}');
      await ws.queryBarRunButton.click();
      await expect(win.getByText('stale-001')).toBeVisible({ timeout: 8000 });
      await expect(win.getByText('stale-002')).toBeVisible();
      await expect(win.getByText('keep-001')).not.toBeVisible();

      // Open the results overflow menu and trigger delete-all.
      await ws.resultOverflowMenuButton.click();
      await ws.deleteAllMatchingMenuItem.click();

      // Dialog shows the *actual* matched count (2), not a placeholder.
      await expect(win.getByText('Delete 2 matching documents from shop.orders?')).toBeVisible({
        timeout: 5000,
      });
      // The filter that will run is on screen; a filter is never the red-band tier.
      await expect(win.getByTestId('delete-filter')).toHaveText('{"status":"pending"}');
      await expect(win.getByTestId('delete-all-band')).toHaveCount(0);

      // Destructive button stays disabled until the collection name is typed.
      const deleteBtn = win.getByRole('button', { name: 'Delete', exact: true });
      await expect(deleteBtn).toBeDisabled();
      await win.getByPlaceholder('orders').fill('orders');
      await expect(deleteBtn).toBeEnabled({ timeout: 5000 });
      await deleteBtn.click();

      // Re-run happens via onDeleted; both matching rows are gone. Switch
      // back to the unfiltered query to confirm the non-matching row
      // survived.
      await expect(win.getByText('stale-001')).not.toBeVisible({ timeout: 8000 });
      await expect(win.getByText('stale-002')).not.toBeVisible();

      await ws.queryBarTextarea.fill('{}');
      await ws.queryBarRunButton.click();
      await expect(win.getByText('keep-001')).toBeVisible({ timeout: 8000 });
      await expect(win.getByText('stale-001')).not.toBeVisible();
      await expect(win.getByText('stale-002')).not.toBeVisible();
    });
  });
});

test('delete matching with {} goes through the red band naming the total and the Connection', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Empty Filter Target' },
        { dbName: 'wipe', collection: 'orders', docs: [{ sku: 'a' }, { sku: 'b' }, { sku: 'c' }] },
      );
      await expectStatusDot(win, 'Empty Filter Target', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('wipe', 'orders');
      await expect(win.getByText('a', { exact: true }).first()).toBeVisible({ timeout: 8000 });

      await ws.resultOverflowMenuButton.click();
      await ws.deleteAllMatchingMenuItem.click();

      await expect(win.getByTestId('delete-all-band')).toHaveText(
        'No filter — this deletes all 3 documents in wipe.orders on Empty Filter Target',
        { timeout: 5000 },
      );
      const deleteBtn = win.getByRole('button', { name: 'Delete', exact: true });
      await expect(deleteBtn).toBeDisabled();
      await win.getByPlaceholder('orders').fill('orders');
      await expect(deleteBtn).toBeEnabled({ timeout: 5000 });
      await deleteBtn.click();

      await expect(win.getByTestId('pane-state')).toContainText('This collection is empty', { timeout: 8000 });
    });
  });
});
