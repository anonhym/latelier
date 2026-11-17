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
 * W14 §4, §11 — the projection is edited in the Fields control, not the query
 * bar's advanced row, and Run sends it exactly as before: the field it
 * leaves out stops coming back from the server.
 */
test('a projection set in the Fields control is what the next Run fetches', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Fields Projection Target' },
        {
          dbName: 'shop',
          collection: 'customers',
          docs: [{ name: 'ada', tier: 'gold' }],
        },
      );
      await expectStatusDot(win, 'Fields Projection Target', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'customers');
      await expect(win.getByText('gold')).toBeVisible({ timeout: 8000 });

      // Projection is the Project pill, in the Filter Bar row with the other
      // options; the grid behind "Keep options expanded" has no cell for it.
      // Kept expanded, so Project is its own pill at any window width: folded,
      // it is an item of the `Options` menu.
      await ws.toggleOptionsExpanded();
      await expect(ws.fieldsButton).toHaveText('Project');
      await expect(ws.queryBarAdvanced).toBeVisible();
      await expect(ws.queryBarAdvanced.getByText(/projection/i)).toHaveCount(0);

      await ws.fieldsButton.click();
      // One list and one text box: no section headings.
      await expect(ws.fieldsProjection).toBeVisible();
      await expect(win.getByText('Fetch only these fields from the server')).toHaveCount(0);
      await expect(win.getByText('Show in results')).toHaveCount(0);
      await ws.fieldsProjection.fill('{ name: 1 }');
      await ws.fieldsProjection.press('Enter');
      await expect(ws.fieldsProjection).toHaveValue('{ name: 1 }');

      // The views hide what the projection keeps off the wire at once, though
      // the server is only asked at the next Run.
      await expect(win.getByText('gold')).toHaveCount(0);

      await ws.queryBarRunButton.click();
      // Exact and quoted: a bare `ada` can also match the last 8 hex chars of a generated
      // ObjectId, which the projection keeps, and trip strict mode.
      await expect(win.getByText('"ada"', { exact: true })).toBeVisible({ timeout: 8000 });
      await expect(win.getByText('gold')).toHaveCount(0);
    });
  });
});
