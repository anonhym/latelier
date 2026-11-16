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
 * W14 §9 — a case-insensitive collation set in the options row reaches the
 * find and the count alike: the mixed-case row shows, and the total says so.
 * A count that dropped the collation would still say 1.
 */
test('a case-insensitive collation matches the mixed-case row, and the count agrees', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Find Options' },
        {
          dbName: 'shop',
          collection: 'people',
          docs: [{ name: 'Ada' }, { name: 'ada' }, { name: 'Bob' }],
        },
      );
      await expectStatusDot(win, 'Find Options', 'connected');

      const ws = new WorkspacePage(win);
      // The rows, not the filter drawer, which shows the filter's own value.
      const rows = win.getByTestId('h-result');
      await ws.openCollectionFromNavigator('shop', 'people');
      // Wide enough that the option pills are separate, not folded into one (W05 §10.3).
      await win.setViewportSize({ width: 2200, height: 900 });
      await expect(rows.getByText('"Bob"', { exact: true })).toBeVisible({ timeout: 8000 });

      // Without a collation the match is binary: only the lower-case row.
      await ws.queryBarTextarea.fill('{"name":"ada"}');
      await ws.queryBarRunButton.click();
      await expect(rows.getByText('"Bob"', { exact: true })).toHaveCount(0, { timeout: 8000 });
      await expect(rows.getByText('"ada"', { exact: true })).toBeVisible();
      await expect(rows.getByText('"Ada"', { exact: true })).toHaveCount(0);
      await expect(win.getByTestId('result-count-slot')).toContainText(/1 document · \d+ ms/);

      // Collation is unset, so it waits in More; picking it draws its pill
      // with the editor open.
      await ws.openOption('collation', 'Collation');
      const collation = win.locator('[data-testid="query-bar-collation"]');
      await collation.fill('{"locale":"en","strength":2}');
      await expect(collation).toHaveValue('{"locale":"en","strength":2}');
      await collation.press('Escape');
      await expect(ws.optionPill('collation')).toHaveText('Collation: en');
      await ws.queryBarRunButton.click();

      await expect(rows.getByText('"Ada"', { exact: true })).toBeVisible({ timeout: 8000 });
      await expect(rows.getByText('"ada"', { exact: true })).toBeVisible();
      await expect(win.getByTestId('result-count-slot')).toContainText(/2 documents · \d+ ms/);
    });
  });
});
