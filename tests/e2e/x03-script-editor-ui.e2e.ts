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

      // Open a Script tab via the "+ Script" button at the end of the tab strip
      // (`Workspace.tsx:377` — aria-label="New script tab").
      await ws.newScriptTab.click();

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
