import { test, expect } from '@playwright/test';
import {
  baseConnInput,
  startMemoryServer,
  stopAllMemoryServers,
  withApp,
} from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import { seedActiveConnectionWithDocs, seedDocuments } from './helpers/uiSeed';
import { expectConsoleClean, expectStatusDot } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * `EditDrawer`/`InsertDrawer` used to read connectionId/dbName/collection
 * live from the Focused Tab at render time, the same hazard fixed for
 * `DeleteConfirm` — but closing them on a tab switch (that remedy) would
 * silently discard the user's unsaved edit/draft, which is its own
 * regression. ADR-001's fix instead pins the target captured at open time,
 * so the drawer keeps writing to the collection it was opened against no
 * matter what tab is focused when Save/Insert is clicked. This proves it end
 * to end against the real Electron app and a real `mongod`.
 */
test('EditDrawer keeps saving to the tab it was opened on after switching Focused Tab mid-edit', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      // Same `_id` in both collections: a wrong-namespace save then actually
      // overwrites a document instead of silently matching nothing.
      const conn = await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Edit Pin Target' },
        {
          dbName: 'shop',
          collection: 'orders',
          docs: [{ _id: 'shared-1', sku: 'before-edit' }, { _id: 'o2', sku: 'x' }],
        },
      );
      await seedDocuments(win, {
        connectionId: conn.id,
        dbName: 'shop',
        collection: 'users',
        docs: [{ _id: 'shared-1', sku: 'other' }, { _id: 'u2', sku: 'y' }],
      });
      await expectStatusDot(win, 'Edit Pin Target', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');
      await ws.queryBarRunButton.click();
      await expect(win.getByText('before-edit')).toBeVisible({ timeout: 8000 });

      await ws.collectionRow('shop', 'users').click();
      await expect(ws.tabByName('users')).toHaveAttribute('aria-selected', 'true', {
        timeout: 5000,
      });
      await ws.queryBarRunButton.click();
      await expect(win.getByText('other')).toBeVisible({ timeout: 8000 });

      // Back to orders (tab 1), open Edit on the shared-id row.
      await ws.tabByName('orders').click();
      await expect(ws.tabByName('orders')).toHaveAttribute('aria-selected', 'true');
      await win.locator('button[title="Edit document"]').first().click();
      await expect(win.getByText('Edit document')).toBeVisible({ timeout: 5000 });

      const editTextarea = win.locator('textarea').last();
      await editTextarea.fill('{"_id": "shared-1", "sku": "after-edit"}');

      // ⌘2/Ctrl+2 jumps to the second tab — users — while the drawer opened
      // against orders is still up, mid-edit.
      await win.keyboard.press(`${MOD}+2`);
      await expect(ws.tabByName('users')).toHaveAttribute('aria-selected', 'true', {
        timeout: 5000,
      });

      // The drawer must survive the switch (ADR-001 consequence 1) instead
      // of unmounting and losing the draft.
      await expect(win.getByText('Edit document')).toBeVisible();
      await expect(editTextarea).toHaveValue('{"_id": "shared-1", "sku": "after-edit"}');

      await win.getByRole('button', { name: /^Save$/ }).last().click();
      await expect(win.getByText('Edit document')).not.toBeVisible({ timeout: 8000 });

      const docs = await win.evaluate(async (cid) => {
        const api = (window as unknown as {
          atelier: {
            query: {
              find: (i: {
                connectionId: string;
                dbName: string;
                collection: string;
                filter: string;
                limit: number;
                skip: number;
              }) => Promise<{ documents: Array<{ sku?: string }> }>;
            };
          };
        }).atelier;
        const orders = await api.query.find({
          connectionId: cid,
          dbName: 'shop',
          collection: 'orders',
          filter: '{"_id":"shared-1"}',
          limit: 10,
          skip: 0,
        });
        const users = await api.query.find({
          connectionId: cid,
          dbName: 'shop',
          collection: 'users',
          filter: '{"_id":"shared-1"}',
          limit: 10,
          skip: 0,
        });
        return { ordersSku: orders.documents[0]?.sku, usersSku: users.documents[0]?.sku };
      }, conn.id);

      // The save landed in orders (the tab it was opened on)...
      expect(docs.ordersSku).toBe('after-edit');
      // ...and users, focused when Save was clicked, is untouched.
      expect(docs.usersSku).toBe('other');

      // The refresh half of the same pin. The write is only half the
      // contract: the tab the drawer was opened on must also *show* the
      // written document. `handleDocSaved` used to call `run()` with no
      // target, which refreshes the Focused Tab — users here — leaving
      // orders rendering its pre-save documents until the user hit Run
      // again. Go back to orders and read the grid without re-running.
      await win.keyboard.press(`${MOD}+1`);
      await expect(ws.tabByName('orders')).toHaveAttribute('aria-selected', 'true', {
        timeout: 5000,
      });
      await expect(win.getByText('after-edit')).toBeVisible({ timeout: 8000 });
      await expect(win.getByText('before-edit')).not.toBeVisible();
    });
  });
});

/**
 * Same hazard, InsertDrawer side: a draft started on one tab must insert
 * into that tab's collection even after focus moves to another tab before
 * Insert is clicked.
 */
test('InsertDrawer keeps inserting into the tab it was opened on after switching Focused Tab mid-draft', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      const conn = await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Insert Pin Target' },
        { dbName: 'shop', collection: 'orders', docs: [{ _id: 'o1', sku: 'seed' }] },
      );
      await seedDocuments(win, {
        connectionId: conn.id,
        dbName: 'shop',
        collection: 'users',
        docs: [{ _id: 'u1', sku: 'seed' }],
      });
      await expectStatusDot(win, 'Insert Pin Target', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');
      await ws.queryBarRunButton.click();
      await expect(win.getByText('seed').first()).toBeVisible({ timeout: 8000 });

      await ws.collectionRow('shop', 'users').click();
      await expect(ws.tabByName('users')).toHaveAttribute('aria-selected', 'true', {
        timeout: 5000,
      });
      await ws.queryBarRunButton.click();

      await ws.tabByName('orders').click();
      await expect(ws.tabByName('orders')).toHaveAttribute('aria-selected', 'true');
      await win.getByRole('button', { name: /Insert document/ }).click();
      await expect(win.getByText('Insert document', { exact: true })).toBeVisible({
        timeout: 5000,
      });

      const insertTextarea = win.locator('textarea').last();
      await insertTextarea.fill('{"_id": "fresh", "sku": "drafted-on-orders"}');

      await win.keyboard.press(`${MOD}+2`);
      await expect(ws.tabByName('users')).toHaveAttribute('aria-selected', 'true', {
        timeout: 5000,
      });
      // Survives the switch instead of unmounting.
      await expect(win.getByText('Insert document', { exact: true })).toBeVisible();

      await win.getByRole('button', { name: /^Insert$/ }).click();
      await expect(win.getByText('Insert document', { exact: true })).not.toBeVisible({
        timeout: 8000,
      });

      const counts = await win.evaluate(async (cid) => {
        const api = (window as unknown as {
          atelier: {
            query: {
              find: (i: {
                connectionId: string;
                dbName: string;
                collection: string;
                filter: string;
                limit: number;
                skip: number;
              }) => Promise<{ documents: unknown[] }>;
            };
          };
        }).atelier;
        const orders = await api.query.find({
          connectionId: cid,
          dbName: 'shop',
          collection: 'orders',
          filter: '{"_id":"fresh"}',
          limit: 10,
          skip: 0,
        });
        const users = await api.query.find({
          connectionId: cid,
          dbName: 'shop',
          collection: 'users',
          filter: '{"_id":"fresh"}',
          limit: 10,
          skip: 0,
        });
        return { orders: orders.documents.length, users: users.documents.length };
      }, conn.id);

      expect(counts).toEqual({ orders: 1, users: 0 });
    });
  });
});

/**
 * ADR-001 consequence (1): dropping the `activeCollection &&` guard from
 * both drawer render sites means a drawer opened on a collection tab must
 * survive a switch to a tab with no active collection (a Script tab) instead
 * of unmounting.
 */
test('EditDrawer survives switching to a Script tab (no active collection) instead of unmounting', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Script Switch Target' },
        { dbName: 'shop', collection: 'orders', docs: [{ _id: 'o1', sku: 'before-edit' }] },
      );
      await expectStatusDot(win, 'Script Switch Target', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');
      await ws.queryBarRunButton.click();
      await expect(win.getByText('before-edit')).toBeVisible({ timeout: 8000 });

      // Open the Script tab *before* the drawer — Mantine's `Drawer` overlay
      // blocks pointer events to everything outside it (same as
      // `DeleteConfirm`'s modal, per an earlier reachability finding), so
      // "+ Script" can't be clicked once the drawer is open. Opening it up
      // front, then jumping to it by keyboard once the drawer is up, is the
      // reachable path a user actually has.
      await ws.newScriptTab.click();
      await expect(win.locator('[data-testid="script-editor"]')).toBeVisible({ timeout: 5000 });
      await ws.tabByName('orders').click();
      await expect(ws.tabByName('orders')).toHaveAttribute('aria-selected', 'true');

      await win.locator('button[title="Edit document"]').first().click();
      await expect(win.getByText('Edit document')).toBeVisible({ timeout: 5000 });
      const editTextarea = win.locator('textarea').last();
      await editTextarea.fill('{"_id": "o1", "sku": "still-editing"}');

      // ⌘2/Ctrl+2 jumps to the Script tab while the drawer opened against
      // orders is still up — a keyboard shortcut, so the overlay above
      // doesn't block it the way a click on "+ Script" would.
      await win.keyboard.press(`${MOD}+2`);
      await expect(win.locator('[data-testid="script-editor"]')).toBeVisible({ timeout: 5000 });

      // The drawer is still open with the draft intact, not unmounted.
      await expect(win.getByText('Edit document')).toBeVisible();
      await expect(editTextarea).toHaveValue('{"_id": "o1", "sku": "still-editing"}');
    });
  });
});
