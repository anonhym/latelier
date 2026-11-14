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
 * W10 — Save a query from the QueryBar toolbar; verify it appears in the
 * Saved tab; verify a Recent entry was auto-recorded by the prior run.
 */
test('saved+recent: Save modal persists; Saved + Recent tabs reflect activity', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Saved Target' },
        { dbName: 'shop', collection: 'orders', docs: [{ sku: 'aaa' }, { sku: 'bbb' }] },
      );
      await expectStatusDot(win, 'Saved Target', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');

      // Run once so the recent panel has an entry.
      await ws.queryBarRunButton.click();
      // Exact and quoted: the Tree view prints each ObjectId as its last 8 hex chars, so a
      // bare substring like `aaa` can also match a generated id and trip strict mode.
      await expect(win.getByText('"aaa"', { exact: true })).toBeVisible({ timeout: 8000 });

      // Click the QueryBar toolbar's Save (data-hint-anchor="saved.create").
      await win.locator('[data-hint-anchor="saved.create"]').click();

      // SaveModal opens — placeholder "My query" identifies its name input.
      const nameInput = win.getByPlaceholder('My query');
      await expect(nameInput).toBeVisible({ timeout: 4000 });
      await nameInput.fill('Top Skus Query');
      await win.getByPlaceholder('Optional description').fill('Top-selling SKUs this week');

      // X15 T5 — Enter submits the Save form, end to end in a real
      // browser. The component suite covers the same path against jsdom; this
      // is here because implicit submission is one of the places jsdom and
      // Chromium can disagree, and saving a query is not a path to find that
      // out on.
      //
      // Measured, so nobody re-derives it: deleting Cancel's `type="button"`
      // does NOT break this, in either jsdom or Chromium. The theory that
      // Cancel would swallow Enter as the first submit button in tree order is
      // wrong — keep the explicit type for intent, but it is not what makes
      // Enter reach Save. The load-bearing piece is the form's `onSubmit`:
      // neutering that reds the component test directly.
      await nameInput.press('Enter');

      // Modal closes — placeholder is gone.
      await expect(nameInput).not.toBeVisible({ timeout: 4000 });

      // Open the Saved popover from the Filter Bar row's ☆ list button (W05 §9.6).
      await win.getByTestId('query-bar-saved-btn').click();
      await expect(win.getByText('Top Skus Query')).toBeVisible({ timeout: 5000 });
      await expect(win.getByText('Top-selling SKUs this week')).toBeVisible({ timeout: 5000 });

      // Swap to the History popover — it should have at least one entry from
      // the earlier query.find. Assert the empty-state message is gone
      // instead of pinning to a specific row format.
      await win.keyboard.press('Escape');
      await expect(win.getByText('Top-selling SKUs this week')).not.toBeVisible({ timeout: 4000 });
      await win.getByTestId('filter-bar-row').getByRole('button', { name: 'History' }).click();
      await expect(win.getByText('No recent queries yet.')).not.toBeVisible({ timeout: 5000 });
      await expect(win.getByRole('button', { name: /in this tab$/ }).first()).toBeVisible();
    });
  });
});
