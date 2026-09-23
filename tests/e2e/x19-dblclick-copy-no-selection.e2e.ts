import { test, expect } from '@playwright/test';
import {
  baseConnInput,
  startMemoryServer,
  stopAllMemoryServers,
  withApp,
} from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import { seedActiveConnectionWithDocs } from './helpers/uiSeed';
import { expectConsoleClean } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

/**
 * #106 — TableView double-click-to-copy copied the row ABOVE the one the
 * user clicked, whenever nothing was already selected. The first click of
 * the dblclick selected the row, which used to mount the "1 selected"
 * SelectionActionBar above the grid and shift it down 31px; the second
 * click then landed on the row that had scrolled up into its place, so
 * `dblclick` fired there instead. The fix reserves the bar's space so
 * nothing shifts (`SelectionActionBar.tsx`).
 */
test('double-clicking a cell with no prior selection copies that cell, not the row above (#106)', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Dblclick No Selection' },
        {
          dbName: 'shop',
          collection: 'orders',
          docs: [{ name: 'alpha' }, { name: 'beta' }, { name: 'gamma' }],
        },
      );
      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');
      // The auto-run on open is the only query run. A second Run click used to
      // land its result mid-test on a slow CI runner, replacing `documents`
      // and resetting the active row (PR #122's shard 4).
      await ws.viewTableButton.click();

      const grid = win.getByRole('grid', { name: 'Documents' });
      await expect(grid).toBeVisible({ timeout: 8000 });
      await expect(win.locator('#table-row-1')).toBeVisible({ timeout: 8000 });

      // A sentinel proves the eventual clipboard read reflects this
      // dblclick, not a stale value left over from setup.
      await app.evaluate(({ clipboard }) => clipboard.writeText('sentinel'));

      // Nothing is selected yet — the bar's contents aren't mounted (AC1).
      await expect(ws.selectionBarCount).toHaveCount(0);

      const gridBefore = (await grid.boundingBox())!;

      // Double-click row 1's ("beta") name cell. Before the fix, the first
      // click's selection shifted the grid and the second click landed on
      // row 0 ("alpha") instead.
      const cell = win.locator('#table-row-1').getByTitle(/Drag to add "name/);
      const cb = (await cell.boundingBox())!;
      await cell.dblclick({ position: { x: 12, y: cb.height / 2 } });

      await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('beta');

      // The grid never moved — the bar's space was reserved throughout.
      const gridAfter = (await grid.boundingBox())!;
      expect(gridAfter.y).toBeCloseTo(gridBefore.y, 0);
    });
  });
});
