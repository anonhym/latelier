import { test, expect } from '@playwright/test';
import {
  baseConnInput,
  startMemoryServer,
  stopAllMemoryServers,
  withApp,
} from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import { seedActiveConnection } from './helpers/uiSeed';
import { expectConsoleClean, expectStatusDot } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

/**
 * X03 — Script editor (UI-driven). The existing `script-run-cancel.e2e.ts`
 * IPC test exercises `script.run` directly. This spec drives the CodeMirror
 * editor + Run button + result panel through the UI.
 *
 * The editor is a CodeMirror 6 contenteditable surface marked with
 * `data-testid="script-editor"` (`ScriptTab.tsx:278`); we focus the
 * `.cm-content` child and use `keyboard.type` since `.fill()` doesn't work
 * on CM's contenteditable.
 */
test('script editor ui: type 1 + 2, run, result panel shows 3', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnection(win, {
        ...baseConnInput(host, port),
        name: 'Script Target',
      });
      await expectStatusDot(win, 'Script Target', 'connected');

      const ws = new WorkspacePage(win);

      // Open a Script tab from the tab strip's `+ ▾` menu.
      await ws.openNewScript();

      // CodeMirror's editable content lives inside `[data-testid] .cm-content`.
      const cmContent = win.locator('[data-testid="script-editor"] .cm-content');
      await expect(cmContent).toBeVisible({ timeout: 5000 });
      await cmContent.click();
      await win.keyboard.type('1 + 2');

      // Run via the toolbar button. Scoped by data-testid because the
      // QueryBar in collection tabs has a similarly-named "Run" button.
      await win.locator('[data-testid="script-run-btn"]').click();

      // Result panel renders `3` after the run completes.
      await expect(win.getByText('3', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    });
  });
});

/**
 * W12 §8: a script that looks destructive is confirmed before it runs, and a
 * closed script tab comes back with its source (W01 §14.8).
 */
test('script editor ui: deleteMany({}) is confirmed before it runs; a closed script tab reopens with its source', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnection(win, {
        ...baseConnInput(host, port),
        name: 'Guard Target',
      });
      await expectStatusDot(win, 'Guard Target', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openNewScript();

      // The output panel is there from the first render, before any run.
      await expect(win.getByText(/Output appears here/)).toBeVisible({ timeout: 5000 });

      const cmContent = win.locator('[data-testid="script-editor"] .cm-content');
      await cmContent.click();
      const source = 'db.getCollection("orders").deleteMany({})';
      await win.keyboard.type(source);

      // Run: the confirmation names the Connection, and Cancel runs nothing.
      await win.locator('[data-testid="script-run-btn"]').click();
      const dialog = win.getByRole('dialog');
      await expect(dialog).toContainText('deleteMany({}) on Guard Target');
      await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toBeHidden();
      await expect(win.getByText(/Output appears here/)).toBeVisible();

      // Run anyway runs it.
      await win.locator('[data-testid="script-run-btn"]').click();
      await win.getByRole('button', { name: 'Run anyway' }).click();
      await expect(win.getByText(/Output appears here/)).toBeHidden({ timeout: 10000 });

      // Close the tab, then reopen it: the source is still there.
      await ws.closeTab('Script 1');
      await expect(win.locator('[data-testid="script-editor"]')).toHaveCount(0);
      await win.keyboard.press('ControlOrMeta+Shift+T');
      await expect(win.locator('[data-testid="script-editor"] .cm-content')).toContainText(
        'deleteMany({})',
        { timeout: 5000 },
      );
    });
  });
});
