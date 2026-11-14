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
 * X14 §5 (T5) — a failed filter must not leave a stale count reading as
 * current.
 *
 * This is the criterion spec §5 calls the dangerous half: the count is still on
 * screen after a refused edit, and without a marker it reads as the answer to
 * the text now in the box. The assertion is on the staleness presentation, not
 * on the number — the number does not change, because a refused filter never
 * re-runs. That is the whole problem.
 */
test('a refused filter marks the result count not current, and clears on the next run', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Stale Count' },
        {
          dbName: 'shop',
          collection: 'orders',
          docs: [
            { sku: 'apple-001', status: 'paid' },
            { sku: 'banana-002', status: 'pending' },
            { sku: 'cherry-003', status: 'paid' },
          ],
        },
      );
      await expectStatusDot(win, 'Stale Count', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');

      // the tab auto-runs the base query on open. Wait for that result
      // to land, so there is a real count on screen to go stale.
      await expect(win.getByText('banana-002')).toBeVisible({ timeout: 8000 });

      const staleMarker = win.locator('[data-testid="result-count-stale"]');
      const resultBody = win.locator('[data-stale="true"]');
      await expect(staleMarker).toHaveCount(0);
      await expect(resultBody).toHaveCount(0);

      // Now break the filter with syntax the transform refuses. The regex
      // *literal* stopped being that once repair support landed, so the refusal
      // this reaches for is the `g` flag, which MongoDB has no equivalent for
      // and which the transform names rather than dropping.
      await ws.queryBarTextarea.fill('{status: /^pa/gi}');
      await ws.queryBarTextarea.blur();

      // The reason, beside the Run button it disables …
      const notice = win.locator('#query-bar-filter-error');
      await expect(notice).toBeVisible();
      await expect(notice).toContainText('"g"');
      await expect(notice).toContainText('global');
      await expect(notice).toContainText('Line 1, column 10');

      // … Run refuses to make the count current again …
      await expect(ws.queryBarRunButton).toBeDisabled();

      // … so a warn dot sits beside the count, a strip says whose rows these
      // are, and the rows stay at full strength, readable (W06 §8.2).
      await expect(staleMarker).toBeVisible();
      await expect(staleMarker).toHaveAccessibleName('Not current');
      await expect(win.getByTestId('band-stale')).toContainText('These results are from the previous filter.');
      await expect(resultBody).toHaveCount(1);
      expect(
        Number(await resultBody.evaluate((el) => getComputedStyle(el).opacity)),
      ).toBe(1);
      await expect(win.getByText('banana-002')).toBeVisible();

      // Repairing the filter lifts the refusal and enables Run, but the rows are still the
      // previous filter's (W06 §8.2): they stay marked until a run replaces them.
      await ws.queryBarTextarea.fill('{status: "paid"}');
      await ws.queryBarTextarea.blur();

      await expect(notice).toHaveCount(0);
      await expect(ws.queryBarRunButton).toBeEnabled();
      await expect(staleMarker).toBeVisible();
      await expect(win.getByTestId('band-stale')).toBeVisible();

      // Running it clears every part of the marking.
      await ws.queryBarRunButton.click();
      await expect(staleMarker).toHaveCount(0);
      await expect(win.getByTestId('band-stale')).toHaveCount(0);
      await expect(resultBody).toHaveCount(0);
      await expect(win.getByText('banana-002')).toHaveCount(0);
    });
  });
});
