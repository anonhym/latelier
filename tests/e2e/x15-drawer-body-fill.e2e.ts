import { test, expect } from '@playwright/test';
import {
  baseConnInput,
  startMemoryServer,
  stopAllMemoryServers,
  withApp,
} from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import { seedActiveConnectionWithDocs } from './helpers/uiSeed';

test.afterAll(stopAllMemoryServers);

/**
 * X15 — the drawer body has to give its editor a flex context.
 *
 * This lives in e2e rather than alongside the other `EditDrawer` component
 * specs because jsdom does no layout: every `getBoundingClientRect()` there
 * returns zeroes, so the regression is invisible to the component suite by
 * construction. That is also how it shipped in the first place — an earlier revision migrated
 * the drawer onto Mantine, whose body is a plain padded block, the `flex: 1`
 * on the textarea lost the column it was resolving against, and every gate
 * stayed green while the editor quietly stopped filling the panel.
 *
 * Mutation: delete the `styles={{ content, body }}` block in `EditDrawer` and
 * the first assertion measures **6.75%** — the textarea collapses to its
 * intrinsic minimum, because `rows` went away with the same fix and there is
 * no flex context left to give it a height. (The shipped-but-broken build
 * measured 43%: no flex context, but a `rows={18}` floor propping it up.)
 * Re-adding a `rows` floor instead of the flex context fails the second
 * assertion, since an intrinsic height a flex item will not shrink below turns
 * a short window into a scrolling panel.
 */
test('the edit drawer\'s editor fills the panel and scrolls inside it', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await seedActiveConnectionWithDocs(
      win,
      { ...baseConnInput(host, port), name: 'Fill Check' },
      { dbName: 'shop', collection: 'orders', docs: [{ _id: 1, sku: 'widget', qty: 7 }] },
    );

    const ws = new WorkspacePage(win);
    await ws.openCollectionFromNavigator('shop', 'orders');
    await ws.queryBarRunButton.click();
    await expect(win.getByText('widget')).toBeVisible({ timeout: 8000 });

    await win.locator('button[title="Edit document"]').first().click();
    await expect(win.getByText('Edit document').first()).toBeVisible({ timeout: 5000 });

    const fillPct = await win.evaluate(() => {
      const panel = document.querySelector('[role="dialog"]') as HTMLElement;
      const ta = panel?.querySelector('textarea') as HTMLElement;
      if (!panel || !ta) return 0;
      return (ta.getBoundingClientRect().height / panel.getBoundingClientRect().height) * 100;
    });

    // The rest is real chrome — header, the two mode buttons, the button row.
    // 43% is what the unfixed build measured, so the threshold sits well clear
    // of it without pinning an exact pixel count.
    expect(fillPct).toBeGreaterThan(65);

    // A short window with a long document must scroll inside the editor rather
    // than growing the panel past the viewport and pushing Save out of reach.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(1280, 420);
    });
    await win.locator('[role="dialog"] textarea').fill(
      Array.from({ length: 60 }, (_, i) => `  "field_${i}": ${i},`).join('\n'),
    );

    await expect
      .poll(async () =>
        win.evaluate(() => {
          const panel = document.querySelector('[role="dialog"]') as HTMLElement;
          const ta = panel.querySelector('textarea') as HTMLElement;
          return {
            overflows: panel.getBoundingClientRect().height > window.innerHeight + 1,
            scrolls: ta.scrollHeight > ta.clientHeight,
          };
        }),
      )
      .toEqual({ overflows: false, scrolls: true });

    await expect(win.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });
});
