import { test, expect } from '@playwright/test';
import { baseConnInput, startMemoryServer, stopAllMemoryServers, withApp } from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import { seedActiveConnectionWithDocs } from './helpers/uiSeed';
import { expectConsoleClean } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

/**
 * X07 §14.5 — with a Connection open and no tab, the palette's sweep still
 * lists that Connection's collections: ⌘P, a collection name and Enter open
 * the tab without the navigator having been touched, and the empty palette
 * lists the collections as its second group.
 */
test('palette: with a Connection open and no tab, a collection name opens its tab', async () => {
  test.setTimeout(120_000);
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'PalNoTab' },
        { dbName: 'shop', collection: 'orders', docs: [{ a: 1 }] },
      );
      const ws = new WorkspacePage(win);
      await expect(ws.tabByName('orders')).toHaveCount(0);

      const search = win.locator('input[aria-label="Search commands"]');
      const palette = win.getByRole('dialog').filter({ has: search });
      const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

      // The empty palette (⌘K, All) lists the Connection's collections.
      await expect(async () => {
        if (!(await palette.isVisible())) await win.keyboard.press(`${mod}+K`);
        await expect(palette).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 8000 });
      const group = palette.getByRole('group', { name: 'Collections in this connection' });
      await expect(group.getByRole('option', { name: /shop\.orders/ })).toBeVisible({ timeout: 10_000 });
      await win.keyboard.press('Escape');
      await expect(palette).not.toBeVisible();

      // ⌘P, the name, Enter.
      await win.keyboard.press(`${mod}+P`);
      await expect(palette).toBeVisible({ timeout: 4000 });
      await search.fill('orders');
      await expect(palette.getByRole('option', { name: /shop\.orders/ })).toBeVisible();
      await win.keyboard.press('Enter');
      await expect(palette).not.toBeVisible({ timeout: 4000 });
      await expect(ws.tabByName('orders')).toBeVisible({ timeout: 10_000 });
    });
  });
});

/**
 * A connect chosen in the palette lands the keyboard on that Connection's root
 * in the navigator. Mantine returns focus to the palette's opener 10 ms after
 * the palette closes; the tree has to be the last to ask.
 */
test('palette: choosing a Connection leaves the navigator tree focused on its root', async () => {
  test.setTimeout(120_000);
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'PalConnect' },
        { dbName: 'shop', collection: 'orders', docs: [{ a: 1 }] },
      );
      const search = win.locator('input[aria-label="Search commands"]');
      const palette = win.getByRole('dialog').filter({ has: search });
      const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
      await expect(async () => {
        if (!(await palette.isVisible())) await win.keyboard.press(`${mod}+K`);
        await expect(palette).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 8000 });
      await search.fill('PalConnect');
      // The Connection's own row; a collection row also carries its name as a subtitle.
      await palette.locator('[role="option"][id*="connection.open:"]').first().click();
      await expect(palette).not.toBeVisible({ timeout: 4000 });

      const tree = win.getByRole('tree', { name: 'Databases and collections' });
      await expect(tree).toBeFocused({ timeout: 5000 });
      await expect(tree).toHaveAttribute('aria-activedescendant', /^navigator-row-conn:/);
    });
  });
});
