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
 * W09 — Document insert + edit + delete via the workspace doc toolbar and
 * TreeView per-row buttons. (DeleteMany requires the multi-doc confirmation
 * flow which is also a separate surface.)
 */
test('doc writes: insert adds a row; edit replaces a field; delete removes the row', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Writes Target' },
        {
          dbName: 'shop',
          collection: 'orders',
          docs: [
            { _id: 1, sku: 'before-edit', status: 'pending' },
            { _id: 2, sku: 'to-be-deleted', status: 'pending' },
          ],
        },
      );
      await expectStatusDot(win, 'Writes Target', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');

      await ws.queryBarRunButton.click();
      await expect(win.getByText('before-edit')).toBeVisible({ timeout: 8000 });
      await expect(win.getByText('to-be-deleted')).toBeVisible();

      // ── Insert ──────────────────────────────────────────────────────────
      // Toolbar Insert button (visible "+ Insert", aria-label
      // "Insert document") opens the InsertDrawer. The drawer's own
      // primary action is just "Insert" so the regex below distinguishes
      // them — we want the toolbar one here.
      await win.getByRole('button', { name: /Insert document/ }).click();

      // The drawer's textarea is the last on the page (rendered after the
      // QueryBar's `placeholder="{}"` textarea). Same `.last()` convention
      // as the EditDrawer textarea below.
      await expect(win.getByText('Insert document', { exact: true })).toBeVisible({
        timeout: 5000,
      });
      const insertTextarea = win.locator('textarea').last();
      await insertTextarea.fill('{"_id": 3, "sku": "fresh-insert", "status": "pending"}');

      // The drawer's primary "Insert" button is the only "Insert" rendered.
      await win.getByRole('button', { name: /^Insert$/ }).click();

      // Drawer closes, run reruns automatically. New row appears.
      await expect(win.getByText('fresh-insert')).toBeVisible({ timeout: 8000 });

      // ── Edit ────────────────────────────────────────────────────────────
      // Per-row Edit button: `<button title="Edit document">` in TreeView.
      await win.locator('button[title="Edit document"]').first().click();

      // EditDrawer opens — header text "Edit document" is the unique signal.
      // The drawer's textarea is the last on the page (rendered after the
      // QueryBar's `placeholder="{}"` textarea).
      await expect(win.getByText('Edit document')).toBeVisible({ timeout: 5000 });
      const editTextarea = win.locator('textarea').last();
      await editTextarea.fill('{"_id": 1, "sku": "before-edit", "status": "shipped"}');

      // The Save button inside the drawer is also the last "Save" rendered.
      await win.getByRole('button', { name: /^Save$/ }).last().click();

      // Drawer closes, run reruns automatically (Workspace.tsx:1816).
      await expect(win.getByText('shipped')).toBeVisible({ timeout: 8000 });

      // ── Delete ──────────────────────────────────────────────────────────
      // Per-row Delete: the trash-icon button with title="Delete document".
      // Its accessible name is "Delete document", which won't collide with
      // the DeleteConfirm dialog's button (whose accessible name is "Delete").
      // Click on the row containing 'to-be-deleted' to target that doc's
      // delete button — `.first()` of the matched row's children.
      await win.locator('button[title="Delete document"]').nth(1).click();

      // DeleteConfirm dialog: button with exact text "Delete" — unique on the
      // page when the dialog is open (per-row buttons name is "Delete document").
      await expect(win.getByText('Delete document?')).toBeVisible({ timeout: 4000 });
      await win.getByRole('button', { name: 'Delete', exact: true }).click();

      // Re-run happens via onDeleted (Workspace.tsx:1830). The deleted row's
      // sku is gone; the edited row remains.
      await expect(win.getByText('to-be-deleted')).not.toBeVisible({ timeout: 8000 });
      await expect(win.getByText('before-edit')).toBeVisible();
    });
  });
});

/**
 * T0.3 — Update fields ($set) mode in EditDrawer. Distinct from the Replace
 * scenario above: this proves the update only touches the field the user
 * typed, leaving other fields on the document untouched — the whole point
 * of exposing `doc:updateOne` instead of always full-document replace.
 */
test('doc writes: update ($set) changes one field and leaves the others untouched', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Update Target' },
        {
          dbName: 'shop',
          collection: 'orders',
          docs: [{ _id: 10, sku: 'multi-field', status: 'pending', qty: 5 }],
        },
      );
      await expectStatusDot(win, 'Update Target', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');

      await ws.queryBarRunButton.click();
      await expect(win.getByText('multi-field')).toBeVisible({ timeout: 8000 });

      // Per-row Edit button opens the EditDrawer.
      await win.locator('button[title="Edit document"]').first().click();
      await expect(win.getByText('Edit document')).toBeVisible({ timeout: 5000 });

      // Switch to Update fields ($set) mode.
      await win.getByRole('button', { name: /Update fields/i }).click();

      // The drawer's textarea is the last on the page (same convention as
      // the Replace scenario above).
      const updateTextarea = win.locator('textarea').last();
      await updateTextarea.fill('{"status": "shipped"}');

      await win.getByRole('button', { name: /^Apply update$/ }).click();

      // Drawer closes, run reruns automatically.
      await expect(win.getByText('shipped')).toBeVisible({ timeout: 8000 });

      // Load-bearing assertion: fields never mentioned in the patch survive
      // untouched — proof this is a $set patch, not a full-document rewrite.
      await expect(win.getByText('multi-field')).toBeVisible();
      await expect(win.getByText('5', { exact: true })).toBeVisible();
    });
  });
});
