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
 * T0.1 — Wire up explain on a find query. The QueryBar's "Run options"
 * chevron (`QueryBar.tsx`) opens a menu with Run + Explain items. Explain
 * calls `api.query.explain` with the compiled MQL and reuses the shared
 * `ExplainDrawer` (`role="dialog"` + `aria-label="Explain plan"`).
 */
test('find explain: chevron menu runs a find and opens the explain drawer', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Explain Find Target' },
        {
          dbName: 'shop',
          collection: 'orders',
          docs: [
            { sku: 'apple-001', status: 'paid' },
            { sku: 'banana-002', status: 'pending' },
          ],
        },
      );
      await expectStatusDot(win, 'Explain Find Target', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');

      // Opening the tab auto-runs the base (unfiltered) query. Wait for
      // it to settle before driving the menu, matching w04's pattern.
      await expect(win.getByText('banana-002')).toBeVisible({ timeout: 8000 });

      // Open the "Run options" menu and choose Explain (queryPlanner).
      await ws.queryBarRunOptionsButton.click();
      await win.getByRole('menuitem', { name: 'queryPlanner' }).click();

      const drawer = win.getByRole('dialog', { name: 'Explain plan' });
      await expect(drawer).toBeVisible({ timeout: 8000 });
      await expect(drawer.locator('[aria-label="Verbosity"]')).toBeVisible();

      // X15 T6 — Mantine's close control, labelled "Close"; the bespoke
      // `aria-label="Close explain"` ✕ went away with the migration.
      await drawer.getByRole('button', { name: 'Close' }).click();
      await expect(drawer).not.toBeVisible({ timeout: 4000 });

      // The menu's "Run" item is additive, not a second path — it should
      // still trigger the same find as the primary Run button.
      await ws.queryBarTextarea.fill('{"status":"paid"}');
      await ws.queryBarRunOptionsButton.click();
      await win.getByRole('menuitem', { name: 'Run' }).click();

      await expect(win.getByText('apple-001')).toBeVisible({ timeout: 8000 });
      await expect(win.getByText('banana-002')).not.toBeVisible();
    });
  });
});
