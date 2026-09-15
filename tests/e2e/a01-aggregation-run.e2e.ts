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
 * on a collection, add a `$match` stage, fill its body with a JSON filter,
 * click Run, and verify the matching documents appear in the Pipeline output.
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
      await expect(win.getByText('Pipeline', { exact: true })).toBeVisible({ timeout: 5000 });
      await expect(win.getByText('Pipeline output')).toBeVisible();

      // Add a $match stage. The "Add stage" pill opens a search dropdown.
      // Multiple AddStagePill buttons exist (one between each stage + one at
      // the end); the first is the only one visible when the pipeline is empty.
      await win.getByRole('button', { name: /Add stage/ }).first().click();
      const stageSearch = win.getByRole('textbox', { name: 'Search stages' });
      await stageSearch.fill('match');
      // Pick the $match operator from the dropdown.
      await win.getByText('$match', { exact: true }).first().click();

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
