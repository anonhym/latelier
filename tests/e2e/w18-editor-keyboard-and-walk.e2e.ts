import { test, expect } from '@playwright/test';
import { baseConnInput, startMemoryServer, stopAllMemoryServers, withApp } from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import { seedActiveConnectionWithDocs } from './helpers/uiSeed';
import { expectConsoleClean, expectStatusDot } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

/**
 * W18 §13 — the Document Editor is keyboard-complete: Tab goes from a field's
 * value to the next field's value, ⌘↵ saves, and ‹ › step through the list.
 */
test('keyboard only: tab value to value, save with ⌘↵; step three documents with ›, saving one on the way', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Editor Keys' },
        {
          dbName: 'shop',
          collection: 'orders',
          docs: [
            { _id: 1, a: 'a1', b: 'b1', c: 'c1' },
            { _id: 2, a: 'a2', b: 'b2', c: 'c2' },
            { _id: 3, a: 'a3', b: 'b3', c: 'c3' },
          ],
        },
      );
      await expectStatusDot(win, 'Editor Keys', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');
      await ws.queryBarRunButton.click();
      await expect(win.getByText('a1')).toBeVisible({ timeout: 8000 });

      const results = win.getByRole('tree', { name: 'Documents' });
      await results.focus();
      await win.keyboard.press('e');
      const editor = win.getByRole('dialog', { name: 'Edit document' });
      await expect(editor).toBeVisible({ timeout: 5000 });
      await expect(editor.getByText('1 of 3')).toBeVisible();

      // The editor opens on the first value; one Tab per field after that.
      await expect(editor.getByRole('textbox', { name: 'a' })).toBeFocused();
      await win.keyboard.press('Tab');
      await expect(editor.getByRole('textbox', { name: 'b' })).toBeFocused();
      await win.keyboard.press('ControlOrMeta+a');
      await win.keyboard.type('b1-edited');
      await win.keyboard.press('Tab');
      await expect(editor.getByRole('textbox', { name: 'c' })).toBeFocused();

      // Moving on with unsaved edits asks first; ⌘↵ there is Save and go.
      await editor.getByRole('button', { name: 'Next document' }).click();
      const guard = win.getByRole('dialog', { name: 'Unsaved changes' });
      await expect(guard).toBeVisible();
      await win.keyboard.press('ControlOrMeta+Enter');
      await expect(editor.getByText('2 of 3')).toBeVisible({ timeout: 8000 });
      await expect(editor.getByRole('textbox', { name: 'a' })).toHaveValue('a2');

      await editor.getByRole('button', { name: 'Next document' }).click();
      await expect(editor.getByText('3 of 3')).toBeVisible();
      await expect(editor.getByRole('textbox', { name: 'a' })).toHaveValue('a3');
      await expect(editor.getByRole('button', { name: 'Next document' })).toBeDisabled();

      // Closing re-runs the tab's query once: the saved edit shows in the list.
      // The first Escape leaves the value for its row, the second closes.
      await win.keyboard.press('Escape');
      await win.keyboard.press('Escape');
      await expect(editor).not.toBeVisible({ timeout: 8000 });
      await expect(results.getByText('b1-edited')).toBeVisible({ timeout: 8000 });
    });
  });
});
