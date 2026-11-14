import { test, expect } from '@playwright/test';
import { baseConnInput, startMemoryServer, stopAllMemoryServers, withApp } from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import { seedActiveConnectionWithDocs } from './helpers/uiSeed';
import { expectConsoleClean, expectStatusDot } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

/**
 * X13 §13 — undo outlives its toast: after the toast has gone, ⌘Z on the
 * results reverts the last write, and the list re-runs to show it.
 */
test('edit a document, let the toast go, then ⌘Z on the results puts the original back', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Undo Later' },
        { dbName: 'shop', collection: 'orders', docs: [{ _id: 1, sku: 'original-sku' }] },
      );
      await expectStatusDot(win, 'Undo Later', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');
      await expect(win.getByText('original-sku')).toBeVisible({ timeout: 8000 });

      await win.getByRole('button', { name: /^Edit document/ }).first().click();
      const editor = win.getByRole('dialog', { name: 'Edit document' });
      await expect(editor).toBeVisible({ timeout: 5000 });
      await editor.getByRole('textbox', { name: 'sku' }).fill('edited-sku');
      await editor.getByRole('button', { name: 'Save' }).click();
      await expect(editor).not.toBeVisible({ timeout: 8000 });
      await expect(win.getByText('edited-sku')).toBeVisible({ timeout: 8000 });

      // The toast carries an 8-second Undo; wait it out.
      const toast = win.getByText('Document updated');
      await expect(toast).toBeVisible({ timeout: 4000 });
      await expect(toast).toHaveCount(0, { timeout: 15000 });

      // The `⋯` menu names what an undo would reverse.
      await ws.resultOverflowMenuButton.click();
      await expect(win.getByRole('menuitem', { name: /^Undo: document updated/ })).toBeVisible();
      await win.keyboard.press('Escape');

      await win.getByRole('tree', { name: 'Documents' }).focus();
      await win.keyboard.press('ControlOrMeta+z');
      await expect(win.getByText('original-sku')).toBeVisible({ timeout: 8000 });
      await expect(win.getByText('edited-sku')).toHaveCount(0);
    });
  });
});
