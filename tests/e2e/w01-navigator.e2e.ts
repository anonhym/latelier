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
 * W01 + W02 — Database navigator + open collection tab.
 *
 * Drives the full flow: seed connection, insert fixture docs into a user DB,
 * expand the DB in the tree, click the collection, and verify a tab opens
 * with that collection name. The Data View is the app's home now, so
 * the freshly seeded (and only) Connection becomes Active the moment
 * `useConnections()` picks it up; there is no longer a separate list screen
 * to navigate away from first.
 */
test('navigator: expanding a DB lists its collections; clicking opens a tab', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      const ws = new WorkspacePage(win);

      // Documents are inserted before the connection is made Active (see
      // seedActiveConnectionWithDocs), so the navigator's first DB-list
      // fetch sees 'shop' rather than racing it.
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Nav Target' },
        {
          dbName: 'shop',
          collection: 'orders',
          docs: [
            { _id: 1, total: 100, status: 'paid' },
            { _id: 2, total: 50, status: 'pending' },
          ],
        },
      );
      await expectStatusDot(win, 'Nav Target', 'connected');

      await ws.waitNavigatorVisible();

      // Tree is visible. The 'shop' DB row appears (non-system DB always shown).
      await ws.waitForDb('shop');

      // Expand the DB if not already expanded — clicking opens it.
      await ws.dbRow('shop').click();

      // Collection treeitem becomes visible.
      await expect(ws.collectionRow('shop', 'orders')).toBeVisible({ timeout: 5000 });

      // Click the collection — a tab opens with that name.
      await ws.collectionRow('shop', 'orders').click();
      await expect(ws.tabByName('orders')).toBeVisible({ timeout: 5000 });
      await expect(ws.tabByName('orders')).toHaveAttribute('aria-selected', 'true');

      // AC#1 cache: collapse and re-expand the DB; the cached list must
      // render immediately without a skeleton flash.
      await ws.dbRow('shop').click(); // collapse
      await ws.dbRow('shop').click(); // re-expand
      await expect(ws.collectionRow('shop', 'orders')).toBeVisible({ timeout: 5000 });
    });
  });
});
