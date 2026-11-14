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

      // The server tab (and its Collections section) opens from the
      // Switcher row menu (C05 §11).
      await switcher.manage(name);

      // Switch to Collections tab.
      await win.getByRole('button', { name: 'Collections', exact: true }).click();

      // Filter input appears once the tab is active.
      // The navigator carries a field of the same name; this one sits right of it.
      const filterInput = win.locator('input[aria-label="Filter collections"]').last();
      await expect(filterInput).toBeVisible({ timeout: 5000 });

      // Turn on "Show system DBs" so the memory server's admin/local DBs appear.
      await win.getByText('Show system DBs').click();

      // At least 'admin' should appear (always present on a memory server).
      await expect(win.getByText('admin').first()).toBeVisible({ timeout: 8000 });
    });
  });
});
