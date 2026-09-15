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
 * W13 §11 — the end-to-end proof for the filter tree editor. Builds
 * a nested `(a AND (b OR c))` filter entirely through the drawer's own
 * add-condition / add-group / logic-picker controls, runs it, then hand-edits
 * the query bar to an `$elemMatch` clause — a shape the pre-W13 builder could
 * never compile — and confirms the drawer degrades to an editable raw clause
 * (§2) rather than disabling, and that Run still works from there.
 */
test('filter tree editor: build a nested filter in the drawer, run it, then hand-edit to a raw $elemMatch clause', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Filter Tree Target' },
        {
          dbName: 'shop',
          collection: 'orders',
          docs: [
            // Matches (a AND (b OR c)) via the a+b branch.
            { name: 'match-ab', a: 'x', b: 'y', items: [{ sku: 1 }] },
            // Matches (a AND (b OR c)) via the a+c branch.
            { name: 'match-ac', a: 'x', c: 'z', items: [{ sku: 2 }] },
            // Has "a" but neither "b" nor "c" — excluded.
            { name: 'no-match-a-only', a: 'x', items: [{ sku: 1 }] },
            // Has "b" and "c" but no "a" — excluded.
            { name: 'no-match-bc-only', b: 'y', c: 'z', items: [{ sku: 1 }] },
          ],
        },
      );
      await expectStatusDot(win, 'Filter Tree Target', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');

      // The auto-run-on-open fires the base (unfiltered) query. Wait
      // for it to land before driving the drawer — a manual Run racing the
      // auto-run's single-flight guard would silently drop.
      await expect(win.getByText('no-match-bc-only')).toBeVisible({ timeout: 8000 });

      // ─── Build (a AND (b OR c)) in the drawer ─────────────────────────

      // Root group defaults to AND. Add its first condition: a = "x".
      await win.getByRole('button', { name: 'Add condition' }).first().click();
      await win.getByPlaceholder('field').nth(0).fill('a');
      await win.getByPlaceholder('value').nth(0).fill('x');

      // Add a nested group as the root's second child.
      await win.getByRole('button', { name: 'Add group' }).first().click();

      // The nested group is the second "Group logic" control in the tree —
      // flip it from its AND default to OR.
      const nestedLogic = win.getByRole('radiogroup', { name: 'Group logic' }).nth(1);
      await nestedLogic.getByRole('radio', { name: 'OR', exact: true }).click();

      // Add the nested group's two conditions: b = "y", c = "z". Its own
      // "Add condition" button is now the second one in the tree.
      const nestedAddCondition = win.getByRole('button', { name: 'Add condition' }).nth(1);
      await nestedAddCondition.click();
      await win.getByPlaceholder('field').nth(1).fill('b');
      await win.getByPlaceholder('value').nth(1).fill('y');

      await nestedAddCondition.click();
      await win.getByPlaceholder('field').nth(2).fill('c');
      await win.getByPlaceholder('value').nth(2).fill('z');

      // The printed filter should now be {"$and":[{"a":...},{"$or":[...]}]}.
      await expect(ws.queryBarTextarea).toHaveValue(
        '{"$and":[{"a":{"$eq":"x"}},{"$or":[{"b":{"$eq":"y"}},{"c":{"$eq":"z"}}]}]}',
      );

      await ws.queryBarRunButton.click();

      await expect(win.getByText('match-ab')).toBeVisible({ timeout: 8000 });
      await expect(win.getByText('match-ac')).toBeVisible();
      await expect(win.getByText('no-match-a-only')).not.toBeVisible();
      await expect(win.getByText('no-match-bc-only')).not.toBeVisible();

      // ─── Hand-edit the bar to an $elemMatch clause ────────────────────
      //
      // Pre-W13 this op couldn't compile — the builder disabled itself.
      // W13's parseFilter degrades it to a raw node instead (§2): the
      // drawer stays editable, showing a raw-clause textarea rather than a
      // "Builder disabled" dead end.
      await ws.queryBarTextarea.fill('{"items":{"$elemMatch":{"sku":2}}}');

      const rawClause = win.getByRole('textbox', { name: 'Raw clause' });
      await expect(rawClause).toBeVisible({ timeout: 5000 });
      await expect(rawClause).toHaveValue('{"items":{"$elemMatch":{"sku":2}}}');
      // Not frozen read-only: the "isn't valid JSON" banner must be absent.
      await expect(win.getByText(/isn't valid JSON/)).not.toBeVisible();

      await ws.queryBarRunButton.click();

      await expect(win.getByText('match-ac')).toBeVisible({ timeout: 8000 });
      await expect(win.getByText('match-ab')).not.toBeVisible();
      await expect(win.getByText('no-match-a-only')).not.toBeVisible();
      await expect(win.getByText('no-match-bc-only')).not.toBeVisible();
    });
  });
});
