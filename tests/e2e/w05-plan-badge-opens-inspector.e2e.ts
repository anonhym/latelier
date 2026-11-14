import { test, expect } from '@playwright/test';
import { baseConnInput, startMemoryServer, stopAllMemoryServers, withApp } from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import { seedActiveConnectionWithDocs } from './helpers/uiSeed';
import { expectConsoleClean } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

/**
 * W05 §9.9 — the plan badge in the status bar is the way to the plan: one
 * click opens the Inspector on its Plan tab.
 */
test('plan badge opens the Inspector on the Plan tab', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Plan Badge' },
        { dbName: 'shop', collection: 'orders', docs: [{ sku: 'apple-001' }, { sku: 'banana-002' }] },
      );
      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');
      await expect(win.getByText('banana-002')).toBeVisible({ timeout: 8000 });

      // An empty filter has no plan worth a badge; a filtered one does.
      await ws.queryBarTextarea.fill('{"sku":"apple-001"}');
      await ws.queryBarRunButton.click();
      await expect(win.getByTestId('plan-badge')).toBeVisible({ timeout: 8000 });

      await expect(win.getByTestId('inspector')).toHaveCount(0);
      await win.getByTestId('plan-badge').click();

      await expect(win.getByTestId('inspector')).toBeVisible();
      await expect(win.getByTestId('inspector').getByRole('tab', { name: 'Plan', exact: true })).toHaveAttribute('aria-selected', 'true');
    });
  });
});
