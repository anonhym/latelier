import { test, expect, type Page } from '@playwright/test';
import { MongoClient } from 'mongodb';
import {
  baseConnInput,
  startMemoryServer,
  stopAllMemoryServers,
  withApp,
} from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import { seedActiveConnectionWithDocs, seedDocuments } from './helpers/uiSeed';
import { expectConsoleClean } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

/**
 * #91 — a confirm/submit button inside a dialog (Modal or Drawer) that goes
 * real-`disabled` on activation gets blurred to `<body>` by Chromium a beat
 * later (`disabled={... || submitting}` was the shape every one of these
 * dialogs shared) — see the timing note below. On a failure that leaves the
 * dialog open — the server rejects the action — nothing ever restored
 * focus: `catch` only sets the error, and `finally` re-enables the button
 * without touching focus.
 *
 * jsdom does not implement this blur at all, so no component test can see
 * it (`SubmitButton.spec.tsx`'s jsdom assertions cover the *guard*, not the
 * focus). This needs a real window.
 *
 * The fix (`SubmitButton`, `src/components/SubmitButton.tsx`) keeps the
 * button real-enabled throughout and fakes the disabled look with
 * `data-disabled`/`aria-disabled`, so it's never a candidate for the blur.
 *
 * Why a `failCommand` failpoint: measured directly (two probes, not
 * assumed) — against a `mongodb-memory-server` fast enough to fail the
 * request in well under 10ms, the unfixed code (real `disabled`) still
 * PASSED this test outright, because the blur isn't synchronous with the
 * `disabled` attribute: a button read `disabled` and still focused right
 * after the change AND on the next animation frame, and only showed
 * `<body>` focused roughly 50ms later. A disabled window shorter than that
 * never reaches the blur at all. `blockConnection` + `blockTimeMS` holds
 * the request open long enough for the blur to actually happen, while the
 * real duplicate-name error still arrives once the block lifts — this
 * delays the failure, it doesn't simulate one.
 *
 * `getByRole(..., { name: 'Rename' })` is unusable for an *in-flight* check
 * here — measured, not assumed: while the button reads "Renaming…" its
 * accessible name no longer satisfies that locator, so any Playwright action
 * against it (even `.evaluate()`) blocks and auto-retries until the request
 * finishes and the label reverts to "Rename". That silently absorbed the
 * whole `blockTimeMS` window in an earlier version of this test. The elapsed
 * time between the click and the (delayed) alert is what proves the
 * in-flight window was actually reached, without depending on the button's
 * transient label.
 */

async function withRenameBlocked(
  host: string,
  port: number,
  blockTimeMS: number,
  fn: () => Promise<void>,
): Promise<void> {
  await withFailpoint(host, port, 'renameCollection', blockTimeMS, fn);
}

async function withCreateBlocked(
  host: string,
  port: number,
  blockTimeMS: number,
  fn: () => Promise<void>,
): Promise<void> {
  // Not 'create': `CollectionAdminService.create` pre-checks existence with
  // `listCollections` and throws CONFLICT from that, without ever issuing
  // the `create` command for a duplicate name (see the comment in
  // `CollectionAdminService.ts` — probed against real mongodb behavior,
  // where `createCollection` on a duplicate with identical options silently
  // no-ops instead of erroring). `listCollections` is the command that
  // actually runs on this path.
  await withFailpoint(host, port, 'listCollections', blockTimeMS, fn);
}

async function withFailpoint(
  host: string,
  port: number,
  command: string,
  blockTimeMS: number,
  fn: () => Promise<void>,
): Promise<void> {
  const client = new MongoClient(`mongodb://${host}:${port}`);
  await client.connect();
  try {
    await client.db('admin').command({
      configureFailPoint: 'failCommand',
      mode: { times: 1 },
      data: { failCommands: [command], blockConnection: true, blockTimeMS },
    });
    await fn();
  } finally {
    await client
      .db('admin')
      .command({ configureFailPoint: 'failCommand', mode: 'off' })
      .catch(() => {});
    await client.close();
  }
}

/** Presses Tab and asserts whatever now has focus is still a descendant of
 * `dialog` — the FocusTrap guarantee this repo's dialogs already provide,
 * checked here as a sibling fact to the button staying focused above. */
async function expectFocusStaysInDialog(win: Page, dialog: ReturnType<Page['getByRole']>) {
  await win.keyboard.press('Tab');
  await expect(dialog.locator(':focus')).toBeVisible();
}

test('a failed rename keeps focus on the Rename button, and Tab stays inside the dialog', async () => {
  test.setTimeout(120_000);
  const { host, port } = await startMemoryServer({
    instance: { args: ['--setParameter', 'enableTestCommands=1'] },
  });

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      const conn = await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'P91 Rename' },
        { dbName: 'shop', collection: 'placeholder', docs: [{ _id: 1 }] },
      );
      // A second collection already named "orders" — renaming "placeholder"
      // onto it is what the server rejects.
      await seedDocuments(win, {
        connectionId: conn.id,
        dbName: 'shop',
        collection: 'orders',
        docs: [{ _id: 1 }],
      });

      const ws = new WorkspacePage(win);
      await ws.waitForDb('shop');
      await ws.dbRow('shop').click();
      await expect(ws.collectionRow('shop', 'placeholder')).toBeVisible({ timeout: 5000 });

      await ws.collectionRow('shop', 'placeholder').click({ button: 'right' });
      await win.getByRole('menuitem', { name: 'Rename collection' }).click();

      const dlg = win.getByRole('dialog', { name: /Rename "placeholder"/ });
      await expect(dlg).toBeVisible({ timeout: 3000 });

      const renameButton = dlg.getByRole('button', { name: 'Rename' });
      await dlg.getByLabel('New name').fill('orders');

      await withRenameBlocked(host, port, 700, async () => {
        const clickedAt = Date.now();
        await renameButton.click();

        await expect(dlg.getByRole('alert')).toBeVisible({ timeout: 10_000 });
        // The failpoint holds the request for 700ms — a fast completion
        // here means the block didn't actually apply, and the rest of this
        // test would be exercising a request that never went in-flight.
        expect(Date.now() - clickedAt).toBeGreaterThan(400);

        // A positive read — "this button is focused" — not "focus is not
        // <body>". It is sound because of when it runs: the alert shows at
        // least 700ms after the click, long after the blur (~50ms) would have
        // landed, and on the unfixed code nothing ever puts focus back.
        await expect(renameButton).toBeFocused();
        await expectFocusStaysInDialog(win, dlg);
      });
    });
  });
});

test('a failed collection create keeps focus on the Create button, and Tab stays inside the drawer', async () => {
  test.setTimeout(120_000);
  const { host, port } = await startMemoryServer({
    instance: { args: ['--setParameter', 'enableTestCommands=1'] },
  });

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      // "orders" already exists — creating it again is what the server
      // rejects (ConflictError, `CollectionAdminService.ts`).
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'P91 Create' },
        { dbName: 'shop', collection: 'orders', docs: [{ _id: 1 }] },
      );

      const ws = new WorkspacePage(win);
      await ws.waitForDb('shop');
      await ws.dbRow('shop').click();
      await expect(ws.collectionRow('shop', 'orders')).toBeVisible({ timeout: 5000 });

      await ws.dbRow('shop').click({ button: 'right' });
      await win.getByRole('menuitem', { name: 'Create collection' }).click();

      const drawer = win.getByRole('dialog', { name: /New collection/ });
      await expect(drawer).toBeVisible({ timeout: 3000 });

      const createButton = drawer.getByRole('button', { name: 'Create collection' });
      await drawer.getByLabel('Collection name').fill('orders');

      await withCreateBlocked(host, port, 700, async () => {
        const clickedAt = Date.now();
        await createButton.click();

        await expect(drawer.getByRole('alert')).toBeVisible({ timeout: 10_000 });
        expect(Date.now() - clickedAt).toBeGreaterThan(400);

        await expect(createButton).toBeFocused();
        await expectFocusStaysInDialog(win, drawer);
      });
    });
  });
});
