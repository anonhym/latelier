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

/**
 * W05 §9.2 — the options in the Filter Bar row are the Focused Tab's. QueryBar
 * has no `key` at its mount site, so one instance draws every tab: a pill must
 * say this tab's value, and "Keep options expanded" is stored per tab.
 *
 * One flow: two collection tabs, a sort and the expanded grid on the second,
 * switch away and back. Asserts on the Sort pill's text and the presence of
 * the `#query-bar-advanced` region — not on the grid's internal markup.
 */
test('the options follow the Focused Tab: its sort on the pill, its grid where it was kept expanded', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      const conn = await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Advanced Row Target' },
        {
          dbName: 'shop',
          collection: 'orders',
          docs: [{ sku: 'apple-001', status: 'paid' }],
        },
      );
      // Second collection in the same DB, seeded before the navigator ever
      // expands `shop` — `loadColls` only runs on expand, so this lands in
      // the first (and only) listCollections the tree issues.
      await seedDocuments(win, {
        connectionId: conn.id,
        dbName: 'shop',
        collection: 'customers',
        docs: [{ name: 'ada', tier: 'gold' }],
      });
      await expectStatusDot(win, 'Advanced Row Target', 'connected');

      const ws = new WorkspacePage(win);

      // Tab A — orders. Never gets an advanced value.
      await ws.openCollectionFromNavigator('shop', 'orders');
      // Opening a tab auto-runs the base query. Let it land before
      // driving anything else in the bar.
      await expect(win.getByText('apple-001')).toBeVisible({ timeout: 8000 });
      await expect(ws.queryBarAdvanced).toHaveCount(0);

      // Tab B — customers. `shop` is already expanded, so click the row
      // directly: re-clicking the DB row would toggle it *shut*.
      await ws.collectionRow('shop', 'customers').click();
      await expect(ws.tabByName('customers')).toHaveAttribute('aria-selected', 'true', {
        timeout: 5000,
      });
      // Exact and quoted: a bare `ada` can also match the last 8 hex chars of a generated
      // ObjectId and trip strict mode.
      await expect(win.getByText('"ada"', { exact: true })).toBeVisible({ timeout: 8000 });
      // Both tabs must coexist — if opening B replaced A, the switch below
      // would land on a *fresh* orders tab whose row is collapsed for the
      // wrong reason, and this spec would pass against the bug.
      await expect(ws.tabByName('orders')).toHaveCount(1);

      // Set a sort on B from its pill — sort patches on change — and close
      // the editor: the pill then says the sort.
      await expect(ws.optionPill('sort')).toHaveText('Sort');
      await ws.openOption('sort');
      await ws.queryBarSort.fill('{"name":1}');
      await expect(ws.queryBarSort).toHaveValue('{"name":1}');
      // The open field-suggestion list takes the first Escape; the second closes the editor.
      await ws.queryBarSort.press('Escape');
      await ws.queryBarSort.press('Escape');
      await expect(ws.queryBarSort).toHaveCount(0);
      await expect(ws.optionPill('sort')).toHaveText('Sort: name ↑');

      // Keep B's options expanded: the grid replaces the pills.
      await expect(ws.queryBarAdvanced).toHaveCount(0);
      await ws.toggleOptionsExpanded();
      await expect(ws.queryBarAdvanced).toBeVisible();
      await expect(ws.queryBarSort).toHaveValue('{"name":1}');

      // Switch away to A — which has neither. B's sort and B's grid must not
      // show over A's query.
      await ws.tabByName('orders').click();
      await expect(ws.tabByName('orders')).toHaveAttribute('aria-selected', 'true');
      await expect(ws.queryBarAdvanced).toHaveCount(0);
      await expect(ws.optionPill('sort')).toHaveText('Sort');

      // Switch back to B — the grid is there again with its sort intact.
      await ws.tabByName('customers').click();
      await expect(ws.tabByName('customers')).toHaveAttribute('aria-selected', 'true');
      await expect(ws.queryBarAdvanced).toBeVisible();
      await expect(ws.queryBarSort).toHaveValue('{"name":1}');
    });
  });
});
