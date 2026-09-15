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
 * F06 — Error recovery. A failed `conn.parseUri` shows a banner
 * (`role="alert"`, `NewConnection.tsx:1027`); fixing the input and re-parsing
 * applies cleanly and the error banner is replaced by a "URI applied" toast.
 */
test('error recovery: invalid URI shows alert; valid URI clears it', async () => {
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

      await form.pasteUriToggle.click();
      await expect(form.uriInput).toBeVisible();

      // Bad URI — not a mongodb scheme. The parser returns an IpcError,
      // which the form turns into a banner.
      await form.uriInput.fill('not-a-uri');
      await form.applyUriButton.click();

      // Banner appears with role="alert" and surfaces a parse error message.
      await expect(win.locator('[role="alert"]').first()).toBeVisible({ timeout: 4000 });

      // Fix it. A valid URI parses, the toast "URI applied" appears, and the
      // banner is dismissed.
      await form.uriInput.fill(`mongodb://${host}:${port}/?directConnection=true`);
      await form.applyUriButton.click();

      await expect(win.getByText(/URI applied/i)).toBeVisible({ timeout: 4000 });
    });
  });
});
