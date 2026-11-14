import { test, expect } from '@playwright/test';
import { baseConnInput, startMemoryServer, stopAllMemoryServers, withApp } from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import { seedActiveConnectionWithDocs } from './helpers/uiSeed';
import { expectConsoleClean } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

/**
 * X14 §11 — Shell Syntax typed into the filter is runnable as it stands: Run
 * is open before the editor loses focus, and running it returns the matching
 * documents.
 */
test('Shell Syntax in the filter runs without leaving the editor', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Shell Run' },
        {
          dbName: 'shop',
          collection: 'orders',
          docs: [
            { sku: 'apple-001', status: 'shipped' },
            { sku: 'banana-002', status: 'pending' },
          ],
        },
      );
      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');
      await expect(win.getByText('banana-002')).toBeVisible({ timeout: 8000 });

      // `fill` focuses the editor and never blurs it.
      await ws.queryBarTextarea.fill("{status: 'shipped'}");
      await expect(ws.queryBarTextarea).toBeFocused();
      await expect(win.getByTestId('query-bar-syntax-note')).toBeVisible();
      await expect(ws.queryBarRunButton).toBeEnabled();

      // Keyboard Run, from inside the editor.
      await ws.queryBarTextarea.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');

      await expect(win.getByText('apple-001')).toBeVisible({ timeout: 8000 });
      await expect(win.getByText('banana-002')).toHaveCount(0);
    });
  });
});
