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
 * W03 — Visual MQL builder. Add a condition row, fill field + value (op
 * defaults to `$eq`, valType defaults to `string` — see builder.ts), run, and
 * assert only matching docs appear. The QueryBar textarea and the BuilderPane
 * conditions are bound to the same compiler, so either Run path works.
 */
test('builder conditions: add field + value, run, assert filter applied', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Conditions Target' },
        {
          dbName: 'shop',
          collection: 'orders',
          docs: [
            { sku: 'apple-001', status: 'paid' },
            { sku: 'banana-002', status: 'pending' },
            { sku: 'cherry-003', status: 'paid' },
          ],
        },
      );
      await expectStatusDot(win, 'Conditions Target', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');

      // Opening the tab auto-runs the base (unfiltered) query. Wait for
      // that background find to render before driving the filter — otherwise
      // a manual Run landing while the auto-run is still in flight gets
      // silently dropped by the runner's single-flight guard, and this test
      // would observe the unfiltered auto-run result instead.
      await expect(win.getByText('banana-002')).toBeVisible({ timeout: 8000 });

      // Add a condition row, then fill its field + value.
      await win.getByRole('button', { name: 'Add condition' }).click();
      await win.getByPlaceholder('field').first().fill('status');
      await win.getByPlaceholder('value').first().fill('paid');

      // Run via the QueryBar button (BuilderPane state syncs through the same compiler).
      await ws.queryBarRunButton.click();

      await expect(win.getByText('apple-001')).toBeVisible({ timeout: 8000 });
      await expect(win.getByText('cherry-003')).toBeVisible();
      await expect(win.getByText('banana-002')).not.toBeVisible();
    });
  });
});
