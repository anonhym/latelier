import {
  baseConnInput,
  startMemoryServer,
  stopAllMemoryServers,
  withApp,
} from '../helpers/e2eApp';
import { test, expect } from '@playwright/test';
import { WorkspacePage } from './pages';
import { seedActiveConnectionWithDocs } from './helpers/uiSeed';
import { expectConsoleClean } from './helpers/uiAsserts';
import { contrastRatio, parseColor } from '../../src/theme/contrast';
import { decodePng } from './helpers/pngPixels';

test.afterAll(stopAllMemoryServers);

/**
 * X19 #83 — the #60 active-row outline (`outline: 2px solid
 * var(--atelier-accent)`, `outline-offset: -2px`) and the copy-confirmation
 * flash (`background: var(--atelier-accent)`, same colour) used to collide on
 * a row that is both active and mid-flash: TableView's outline is inset 2px
 * into the row, and TableCell's flash padding (4px/8px) covers that band, so
 * the outline vanished into its own colour (measured 1.00:1). The fix
 * (`backgroundClip: 'content-box'` on TableCell) keeps the flash off the
 * padding band the inset outline occupies, leaving the outline on the row's
 * plain surface behind it instead.
 *
 * Real Chromium only: jsdom has no paint, so a component test can guard the
 * *style* (`table-view.spec.tsx`) but not prove the two colours actually
 * separate on screen. This samples the rendered pixels.
 */
test('table copy flash keeps the active-row outline visible at WCAG 1.4.11 contrast (X19 #83)', async () => {
  test.setTimeout(120_000);
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Copy Flash Outline' },
        { dbName: 'shop', collection: 'orders', docs: [{ name: 'alpha' }, { name: 'beta' }] },
      );
      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');
      await ws.queryBarRunButton.click();
      await ws.viewTableButton.click();

      const grid = win.getByRole('grid', { name: 'Documents' });
      await expect(grid).toBeVisible({ timeout: 8000 });

      // #106 — the FIRST selection made in the app mounts a "1 selected" bar
      // above the grid and shifts everything below it mid-double-click.
      // Select row 0 first so that shift has already happened before we act
      // on row 1 below.
      await win
        .locator('#table-row-0')
        .getByTitle(/Drag to add "name/)
        .click({ position: { x: 12, y: 10 } });
      await win.waitForTimeout(300);

      const row = win.locator('#table-row-1');
      const cell = row.getByTitle(/Drag to add "name/);
      // The bar can mount/unmount again from the click above — re-measure
      // right before acting on it rather than reusing an earlier box.
      const cb = (await cell.boundingBox())!;

      // A double-click's first click already makes row 1 the active row (see
      // x19-roving-focus-keyboard.e2e.ts's "a real click does not trap
      // focus" case); the second click fires the copy. Landing near the
      // cell's left edge avoids the hover-affordance buttons docked at its
      // right.
      await cell.dblclick({ position: { x: 12, y: cb.height / 2 } });

      // Sample partway through the 600ms flash timeout (TableView's
      // `copyCell`), after its own 120ms background transition has settled.
      await win.waitForTimeout(250);

      // The test can't pass by having sampled the wrong moment: prove row 1
      // really is the active row, and its cell really is flashing, right
      // before the pixel sample below.
      await expect(grid).toHaveAttribute('aria-activedescendant', 'table-row-1');
      await expect(row).toHaveCSS('outline-style', 'solid');
      const [cellBgRaw, accentRaw] = await Promise.all([
        cell.evaluate((e) => getComputedStyle(e).backgroundColor),
        win.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--atelier-accent').trim(),
        ),
      ]);
      expect(parseColor(cellBgRaw)).toEqual(parseColor(accentRaw));

      const rb = (await row.boundingBox())!;
      const cb2 = (await cell.boundingBox())!;
      const scale = await win.evaluate(() => window.devicePixelRatio);
      const x = Math.round(cb2.x + 30);
      const y0 = Math.round(rb.y) - 6;

      const png = decodePng(await win.screenshot({ clip: { x, y: y0, width: 1, height: 20 } }));
      const pixelAt = (cssY: number) => png.pixel(0, Math.round(cssY * scale));
      // +1px is inside the row's 2px inset outline band (measured from the
      // row's top edge, offset by the 6px the clip above starts early);
      // +2.5px is just past it, over the row's plain surface.
      const band = pixelAt(6 + 1);
      const inside = pixelAt(6 + 2.5);

      expect(contrastRatio(band, inside)).toBeGreaterThanOrEqual(3);
    });
  });
});
