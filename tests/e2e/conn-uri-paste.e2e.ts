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
 * C03 — URI paste: pasting a full mongodb:// URI and clicking Apply populates
 * the hostname and port fields, and shows a "URI applied" toast.
 */
test('uri paste: Apply fills hostname and port from the URI', async () => {
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

      // Show the URI input row.
      await form.pasteUriToggle.click();
      await expect(form.uriInput).toBeVisible();

      // Enter a standard mongodb URI pointing at the memory server.
      const uri = `mongodb://${host}:${port}/?directConnection=true`;
      await form.uriInput.fill(uri);
      await form.applyUriButton.click();

      // Toast "URI applied." appears briefly above the footer.
      await expect(win.getByText(/URI applied/i)).toBeVisible({ timeout: 4000 });

      // Switch back to field view and verify hostname + port were applied.
      await form.pasteUriToggle.click();
      await expect(form.hostnameInput).toHaveValue(host, { timeout: 3000 });
      await expect(form.portInput).toHaveValue(String(port));
    });
  });
});
