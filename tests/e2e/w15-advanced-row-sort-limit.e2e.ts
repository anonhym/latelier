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
 * W15 §12 case 11 — one flow: set a sort and a limit from their pills in the
 * Filter Bar row, run, read them back off the *header* and the *pager* rather than off
 * the inputs that set them, then reload and confirm the whole composition
 * survived.
 *
 * Reading the result surfaces is the point. Asserting the inputs still hold
 * what was typed proves only that a controlled input is controlled; the
 * defect W15 §3.2 describes is precisely the header disagreeing with the
 * query that ran.
 */
test('a sort and a limit set from their pills reach the header and the pager, and survive a reload', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Sort And Limit' },
        {
          dbName: 'shop',
          collection: 'orders',
          docs: [
            { sku: 'aaa-1', qty: 1 },
            { sku: 'bbb-2', qty: 2 },
            { sku: 'ccc-3', qty: 3 },
          ],
        },
      );
      await expectStatusDot(win, 'Sort And Limit', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');
      // Wide enough that the option pills are separate, not folded into one (W05 §10.3).
      await win.setViewportSize({ width: 2200, height: 900 });
      // opening a tab auto-runs the base query. Let it land first.
      await expect(win.getByText('aaa-1')).toBeVisible({ timeout: 8000 });

      // ── Compose from the pills: sort descending on `sku`, limit 2. ──
      // Each pill opens its own editor with the focus in it, and Escape
      // hands the focus back to the pill.
      await expect(ws.queryBarAdvanced).toHaveCount(0);
      await ws.openOption('sort');
      await expect(ws.queryBarSort).toBeFocused();
      await ws.queryBarSort.fill('{"sku":-1}');
      // The field-suggestion list is open under the input and takes the first Escape;
      // the second closes the editor.
      await ws.queryBarSort.press('Escape');
      await ws.queryBarSort.press('Escape');
      await expect(ws.optionPill('sort')).toBeFocused();
      await expect(ws.optionPill('sort')).toHaveText('Sort: sku ↓');

      await ws.openOption('limit');
      await ws.queryBarLimit.fill('2');
      await ws.queryBarLimit.press('Escape');
      await expect(ws.optionPill('limit')).toHaveText('Limit: 2');
      await ws.queryBarRunButton.click();

      // The header agrees with the sort that ran.
      await ws.viewTableButton.click();
      await expect(ws.tableHeader('sku')).toContainText('↓', { timeout: 8000 });
      await expect(ws.tableHeader('sku').getByLabel('sorted descending')).toBeVisible();
      // Nothing was dropped, so the table-level note stays away.
      await expect(ws.tableSortNote).toHaveCount(0);
      // Descending: `ccc-3` is the first row.
      await expect(win.getByText('ccc-3')).toBeVisible();

      // The pager agrees with the limit that ran — limit 2 of 3 documents, so the count reads 2 documents.
      await expect(win.getByTestId('result-count-slot')).toContainText(/2 documents · \d+ ms/, { timeout: 8000 });

      // ── Reload and confirm the composition restored. ──
      // `patchCollectionState` writes through a 250ms debounce, so a reload
      // fired immediately would race the write it is meant to be testing.
      await win.waitForTimeout(1200);
      await win.reload();
      await win.waitForLoadState('domcontentloaded');

      await expect(ws.tabByName('orders')).toHaveAttribute('aria-selected', 'true', {
        timeout: 10000,
      });
      // The restored tab's pills say its options; nothing is paged, so Skip
      // stays in More.
      await expect(ws.optionPill('sort')).toHaveText('Sort: sku ↓', { timeout: 8000 });
      await expect(ws.optionPill('limit')).toHaveText('Limit: 2');
      await expect(ws.optionPill('skip')).toHaveCount(0);

      // The tab in front at launch runs its restored query once (W01 §14.10):
      // the restored state produces the same header and pager, with no Run.
      await expect(ws.tableHeader('sku')).toContainText('↓', { timeout: 8000 });
      await expect(win.getByTestId('result-count-slot')).toContainText(/2 documents · \d+ ms/, { timeout: 8000 });
      await expect(win.getByText('ccc-3')).toBeVisible();
    });
  });
});

/**
 * W15 §3.2 — the other half: a sort the header *cannot* draw must
 * still say something. `{ $meta: … }` is valid Mongo and runs, and
 * `parseSortString` drops it, so before this the header was
 * indistinguishable from an unsorted one.
 */
test('a sort the column arrows cannot express is still announced in the header', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await seedActiveConnectionWithDocs(
      win,
      { ...baseConnInput(host, port), name: 'Unrepresentable Sort' },
      {
        dbName: 'shop',
        collection: 'notes',
        docs: [{ body: 'alpha' }, { body: 'beta' }],
      },
    );
    await expectStatusDot(win, 'Unrepresentable Sort', 'connected');

    const ws = new WorkspacePage(win);
    await ws.openCollectionFromNavigator('shop', 'notes');
    await expect(win.getByText('alpha')).toBeVisible({ timeout: 8000 });

    await ws.viewTableButton.click();
    await expect(ws.tableSortNote).toHaveCount(0);

    await ws.openOption('sort');
    await ws.queryBarSort.fill('{"score":{"$meta":"textScore"}}');

    // No column arrow appears anywhere — that is the defect — but the gutter
    // now carries a named note instead of silence.
    await expect(ws.tableSortNote).toBeVisible();
    await expect(
      win.getByLabel('Sorted by a rule this header cannot show'),
    ).toBeVisible();
  });
});
