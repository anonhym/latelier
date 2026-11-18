import {
  baseConnInput,
  startMemoryServer,
  stopAllMemoryServers,
  withApp,
} from '../helpers/e2eApp';
import { test, expect } from '@playwright/test';
import { WorkspacePage } from './pages';
import { seedActiveConnectionWithDocs } from './helpers/uiSeed';
import { expectConsoleClean, expectStatusDot } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

/**
 * ADR 0004's "Scope note: symbolic operators in the Query Builder", and
 * the commit-point defect a manual test found in it.
 *
 * The component suite covers the resolution itself. What only the real app
 * settles is *which* keystrokes count as finishing the box — jsdom's
 * `fireEvent.blur` fires a handler that a real Enter never reached. All three
 * endings are asserted here because the one that shipped broken was the one
 * nobody had written a test for.
 */
test('builder symbols: >, resolved by Enter, Tab and click-away alike', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Symbol Target' },
        {
          dbName: 'shop',
          collection: 'orders',
          docs: [{ sku: 'apple-001', qty: 1 }, { sku: 'banana-002', qty: 5 }],
        },
      );
      await expectStatusDot(win, 'Symbol Target', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');
      // The tab auto-runs its unfiltered query on open; let it land before
      // driving the builder.
      await expect(win.getByText('banana-002')).toBeVisible({ timeout: 8000 });

      await ws.openBuilder();
      await win.getByRole('button', { name: 'Add condition' }).click();
      await win.getByPlaceholder('field', { exact: true }).first().fill('qty');
      // #128 — pick the field from the suggestions, as a person would: that
      // is what types the value as a number. A typed-only field keeps the
      // value a string, and `{"$gt":"3"}` matches nothing.
      await win
        .getByRole('listbox', { name: 'Field suggestions' })
        .getByRole('option', { name: /qty/ })
        .first()
        .click();
      const op = win.getByPlaceholder('$op').first();

      // Enter. This is what a person presses when they are done, and
      // it used to leave `>` sitting in an unprintable row.
      await op.fill('>');
      await op.press('Enter');
      await expect(op).toHaveValue('>');

      // Tab.
      await op.fill('>=');
      await op.press('Tab');
      await expect(op).toHaveValue('>=');

      // Click-away.
      await op.fill('<');
      await win.getByPlaceholder('field', { exact: true }).first().click();
      await expect(op).toHaveValue('<');

      // The resolved operator is a real one, so the row compiles and runs.
      await op.fill('>');
      await op.press('Enter');
      await win.getByPlaceholder('value', { exact: true }).first().fill('3');
      await expect(ws.queryBarTextarea).toHaveValue('{"qty":{"$gt":3}}');
      await ws.queryBarRunButton.click();

      // #128 — `apple-001` first: until it is gone, the rows on screen are
      // still the previous, unfiltered result, which also shows `banana-002`.
      await expect(win.getByText('apple-001')).toHaveCount(0);
      await expect(win.getByText('banana-002')).toBeVisible();

      // Picked from the list: the box reads `>=`, the bar still says `$gte`.
      // The Run click blurred the box; its list closes on a 100ms timer, which
      // must not land after the next focus has reopened it.
      const opList = win.getByRole('listbox', { name: 'Operator suggestions' });
      await expect(opList).toBeHidden();
      await op.fill('$gte');
      await expect(
        win.getByRole('listbox', { name: 'Operator suggestions' }).getByText('greater than or equal to'),
      ).toBeVisible();
      await op.press('ArrowDown');
      await op.press('Enter');
      await expect(op).toHaveValue('>=');
      await expect(ws.queryBarTextarea).toHaveValue('{"qty":{"$gte":3}}');
    });
  });
});
