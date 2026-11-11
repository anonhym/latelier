import { test, expect, type Page } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { baseConnInput, startMemoryServer, stopAllMemoryServers, withApp } from '../helpers/e2eApp';
import { seedActiveConnectionWithDocs, withOpenOrders } from './helpers/uiSeed';
import { expectConsoleClean } from './helpers/uiAsserts';
import { WorkspacePage } from './pages/WorkspacePage';

test.afterAll(stopAllMemoryServers);

async function openPalette(win: Page) {
  const palette = win.locator('[role=dialog]:has(input[role=combobox])');
  const search = palette.locator('input[role="combobox"]');
  await expect(async () => {
    if (!(await palette.isVisible())) await win.keyboard.press('ControlOrMeta+K');
    await expect(palette).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 8000 });
  return { palette, search };
}

const ORDERS = [{ sku: 'apple-001' }, { sku: 'banana-002' }];

/**
 * X07 §13.11 — a collection row's action list (⌥↵) offers `Export…`, which
 * opens the export dialog for that collection's open tab.
 */
test('palette: the collection action list opens Export…', async () => {
  await withOpenOrders('Palette Export Target', ORDERS, 'banana-002', async (win) => {
    const { palette, search } = await openPalette(win);
    await search.fill('shop.orders');
    await expect(palette.getByRole('option').first()).toContainText('shop.orders');
    await win.keyboard.press('Alt+Enter');
    await expect(search).toHaveAttribute('aria-label', 'Filter actions');
    await search.fill('export');
    await expect(palette.getByRole('option').first()).toContainText('Export…');
    await win.keyboard.press('Enter');

    await expect(palette).not.toBeVisible({ timeout: 4000 });
    await expect(win.getByRole('dialog', { name: 'Export documents' })).toBeVisible({ timeout: 5000 });
  });
});

/**
 * X07 §13.11 — `drop orders` + Enter opens the drop confirmation and runs
 * nothing: cancelling leaves the collection in the navigator and on the server.
 */
test('palette: drop orders asks for confirmation, and Cancel keeps the collection', async () => {
  const { server, host, port } = await startMemoryServer();
  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Palette Drop Target' },
        { dbName: 'shop', collection: 'orders', docs: ORDERS },
      );
      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');
      await expect(win.getByText('banana-002')).toBeVisible({ timeout: 8000 });

      const { palette, search } = await openPalette(win);
      await search.fill('drop orders');
      await expect(palette.getByRole('option').first()).toContainText('Drop collection…');
      await win.keyboard.press('Enter');

      const dialog = win.getByRole('dialog', { name: /Drop collection "orders"/ });
      await expect(dialog).toBeVisible({ timeout: 5000 });
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).not.toBeVisible({ timeout: 4000 });

      await expect(ws.collectionRow('shop', 'orders')).toBeVisible();
      const client = new MongoClient(server.getUri());
      try {
        const names = (await client.db('shop').listCollections().toArray()).map((c) => c.name);
        expect(names).toContain('orders');
      } finally {
        await client.close();
      }
    });
  });
});
