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
 * W13 §7 — ⌘↵ runs from anywhere in the Documents view. The reported path:
 * drag a value from the results into the Query Builder, then press ⌘↵ with no
 * further click. The drop leaves focus on the result grid, which used to have
 * no ⌘↵ handler, so nothing ran. A real drag and a real key press are the
 * point here — jsdom has neither native drag nor a button's Enter activation.
 */
test('⌘↵ runs right after dragging a result value into the builder', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Run Shortcut Target' },
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
      await expectStatusDot(win, 'Run Shortcut Target', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');
      // Let the auto-run land first; the runner drops a run that overlaps it.
      await expect(win.getByText('banana-002')).toBeVisible({ timeout: 8000 });
      await ws.viewTableButton.click();

      const pendingCell = win.getByTitle(/Drag to add "status/).filter({ hasText: 'pending' });
      await expect(pendingCell).toBeVisible({ timeout: 8000 });
      await pendingCell.dragTo(
        win.getByLabel('Drop a field here to add a condition'),
      );
      await expect(ws.queryBarTextarea).toHaveValue(/pending/);

      await win.keyboard.press('ControlOrMeta+Enter');

      await expect(win.getByText('apple-001')).not.toBeVisible({ timeout: 8000 });
      await expect(win.getByText('banana-002')).toBeVisible();
      // The grid's own ⌘+Enter would have selected the row it landed on.
      await expect(ws.selectionBarCount).toHaveCount(0);
    });
  });
});

test('⌘↵ on the focused Run button runs, and Run sits after History', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Run Button Target' },
        {
          dbName: 'shop',
          collection: 'orders',
          docs: [
            { sku: 'apple-001', status: 'paid' },
            { sku: 'banana-002', status: 'pending' },
          ],
        },
      );
      await expectStatusDot(win, 'Run Button Target', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');
      await expect(win.getByText('banana-002')).toBeVisible({ timeout: 8000 });

      // Run is the last toolbar control, beside the builder.
      const runBox = await ws.queryBarRunButton.boundingBox();
      const historyBox = await win.getByRole('button', { name: 'History' }).boundingBox();
      expect(runBox && historyBox && runBox.x > historyBox.x).toBe(true);

      await ws.queryBarTextarea.fill('{"status": "paid"}');
      await ws.queryBarRunButton.focus();
      await win.keyboard.press('ControlOrMeta+Enter');

      await expect(win.getByText('banana-002')).not.toBeVisible({ timeout: 8000 });
      await expect(win.getByText('apple-001')).toBeVisible();
    });
  });
});
