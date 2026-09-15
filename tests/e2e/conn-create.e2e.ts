import { test, expect } from '@playwright/test';
import {
  startMemoryServer,
  stopAllMemoryServers,
  withApp,
} from '../helpers/e2eApp';
import { NewConnectionPage, WorkspacePage } from './pages';
import { expectConsoleClean } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

/**
 * C03 — Create connection: fill the General + Auth tabs via the UI, run the
 * test probe, save, and verify the new connection appears in the list.
 *
 * The initial form defaults to SRV + TLS. We switch to Standard so the memory
 * server (no TLS, plain TCP) is reachable, and set auth to None.
 */
test('create connection: fill form, test probe succeeds, save appears in list', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      const switcher = new WorkspacePage(win).switcher;
      await switcher.waitVisible();
      await switcher.openNew();

      const form = new NewConnectionPage(win);
      await form.waitVisible();

      // Fill General tab: switch to Standard so the port field appears.
      await form.selectConnectionType('Standard (mongodb://)');
      await form.nameInput.fill('UI Created');
      await form.hostnameInput.fill(host);
      await form.portInput.fill(String(port));

      // Auth tab: switch to None so the memory server (no creds) passes.
      await form.selectAuthMechanism('None');

      // Test probe.
      await form.clickTab('General');
      await form.testButton.click();
      await expect(win.getByText('Connection successful')).toBeVisible({ timeout: 10000 });

      // Save closes the modal; the new Connection becomes Active over the
      // Data View (there is no more standalone list screen to land
      // on). Reopen the Switcher to confirm it saved.
      await form.saveButton.click();
      await switcher.waitVisible();
      await expect(switcher.item('UI Created')).toBeVisible({ timeout: 8000 });
    });
  });
});
