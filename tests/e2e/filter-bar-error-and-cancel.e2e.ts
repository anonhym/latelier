import { test, expect, type Page } from '@playwright/test';
import {
  baseConnInput,
  startMemoryServer,
  stopAllMemoryServers,
  withApp,
} from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import { seedActiveConnectionWithDocs } from './helpers/uiSeed';
import { expectConsoleClean } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

async function openOrders(win: Page, name: string, host: string, port: number) {
  await seedActiveConnectionWithDocs(
    win,
    { ...baseConnInput(host, port), name },
    {
      dbName: 'shop',
      collection: 'orders',
      docs: [
        { sku: 'apple-001', status: 'paid' },
        { sku: 'banana-002', status: 'pending' },
      ],
    },
  );
  const ws = new WorkspacePage(win);
  await ws.openCollectionFromNavigator('shop', 'orders');
  await expect(win.getByText('banana-002')).toBeVisible({ timeout: 8000 });
  return ws;
}

/**
 * W05 §9.4: a filter that cannot run closes Run, says why in a strip under the
 * row at the commit point, and runs once it is fixed.
 */
test('an unparseable filter: read the whole reason, fix it, run', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      const ws = await openOrders(win, 'Filter Bar Error', host, port);

      await ws.queryBarTextarea.fill('{status: /^pa/gi}');
      await ws.queryBarTextarea.blur();

      const strip = win.locator('#query-bar-filter-error');
      await expect(strip).toBeVisible();
      // Whole, not cut to one line: the reason names the flag and the position.
      await expect(strip).toContainText('"g"');
      await expect(strip).toContainText('Line 1, column 10');
      await expect(ws.queryBarRunButton).toBeDisabled();
      await expect(ws.queryBarRunButton).toContainText('Fix filter to run');

      await ws.queryBarTextarea.fill('{status: "pending"}');
      await ws.queryBarTextarea.blur();
      await expect(strip).toHaveCount(0);
      await expect(ws.queryBarRunButton).toBeEnabled();

      await ws.queryBarRunButton.click();
      await expect(win.getByText('apple-001')).toHaveCount(0);
      await expect(win.getByText('banana-002')).toBeVisible();
    });
  });
});

/** W05 §9.5: a slow find shows its running state and Cancel ends it, saying how long it ran. */
test('a slow find can be cancelled, and the status bar says how long it ran', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      const ws = await openOrders(win, 'Filter Bar Cancel', host, port);

      await ws.queryBarTextarea.fill('{"$where":"sleep(5000)||true"}');
      await ws.queryBarTextarea.blur();
      await ws.queryBarRunButton.click();

      await expect(win.locator('.query-running-bar')).toBeVisible();
      await expect(win.getByTestId('result-bar')).toContainText('Running');

      await win.locator('[data-testid="query-cancel-btn"]').click();
      await expect(win.getByTestId('result-cancelled')).toContainText('Cancelled after');
      await expect(win.locator('.query-running-bar')).toHaveCount(0);
      await expect(ws.queryBarRunButton).toBeVisible();
    });
  });
});
