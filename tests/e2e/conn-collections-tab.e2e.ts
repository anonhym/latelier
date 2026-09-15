import { test, expect } from '@playwright/test';
import {
  baseConnInput,
  startMemoryServer,
  stopAllMemoryServers,
  withApp,
} from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import { seedActiveConnection } from './helpers/uiSeed';
import { expectStatusDot, expectConsoleClean } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

/**
 * C07 — Collections tab: switching to the Collections tab lists databases on
 * the connected server. The filter input is present and the DB list loads.
 *
 * MongoDB memory server always has an 'admin' and a 'local' database.
 */
test('collections tab: lists databases on the connected server', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      const switcher = new WorkspacePage(win).switcher;

      // X16.1 — `seedActiveConnection` chooses the Connection in the
      // Switcher, which opens and then closes the popover — so seed first,
      // then open it.
      const { name } = await seedActiveConnection(win, {
        ...baseConnInput(host, port),
        name: 'Collections Target',
      });
      await switcher.waitVisible();
      await expect(switcher.item(name)).toBeVisible({ timeout: 8000 });
      await expectStatusDot(win, name, 'connected');

      // reviewed: the deep detail screen (and its Collections tab) is
      // reached only via "Manage" (ADR 0001) and is still live, not the
      // retired bare `/connections` list.
      await switcher.manage(name);

      // Switch to Collections tab.
      await win.getByRole('button', { name: 'Collections', exact: true }).click();

      // Filter input appears once the tab is active.
      const filterInput = win.locator('input[aria-label="Filter collections"]');
      await expect(filterInput).toBeVisible({ timeout: 5000 });

      // Turn on "Show system DBs" so the memory server's admin/local DBs appear.
      await win.getByText('Show system DBs').click();

      // At least 'admin' should appear (always present on a memory server).
      await expect(win.getByText('admin').first()).toBeVisible({ timeout: 8000 });
    });
  });
});
