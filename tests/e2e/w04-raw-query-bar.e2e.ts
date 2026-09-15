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
 * W04 — Raw query bar. Type a JSON filter directly into the QueryBar textarea
 * at the top of a collection tab, click Run, assert result rows match the
 * filter. BuilderPane visual conditions get their own coverage in w03.
 */
test('raw query bar: typed JSON filter narrows results on Run', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Builder Target' },
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
      await expectStatusDot(win, 'Builder Target', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');

      // Opening the tab auto-runs the base (unfiltered) query. Wait for
      // that background find to render before typing the filter — otherwise
      // a manual Run landing while the auto-run is still in flight gets
      // silently dropped by the runner's single-flight guard, and this test
      // would observe the unfiltered auto-run result instead.
      await expect(win.getByText('banana-002')).toBeVisible({ timeout: 8000 });

      // Type a JSON filter into the QueryBar textarea and run.
      await ws.queryBarTextarea.fill('{"status":"paid"}');
      await ws.queryBarRunButton.click();

      // Two paid orders should appear; the pending sku must not.
      await expect(win.getByText('apple-001')).toBeVisible({ timeout: 8000 });
      await expect(win.getByText('cherry-003')).toBeVisible();
      await expect(win.getByText('banana-002')).not.toBeVisible();
    });
  });
});
