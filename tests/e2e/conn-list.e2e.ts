import { test, expect } from '@playwright/test';
import {
  baseConnInput,
  startMemoryServer,
  stopAllMemoryServers,
  withApp,
} from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import { seedConnection } from './helpers/uiSeed';
import { expectConsoleClean } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

/**
 * ConnectionSwitcher popover (the one canonical Connection list, ADR 0001):
 * seeded connections appear, filter works, clicking a row makes it Active.
 */
test('connection list: shows all connections, filters by name, and selects', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      const switcher = new WorkspacePage(win).switcher;
      await switcher.waitVisible();

      // Seed three connections via IPC so the UI focus-refresh fires for each.
      await seedConnection(win, { ...baseConnInput(host, port), name: 'Alpha' });
      await seedConnection(win, { ...baseConnInput(host, port), name: 'Beta' });
      await seedConnection(win, { ...baseConnInput(host, port), name: 'Gamma' });

      await expect(switcher.item('Alpha')).toBeVisible({ timeout: 8000 });
      await expect(switcher.item('Beta')).toBeVisible();
      await expect(switcher.item('Gamma')).toBeVisible();

      // Filter to one match.
      await switcher.filter('Bet');
      await expect(switcher.item('Alpha')).not.toBeVisible();
      await expect(switcher.item('Beta')).toBeVisible();
      await expect(switcher.item('Gamma')).not.toBeVisible();

      // Clear filter restores all.
      await switcher.filter('');
      await expect(switcher.item('Alpha')).toBeVisible();
      await expect(switcher.item('Gamma')).toBeVisible();

      // Clicking a connection connects it — verified via aria-selected on the
      // option, which since X16.4 marks every *connected* Connection
      // rather than one active one. Clicking a row closes the popover, so
      // reopen it to check.
      await switcher.select('Alpha');
      await switcher.waitVisible();
      await expect(switcher.item('Alpha')).toHaveAttribute('aria-selected', 'true', {
        timeout: 10_000,
      });
      await expect(switcher.item('Beta')).toHaveAttribute('aria-selected', 'false');
    });
  });
});
