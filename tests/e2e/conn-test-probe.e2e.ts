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
 * C04 — Test-connection probe: failing probe shows an error, passing probe
 * shows "Connection successful".
 */
test('test probe: failure shows error, valid host/port shows success', async () => {
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

      // Use Standard type + None auth so we control host/port precisely.
      await form.selectConnectionType('Standard (mongodb://)');
      await form.selectAuthMechanism('None');
      await form.clickTab('General');

      // Fill a port that's guaranteed to be closed (well outside ephemeral range).
      await form.hostnameInput.fill('127.0.0.1');
      await form.portInput.fill('59998');
      await form.nameInput.fill('Probe Test');
      await form.testButton.click();

      // The probe error text is rendered directly in the footer; no role="alert"
      // for the inline TestStatus area. Match on the human-readable error text.
      await expect(
        win.getByText(/Could not reach the server|Connection timed out|Connection failed/i),
      ).toBeVisible({ timeout: 15000 });

      // Now fix the host/port — same server, should pass.
      await form.hostnameInput.fill(host);
      await form.portInput.fill(String(port));
      await form.testButton.click();
      await expect(win.getByText('Connection successful')).toBeVisible({ timeout: 10000 });
    });
  });
});
