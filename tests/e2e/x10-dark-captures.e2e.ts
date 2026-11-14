import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  baseConnInput,
  startMemoryServer,
  stopAllMemoryServers,
  withApp,
} from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import { NewConnectionPage } from './pages/NewConnectionPage';
import { seedActiveConnectionWithDocs, seedConnection } from './helpers/uiSeed';
import { expectConsoleClean, expectStatusDot } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

/**
 * X10 dark theme pass: one dark capture per surface on the amendment's list.
 * Each capture asserts the scheme attribute, then the three stepped tones by
 * computed style: the canvas (`<body>` on --atelier-bg), a panel on
 * --atelier-surface, and the raised tone --atelier-surface-raised, which must
 * be a third, lighter step. The token values are read off the page through a
 * probe element, so the spec follows src/index.css instead of copying hex.
 */

const MAC = process.platform === 'darwin';

async function setDark(win: Page): Promise<void> {
  await win.evaluate(() =>
    (window as unknown as { atelier: { prefs: { setTheme: (m: string) => Promise<void> } } }).atelier.prefs.setTheme('dark'),
  );
  await expect(win.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
}

/** Computed `background-color` of a token, resolved through a throwaway element. */
function tokenColour(win: Page, token: string): Promise<string> {
  return win.evaluate((t) => {
    const probe = document.createElement('div');
    probe.style.background = `var(${t})`;
    document.body.appendChild(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  }, token);
}

const luminance = (rgb: string): number => {
  const [r, g, b] = rgb.match(/\d+/g)!.map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * The shared assertion of every capture. `panel` is a panel on this surface
 * that is drawn on --atelier-surface; `raised`, when the surface has one, is
 * drawn on --atelier-surface-raised.
 */
async function expectDarkTones(
  win: Page,
  surface: string,
  opts: { panel?: Locator; raised?: Locator } = {},
): Promise<void> {
  await expect(win.locator('html'), surface).toHaveAttribute('data-mantine-color-scheme', 'dark');
  const bg = await tokenColour(win, '--atelier-bg');
  const surfaceTone = await tokenColour(win, '--atelier-surface');
  const raised = await tokenColour(win, '--atelier-surface-raised');
  expect(luminance(bg), `${surface}: canvas darker than panel`).toBeLessThan(luminance(surfaceTone));
  expect(luminance(surfaceTone), `${surface}: panel darker than raised`).toBeLessThan(luminance(raised));
  const body = await win.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(body, `${surface}: <body> paints the canvas tone`).toBe(bg);
  if (opts.panel) {
    await expect(opts.panel.first(), surface).toHaveCSS('background-color', surfaceTone);
  }
  if (opts.raised) {
    await expect(opts.raised.first(), surface).toHaveCSS('background-color', raised);
  }
}

test('dark captures: welcome canvas, connection form, palette (no Connection)', async () => {
  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await expectConsoleClean(win, async () => {
      const ws = new WorkspacePage(win);
      await ws.switcher.waitWelcome();
      await setDark(win);

      await expect(win.getByTestId('welcome-canvas')).toHaveCSS('background-color', await tokenColour(win, '--atelier-bg'));
      await expectDarkTones(win, 'welcome canvas');

      // The global shortcut ignores a keypress made in a text field off macOS, and the
      // first one after a cold launch can be lost (as in f04): release the field, and press
      // again only while the palette is closed.
      await ws.switcher.welcomeField.blur();
      const search = win.locator('input[aria-label="Search commands"]');
      const palette = win.getByRole('dialog').filter({ has: search });
      await expect(async () => {
        if (!(await palette.isVisible())) await win.keyboard.press(MAC ? 'Meta+K' : 'Control+K');
        await expect(palette).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 8000 });
      await expectDarkTones(win, 'palette', { panel: palette });
      await win.keyboard.press('Escape');
      await expect(search).toHaveCount(0);

      await win.getByRole('button', { name: 'Enter details manually' }).click();
      const form = new NewConnectionPage(win);
      await expect(form.saveButton).toBeVisible({ timeout: 5000 });
      await expectDarkTones(win, 'connection form');
    });
  });
});

test('dark captures: Switcher, Connections table (Connection, no tab)', async () => {
  const { host, port } = await startMemoryServer();
  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await expectConsoleClean(win, async () => {
      const ws = new WorkspacePage(win);
      await seedConnection(win, { ...baseConnInput(host, port), name: 'Dark Alpha' });
      await seedConnection(win, { ...baseConnInput(host, port), name: 'Dark Beta' });
      await setDark(win);

      await ws.switcher.waitVisible();
      await expect(ws.switcher.item('Dark Beta')).toBeVisible({ timeout: 8000 });
      await expectDarkTones(win, 'Switcher', { raised: win.locator('.mantine-Popover-dropdown').filter({ has: ws.switcher.listbox }) });

      await ws.switcher.openExpandedTable();
      await expect(ws.switcher.expandedTableRow('Dark Beta')).toBeVisible();
      await expectDarkTones(win, 'Connections table', { panel: ws.switcher.expandedTableDialog });
    });
  });
});

test('dark captures: Documents (Table, Tree, JSON), stale result and error strip, Inspector, Aggregation, Schema & indexes, script tab, status bar', async () => {
  const { host, port } = await startMemoryServer();
  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await expectConsoleClean(win, async () => {
      await setDark(win);
      const conn = await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Dark Target' },
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
      await expectStatusDot(win, 'Dark Target', 'connected');

      const ws = new WorkspacePage(win);
      const statusBar = win.getByTestId('status-bar');
      await ws.openCollectionFromNavigator('shop', 'orders');
      await expect(win.getByText('banana-002')).toBeVisible({ timeout: 8000 });

      // Documents in each of the three result views, and the status bar.
      await expectDarkTones(win, 'Documents, Table', { panel: ws.navigator });
      await expectDarkTones(win, 'status bar', { panel: statusBar });
      await ws.viewTreeButton.click();
      await expectDarkTones(win, 'Documents, Tree', { panel: ws.navigator });
      await ws.viewJsonButton.click();
      await expectDarkTones(win, 'Documents, JSON', { panel: ws.navigator });
      await ws.viewTableButton.click();

      // A refused filter: the stale band and the Filter Bar error strip.
      await ws.queryBarTextarea.fill('{status: /^pa/gi}');
      await ws.queryBarTextarea.blur();
      await expect(win.getByTestId('band-stale')).toBeVisible();
      await expectDarkTones(win, 'stale result', { panel: statusBar });
      await expect(win.locator('#query-bar-filter-error')).toBeVisible();
      await expectDarkTones(win, 'Filter Bar error strip', { panel: ws.navigator });
      // The rows on screen stay the previous query's until a run replaces them.
      await ws.queryBarTextarea.fill('{status: "paid"}');
      await ws.queryBarTextarea.blur();
      await ws.queryBarRunButton.click();
      await expect(win.getByTestId('band-stale')).toHaveCount(0);

      // Document Editor in its conflict state: the server copy changes under an open edit.
      // The Table's row actions are covered by a cell until hovered; the Tree's are not.
      await ws.viewTreeButton.click();
      await win.getByRole('button', { name: /^Edit document/ }).first().click();
      const editor = win.getByRole('dialog', { name: 'Edit document' });
      await expect(editor).toBeVisible({ timeout: 5000 });
      await editor.getByRole('textbox', { name: 'status' }).fill('shipped');
      await win.evaluate(
        (id) =>
          (window as unknown as { atelier: { doc: { updateOne: (i: object) => Promise<unknown> } } }).atelier.doc.updateOne({
            connectionId: id,
            dbName: 'shop',
            collection: 'orders',
            filterJson: '{"sku":"apple-001"}',
            updateJson: '{"$set":{"status":"refunded"}}',
          }),
        conn.id,
      );
      await editor.getByRole('button', { name: 'Save' }).click();
      await expect(editor.getByRole('region', { name: 'Conflicting changes' })).toBeVisible({ timeout: 8000 });
      await expectDarkTones(win, 'Document Editor, conflict', { panel: editor });
      await editor.getByRole('button', { name: 'Cancel' }).click();
      await win.getByRole('button', { name: 'Discard', exact: true }).click();
      await expect(editor).toBeHidden();
      await ws.viewTableButton.click();

      // Inspector (the Plan tab).
      await ws.queryBarRunOptionsButton.click();
      await win.getByRole('menuitem', { name: 'Explain plan' }).click();
      const inspector = win.getByTestId('inspector');
      await expect(inspector).toBeVisible({ timeout: 8000 });
      await expectDarkTones(win, 'Inspector', { panel: inspector });
      await inspector.getByRole('button', { name: 'Close inspector' }).click();
      await expect(inspector).toBeHidden();

      // Aggregation, then Schema & indexes.
      await ws.tablist.getByRole('tab', { name: /Aggregation/ }).click();
      await expect(win.getByText('Add a first stage')).toBeVisible({ timeout: 5000 });
      await expectDarkTones(win, 'Aggregation', { panel: ws.navigator });
      await ws.tablist.getByRole('tab', { name: /Schema & indexes/ }).click();
      await expect(win.getByRole('tab', { name: /Schema & indexes/ })).toHaveAttribute('aria-selected', 'true');
      await expectDarkTones(win, 'Schema & indexes', { panel: ws.navigator });

      // A script tab.
      await ws.openNewScript();
      await expect(win.getByTestId('script-run-btn')).toBeVisible({ timeout: 8000 });
      await expectDarkTones(win, 'script tab', { panel: statusBar });

      // Console (the Mongo shell pane).
      await win.getByRole('button', { name: 'Console', exact: true }).click();
      const shellInput = win.locator('input[aria-label="Mongo shell input"]');
      await expect(shellInput).toBeVisible({ timeout: 10000 });
      await expectDarkTones(win, 'Console', { panel: win.getByTestId('mongo-shell-pane') });
    });
  });
});
