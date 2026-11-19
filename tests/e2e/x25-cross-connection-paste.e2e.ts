import { test, expect } from '@playwright/test';
import { baseConnInput, startMemoryServer, stopAllMemoryServers, withApp } from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import { seedActiveConnectionWithDocs } from './helpers/uiSeed';
import { expectConsoleClean } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

const PASTE = process.platform === 'darwin' ? 'Meta+V' : 'Control+V';
const ID_A = 'ord-alpha-0001';

/**
 * X25 — a value copied on one Connection and pasted into a query on another
 * warns, the paste still lands, and a Run that finds nothing turns the warning
 * into the stronger wording. The same paste on the Connection it came from
 * says nothing.
 */
test('a document id copied on one connection warns when pasted into a query on another', async () => {
  const serverA = await startMemoryServer();
  const serverB = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(serverA.host, serverA.port), name: 'Client A' },
        { dbName: 'shop', collection: 'orders', docs: [{ _id: ID_A, sku: 'a-sku' }] },
      );
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(serverB.host, serverB.port), name: 'Client B' },
        { dbName: 'shop', collection: 'orders', docs: [{ _id: 'ord-beta-0002', sku: 'b-sku' }] },
      );
      const ws = new WorkspacePage(win);
      const strip = win.getByTestId('paste-warning-strip');
      const filter = ws.queryBarTextarea;

      // Types `{ "_id": "" }`, leaves the caret between the quotes and pastes.
      const pasteIntoId = async () => {
        await filter.fill('{ "_id": "" }');
        await filter.press('End');
        await filter.press('ArrowLeft');
        await filter.press('ArrowLeft');
        await filter.press('ArrowLeft');
        await win.keyboard.press(PASTE);
        await expect(filter).toHaveValue(`{ "_id": "${ID_A}" }`);
      };

      // --- copy the id of A's document from the Table view --------------------
      await ws.openCollectionFromNavigator('shop', 'orders');
      await ws.viewTableButton.click();
      await ws.queryBarRunButton.click();
      await expect(win.getByText(ID_A).first()).toBeVisible({ timeout: 8000 });
      await win.getByText(ID_A).first().click({ button: 'right' });
      await win.getByRole('menuitem', { name: 'Copy _id' }).click();
      await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(ID_A);

      // --- the same paste on A, where it came from: nothing -------------------
      await pasteIntoId();
      await win.waitForTimeout(400);
      await expect(strip).toHaveCount(0);

      // --- B's tab: the strip, the paste landed, the empty Run ----------------
      await win.getByRole('treeitem', { name: /^Client A\./ }).click();
      await win.getByRole('treeitem', { name: /^Client B\./ }).click();
      await ws.openCollectionFromNavigator('shop', 'orders');
      await pasteIntoId();
      await expect(strip).toBeVisible();
      await expect(strip).toContainText('Copied from Client A');
      await expect(strip).toContainText('shop.orders');
      await expect(strip).toContainText('This tab is on Client B');

      await ws.queryBarRunButton.click();
      await expect(strip).toContainText(`No results, and this value was copied from Client A.`);

      await strip.getByRole('button', { name: 'Dismiss' }).click();
      await expect(strip).toHaveCount(0);
    });
  });
});
