import { test, expect } from '@playwright/test';
import { baseConnInput, startMemoryServer, stopAllMemoryServers, withApp } from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import { seedActiveConnectionWithDocs } from './helpers/uiSeed';
import { expectConsoleClean } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

const MULTI_SELECT_MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';

// Integer _ids and an integer field, written as canonical EJSON so they are
// Int32 in the collection: a readable copy shows 1, a canonical one $numberInt.
const docs = [1, 2, 3].map((n) => ({
  _id: { $numberInt: String(n) },
  label: `row-${n}`,
  qty: { $numberInt: String(n * 10) },
}));

/**
 * W06 §8 — what a copy puts on the clipboard follows the copy-format
 * preference, for a selected document and for a card's own button alike, and
 * a collection of integer _ids still gives every row a distinct id.
 */
test('copy: the clipboard follows the copy format, from the selection pill and a JSON card; integer _ids stay distinct', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Copy Formats' },
        { dbName: 'shop', collection: 'orders', docs },
      );
      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');
      await expect(win.getByText('row-3')).toBeVisible({ timeout: 8000 });
      await ws.viewJsonButton.click();

      // Distinct row ids: one copy button per card, each named by its own _id.
      for (const id of ['1', '2', '3']) {
        await expect(win.getByRole('button', { name: `Copy JSON for document ${id}`, exact: true })).toHaveCount(1);
      }

      const clipboard = () => app.evaluate(({ clipboard: c }) => c.readText());
      const clipboardJson = async () => JSON.parse(await clipboard());

      // Readable is the default: plain numbers.
      await win.getByText('row-2').click({ modifiers: [MULTI_SELECT_MODIFIER] });
      await expect(ws.selectionBarCount).toHaveText('1 selected');
      await ws.selectionBarCopyButton.click();
      await expect.poll(clipboard).toContain('"label": "row-2"');
      expect(await clipboard()).not.toContain('$numberInt');
      expect(await clipboardJson()).toMatchObject({ _id: 2, qty: 20 });

      // A card's own button copies the same form for that card.
      await win.getByRole('button', { name: 'Copy JSON for document 3', exact: true }).click();
      await expect.poll(clipboardJson).toMatchObject({ _id: 3, qty: 30 });

      // Choosing Canonical EJSON in "Copy as…" copies it and becomes the default.
      await win.getByTestId('selection-bar-copy-as').click();
      await win.getByRole('menuitem', { name: 'Canonical EJSON' }).click();
      await expect.poll(clipboardJson).toMatchObject({ _id: { $numberInt: '2' }, qty: { $numberInt: '20' } });

      // The card's button now names what it copies, and copies canonical.
      await win.getByRole('button', { name: 'Copy canonical EJSON for document 3', exact: true }).click();
      await expect.poll(clipboardJson).toMatchObject({ _id: { $numberInt: '3' } });
    });
  });
});
