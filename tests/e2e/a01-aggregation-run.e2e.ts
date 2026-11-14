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
 * A01 + A02 + A04 — Aggregation tab basics. Switch to the Aggregation sub-tab
 * on a collection, add a `$match` stage from the empty pipeline's starter
 * chips, fill its body with a JSON filter, click Run, and verify the matching
 * documents appear in the preview column.
 *
 * Stage bodies are a CodeMirror 6 `ScriptEditor` (T2.4), marked with
 * `data-testid="stage-body-editor-<id>"` (`StageAccordion.tsx`) — the first
 * stage added to an empty pipeline always gets id 1. We focus the
 * `.cm-content` child and use `keyboard.type` since `.fill()` doesn't work
 * on CM's contenteditable (same convention as `x03-script-editor-ui.e2e.ts`).
 */
test('aggregation: add $match stage, run, output shows filtered docs', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      // Documents are inserted before the connection is made Active (see
      // seedActiveConnectionWithDocs), so the navigator's first DB-list
      // fetch sees 'shop' rather than racing it.
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Aggregation Target' },
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
      await expectStatusDot(win, 'Aggregation Target', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');

      // Switch to Aggregation sub-tab (SubTabStrip uses `role="tablist"`,
      // `aria-label="Collection view"` with role=tab buttons). Scoped to that
      // strip: since X16.2 a workspace tab is named for its collection
      // *and* its Connection, and this Connection is "Aggregation Target".
      await ws.tablist.getByRole('tab', { name: /Aggregation/ }).click();
      // An empty pipeline offers starter chips, and its preview says why Run waits.
      await expect(win.getByText('Add a first stage')).toBeVisible({ timeout: 5000 });
      await expect(win.getByRole('region', { name: 'Preview' }).getByText('Add a stage to run')).toBeVisible();
      await win.getByRole('button', { name: '$match', exact: true }).click();

      // Stage body editor — the first stage added to an empty pipeline gets
      // id 1, so `stage-body-editor-1` is unique and stable.
      const matchBody = win.locator('[data-testid="stage-body-editor-1"] .cm-content');
      await expect(matchBody).toBeVisible({ timeout: 5000 });
      await matchBody.click();
      // Select-all + Backspace to clear the op's default scaffold body first
      // — CM's `closeBrackets` wraps a live *selection* in brackets rather
      // than replacing it, so typing over the selection directly would
      // leave the old body's brackets in place.
      await win.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      await win.keyboard.press('Backspace');
      await win.keyboard.type('{ "status": "paid" }');

      // Click Run in the toolbar.
      await win.getByRole('button', { name: 'Run', exact: true }).click();

      // Output: only the two paid SKUs should appear. Use .first() because
      // each doc renders both as a tree-view <span> and as a JSON <pre> body
      // — both are real renderings, just two locator hits per doc.
      await expect(win.getByText('apple-001').first()).toBeVisible({ timeout: 8000 });
      await expect(win.getByText('cherry-003').first()).toBeVisible();
      await expect(win.getByText('banana-002')).not.toBeVisible();
    });
  });
});

/**
 * A01 §9.7 — stages beside their preview. Build the pipeline from a starter
 * chip, run it, run up to the first stage and read its preview, then export
 * the full result. Selecting a card or the Output row never runs anything;
 * Export results acts on the full run whatever is selected.
 */
test('aggregation: starter chip, run, run up to stage 1, export the result', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Side By Side' },
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
      await expectStatusDot(win, 'Side By Side', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');
      await ws.tablist.getByRole('tab', { name: /Aggregation/ }).click();
      const preview = win.getByRole('region', { name: 'Preview' });
      const heading = win.getByTestId('preview-heading');

      // Stage 1 from a starter chip: $match on the paid orders.
      await win.getByRole('button', { name: '$match', exact: true }).click();
      const matchBody = win.locator('[data-testid="stage-body-editor-1"] .cm-content');
      await expect(matchBody).toBeVisible({ timeout: 5000 });
      await matchBody.click();
      await win.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      await win.keyboard.press('Backspace');
      await win.keyboard.type('{ "status": "paid" }');

      // Stage 2 from the tail pill: $count, whose default body is valid.
      await win.getByRole('button', { name: /Add stage/ }).last().click();
      await win.getByRole('textbox', { name: 'Search stages' }).fill('count');
      await win.getByRole('option').filter({ hasText: '$count' }).first().click();
      await expect(win.locator('[data-stage-summary="2"]')).toBeVisible();

      await win.getByRole('button', { name: 'Run', exact: true }).click();

      // The Output row shows the full run. The heading's title carries the
      // count at every width; its text drops it in a narrow column.
      await win.getByRole('button', { name: /^Output/ }).click();
      await expect(heading).toHaveAttribute('title', /^Output · 1 docs/, { timeout: 8000 });
      await expect(preview).toContainText('totalCount');

      // Stage 1, run up to: its preview reads the two paid orders.
      await win.locator('[data-stage-summary="1"]').click();
      await win.getByRole('button', { name: 'Run to here' }).click();
      await expect(heading).toHaveAttribute('title', 'Stage 1 · $match · 2 docs', { timeout: 8000 });
      await expect(preview.getByText('apple-001').first()).toBeVisible();
      await expect(preview.getByText('cherry-003').first()).toBeVisible();
      await expect(preview.getByText('banana-002')).toHaveCount(0);

      // The card's ⋯ menu is not clipped by its 32px row: Duplicate is reachable.
      await win.getByRole('button', { name: 'Actions for stage 2' }).click();
      await win.getByRole('menuitem', { name: 'Duplicate' }).click();
      await expect(win.locator('[data-stage-summary]')).toHaveCount(3);

      // Export results → Copy copies the full run, not a stage sample.
      await win.getByRole('button', { name: 'Export results' }).click();
      await win.getByRole('menuitem', { name: 'Copy' }).click();
      await expect
        .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
        .toContain('"totalCount": 2');
    });
  });
});
