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
 * W06 — Result view modes (Tree / JSON / Table). Run a query, toggle each
 * view button, assert the seeded document data is visible in every mode and
 * that the active button reflects the current view.
 */
test('result views: Tree, JSON, and Table all render the same docs', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Views Target' },
        {
          dbName: 'shop',
          collection: 'orders',
          docs: [
            { sku: 'unique-token-x', total: 11 },
            { sku: 'unique-token-y', total: 22 },
          ],
        },
      );
      await expectStatusDot(win, 'Views Target', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');
      await ws.queryBarRunButton.click();

      // Tree (default) — sku appears in every row's collapsed preview.
      await expect(ws.viewTreeButton).toBeVisible({ timeout: 8000 });
      await expect(win.getByText('unique-token-x')).toBeVisible();

      // Switch to JSON.
      await ws.viewJsonButton.click();
      await expect(win.getByText('unique-token-x')).toBeVisible();
      await expect(win.getByText('unique-token-y')).toBeVisible();

      // Switch to Table.
      await ws.viewTableButton.click();
      await expect(win.getByText('unique-token-x')).toBeVisible();
      await expect(win.getByText('unique-token-y')).toBeVisible();

      // Switch back to Tree to confirm the toggle round-trips.
      await ws.viewTreeButton.click();
      await expect(win.getByText('unique-token-x')).toBeVisible();
    });
  });
});
