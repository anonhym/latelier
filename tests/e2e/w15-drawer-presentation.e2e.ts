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
 * W15 §13 — the drawer's presentation, in the real app.
 *
 * The component suite covers each fix in isolation; what only a real
 * Electron window can prove is that the two pieces relying on app-level
 * providers actually mount — Reset's `modals.openConfirmModal` needs the
 * `ModalsProvider` in `App.tsx`, and Mantine's `Tabs` needs real focus and
 * key handling for arrow-key roving. Both are silent no-ops if wired wrong.
 */
test('drawer presentation: Reset confirms, and the tab strip roves with the arrow keys', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Drawer Target' },
        {
          dbName: 'shop',
          collection: 'orders',
          docs: [
            { sku: 'apple-001', status: 'paid' },
            { sku: 'banana-002', status: 'pending' },
          ],
        },
      );
      await expectStatusDot(win, 'Drawer Target', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');
      await expect(win.getByText('banana-002')).toBeVisible({ timeout: 8000 });

      // The Query Builder is closed by default (W05 §9.1); the drawer is what is under test.
      await ws.openBuilder();

      // ── the empty tree explains itself ────────────────────────────────
      await expect(win.getByText(/matches every document/i)).toBeVisible();

      // Build something worth protecting.
      await win.getByRole('button', { name: 'Add condition' }).click();
      await win.getByPlaceholder('field', { exact: true }).first().fill('status');
      await win.getByPlaceholder('value', { exact: true }).first().fill('paid');
      const bar = win.getByTestId('query-bar-input');
      await expect(bar).toHaveValue('{"status":{"$eq":"paid"}}');

      // Remove is an item of the row's menu, which the row names by position.
      await expect(
        win.getByRole('button', { name: 'Condition options 1', exact: true }),
      ).toBeVisible();

      // ── Reset confirms rather than wiping on one click ────────────────
      await win.getByRole('button', { name: 'Reset' }).click();
      const dialog = win.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 4000 });
      await expect(bar).toHaveValue('{"status":{"$eq":"paid"}}');

      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).not.toBeVisible({ timeout: 4000 });
      await expect(bar).toHaveValue('{"status":{"$eq":"paid"}}');

      await win.getByRole('button', { name: 'Reset' }).click();
      await expect(win.getByRole('dialog')).toBeVisible({ timeout: 4000 });
      await win.getByRole('dialog').getByRole('button', { name: 'Reset' }).click();
      await expect(bar).toHaveValue('{}');

      // ── Saved and Recent live in the row's popovers, not in the strip ─
      const strip = win.getByRole('tablist', { name: 'Inspector view' });
      await expect(strip.getByRole('tab')).toHaveCount(2);
      await expect(strip.getByRole('tab', { name: 'Filter' })).toHaveAttribute('aria-selected', 'true');

      await win.getByTestId('query-bar-saved-btn').click();
      await win.getByRole('tab', { name: 'History' }).click();

      // ── a Recent row says what it would re-run ────────────────────────
      // The auto-run on tab open recorded the unfiltered `{}` find.
      await expect(win.getByText('Recent · orders')).toBeVisible({ timeout: 5000 });
      await expect(
        win.getByRole('button', { name: /^Copy MQL to the clipboard$/ }).first(),
      ).toBeVisible({ timeout: 8000 });
    });
  });
});

/**
 * W15 §14.5 — feedback while composing, in the real app: the drawer shows how
 * many documents the filter matches before Run is pressed.
 */
test('drawer feedback: the match count appears without pressing Run', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Count Target' },
        {
          dbName: 'shop',
          collection: 'orders',
          docs: [
            { sku: 'apple-001', a: 'x' },
            { sku: 'banana-002', a: 'x' },
            { sku: 'cherry-003', a: 'y' },
          ],
        },
      );
      await expectStatusDot(win, 'Count Target', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');
      await expect(win.getByText('cherry-003')).toBeVisible({ timeout: 8000 });

      await ws.openBuilder();
      await win.getByRole('button', { name: 'Add condition' }).click();
      await win.getByPlaceholder('field', { exact: true }).first().fill('a');
      await win.getByPlaceholder('value', { exact: true }).first().fill('x');

      // No Run: the count comes from the committed filter alone.
      await expect(win.getByText('≈2 match')).toBeVisible({ timeout: 5000 });
    });
  });
});
