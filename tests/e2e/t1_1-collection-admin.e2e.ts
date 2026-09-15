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
 * T1.1 — Create / drop / rename collections via the navigator's DB and
 * collection context menus, with type-to-confirm on the destructive drop.
 */
test('navigator: create, rename, and drop a collection', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      // Seed a placeholder collection so the 'shop' DB row is already visible
      // in the navigator before we exercise the create/rename/drop flow.
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Admin Target' },
        { dbName: 'shop', collection: 'placeholder', docs: [{ _id: 1 }] },
      );
      await expectStatusDot(win, 'Admin Target', 'connected');

      const ws = new WorkspacePage(win);

      await ws.waitForDb('shop');

      // Expand the DB first so the newly created collection's row is
      // visible once the create succeeds (refreshDb() only refetches the
      // collection cache — it doesn't force the row open).
      await ws.dbRow('shop').click();
      await expect(ws.collectionRow('shop', 'placeholder')).toBeVisible({ timeout: 5000 });

      // --- Create: DB context menu → "Create collection" -----------------
      await ws.dbRow('shop').click({ button: 'right' });
      await win.getByRole('menuitem', { name: 'Create collection' }).click();

      const createDrawer = win.getByRole('dialog', { name: /New collection/ });
      await expect(createDrawer).toBeVisible({ timeout: 3000 });
      await createDrawer.getByLabel('Collection name').fill('orders');
      await createDrawer.getByRole('button', { name: 'Create collection' }).click();
      await expect(createDrawer).not.toBeVisible({ timeout: 5000 });

      await expect(ws.collectionRow('shop', 'orders')).toBeVisible({ timeout: 5000 });

      // --- Rename: collection context menu → "Rename collection" ---------
      await ws.collectionRow('shop', 'orders').click({ button: 'right' });
      await win.getByRole('menuitem', { name: 'Rename collection' }).click();

      const renameDialog = win.getByRole('dialog', { name: /Rename "orders"/ });
      await expect(renameDialog).toBeVisible({ timeout: 3000 });
      await renameDialog.getByLabel('New name').fill('purchase_orders');
      await renameDialog.getByRole('button', { name: 'Rename' }).click();
      await expect(renameDialog).not.toBeVisible({ timeout: 5000 });

      await expect(ws.collectionRow('shop', 'purchase_orders')).toBeVisible({ timeout: 5000 });
      await expect(ws.collectionRow('shop', 'orders')).not.toBeVisible();

      // --- Drop: collection context menu → type-to-confirm ---------------
      await ws.collectionRow('shop', 'purchase_orders').click({ button: 'right' });
      await win.getByRole('menuitem', { name: 'Drop collection' }).click();

      const dropDialog = win.getByRole('dialog', { name: /Drop collection "purchase_orders"/ });
      await expect(dropDialog).toBeVisible({ timeout: 3000 });
      const dropButton = dropDialog.getByRole('button', { name: 'Drop' });
      await expect(dropButton).toBeDisabled();
      await dropDialog.getByLabel('Confirm collection name').fill('purchase_orders');
      await expect(dropButton).toBeEnabled();
      await dropButton.click();
      await expect(dropDialog).not.toBeVisible({ timeout: 5000 });

      await expect(ws.collectionRow('shop', 'purchase_orders')).not.toBeVisible({ timeout: 5000 });
    });
  });
});
