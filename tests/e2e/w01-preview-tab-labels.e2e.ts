import { test, expect, type Page } from '@playwright/test';
import { baseConnInput, startMemoryServer, stopAllMemoryServers, withApp } from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import { seedActiveConnectionWithDocs, seedDocuments } from './helpers/uiSeed';
import { expectConsoleClean, expectStatusDot } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

/**
 * W01 §14.4 and §14.9 — tab labels name the database only when two open tabs
 * would read the same, and browsing by single click leaves one preview tab.
 */
async function seed(win: Page, ws: WorkspacePage, host: string, port: number) {
  const created = await seedActiveConnectionWithDocs(
    win,
    { ...baseConnInput(host, port), name: 'Labels' },
    { dbName: 'shop', collection: 'orders', docs: [{ _id: 1 }] },
  );
  await expectStatusDot(win, 'Labels', 'connected');
  for (const [dbName, collection] of [['archive', 'orders'], ['shop', 'users'], ['shop', 'events']] as const) {
    await seedDocuments(win, { connectionId: created.id, dbName, collection, docs: [{ _id: 1 }] });
  }
  await ws.waitNavigatorVisible();
  await ws.waitForDb('archive');
}

const openTabs = (win: Page) => win.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab');

test('two open tabs on same-named collections read database.collection', async () => {
  const { host, port } = await startMemoryServer();
  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await expectConsoleClean(win, async () => {
      const ws = new WorkspacePage(win);
      await seed(win, ws, host, port);

      await ws.openCollectionFromNavigator('shop', 'orders');
      await ws.openCollectionFromNavigator('archive', 'orders');

      await expect(openTabs(win)).toHaveCount(2);
      await expect(openTabs(win).nth(0)).toHaveAttribute('aria-label', /^shop\.orders — /);
      await expect(openTabs(win).nth(1)).toHaveAttribute('aria-label', /^archive\.orders — /);
    });
  });
});

test('browsing three collections by single click ends with one preview tab', async () => {
  const { host, port } = await startMemoryServer();
  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await expectConsoleClean(win, async () => {
      const ws = new WorkspacePage(win);
      await seed(win, ws, host, port);
      await ws.waitForDb('shop');
      await ws.dbRow('shop').click();

      for (const c of ['orders', 'users', 'events']) {
        await expect(ws.collectionRow('shop', c)).toBeVisible({ timeout: 5000 });
        await ws.collectionRow('shop', c).click();
        await expect(ws.collectionRow('shop', c)).toHaveAttribute('aria-selected', 'true', { timeout: 5000 });
      }

      await expect(openTabs(win)).toHaveCount(1);
      await expect(openTabs(win).first()).toHaveAttribute('aria-label', /^events — /);
      await expect(openTabs(win).first()).toHaveAttribute('data-preview', 'true');
    });
  });
});
