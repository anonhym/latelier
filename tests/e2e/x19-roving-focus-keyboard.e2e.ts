import {
  baseConnInput,
  startMemoryServer,
  stopAllMemoryServers,
  withApp,
} from '../helpers/e2eApp';
import { test, expect, type Page, type Locator } from '@playwright/test';
import { WorkspacePage } from './pages';
import { seedActiveConnectionWithDocs } from './helpers/uiSeed';
import { expectConsoleClean, expectStatusDot } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

// Default page size (`PAGE_SIZE_OPTIONS`/`DEFAULT_COLLECTION_TAB_STATE` in
// `workspaceTabs.ts`) is 50 — seeded exactly at that so the query's one page
// holds every doc without touching the LIMIT field, and the 1280x800 default
// window (`electron/main.ts`'s `DEFAULT_BOUNDS`) is nowhere near tall enough
// to mount all 50 24px rows plus `overscanCount={8}` either side. Confirmed
// below rather than assumed — the first assertion of the virtualization test
// IS "row 49 isn't mounted yet"; if that ever stopped being true (a taller
// default window, a shorter row), the test fails loudly there instead of
// silently proving nothing.
const DOC_COUNT = 50;

function orderDocs(): Array<{ seq: number }> {
  return Array.from({ length: DOC_COUNT }, (_, i) => ({ seq: i }));
}

/**
 * Presses Tab up to `maxPresses` times, stopping the instant `target` has
 * focus. Returns whether it got there, and (via `sawRoles`) every `role`
 * value focus passed through on the way — the second half of "exactly one
 * tab stop for the widget": if the grid were reachable but so was some row
 * along the way, this fails on `sawRoles` even though `reached` is true.
 */
async function tabUntilFocused(
  win: Page,
  target: Locator,
  maxPresses: number,
): Promise<{ reached: boolean; sawRoles: string[] }> {
  const sawRoles: string[] = [];
  for (let i = 0; i < maxPresses; i++) {
    const isTarget = await target.evaluate((el) => el === document.activeElement).catch(() => false);
    if (isTarget) return { reached: true, sawRoles };
    const role = await win.evaluate(() => document.activeElement?.getAttribute('role') ?? null);
    if (role) sawRoles.push(role);
    await win.keyboard.press('Tab');
  }
  const isTarget = await target.evaluate((el) => el === document.activeElement).catch(() => false);
  return { reached: isTarget, sawRoles };
}

/**
 * #20's roving-focus driver, driven with the keyboard alone against a real
 * Electron window and a real `mongodb-memory-server` — no `.click()` once
 * the grid itself is reached.
 *
 * The component suite (`table-view.spec.tsx`) already covers the
 * `aria-activedescendant` contract in isolation. What it cannot cover
 * honestly is virtualization: jsdom's `offsetWidth`/`offsetHeight` shim
 * (`tests/helpers/jsdomSetup.ts`) is sized so react-window renders the
 * *whole* list, which is exactly the condition #20 exists to handle
 * correctly when it's false. Only a real window has a real viewport height,
 * real `overscanCount` math, and a real `listRef.scrollToRow` — this test
 * seeds enough documents that some are provably unmounted at rest, then
 * proves the newly-active one is mounted and on-screen after moving to it.
 */
test('table roving focus: keyboard-only navigation, including a row virtualization forces unmounted', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Roving Focus Target' },
        { dbName: 'shop', collection: 'orders', docs: orderDocs() },
      );
      await expectStatusDot(win, 'Roving Focus Target', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');
      // Setup only — running the query and switching view are not the
      // feature under test, so a click here doesn't undercut "keyboard-only"
      // below, matching `conn-switcher-keyboard.e2e.ts`'s own convention of
      // clicking to reach the widget, then going keyboard-only once there.
      await ws.queryBarRunButton.click();
      await ws.viewTableButton.click();

      const grid = win.getByRole('grid', { name: 'Documents' });
      await expect(grid).toBeVisible({ timeout: 8000 });

      const row = (i: number) => win.locator(`#table-row-${i}`);
      // Confirms the query actually returned and rendered rows before the
      // "row 49 isn't mounted" premise below is asserted — otherwise that
      // assertion would trivially pass against an empty, not-yet-loaded grid.
      await expect(row(0)).toBeVisible({ timeout: 8000 });

      // 1. The grid is reachable by Tab, and nothing with role="row" ever
      // takes focus along the way — exactly one tab stop for the widget.
      const { reached, sawRoles } = await tabUntilFocused(win, grid, 60);
      expect(reached).toBe(true);
      expect(sawRoles).not.toContain('row');
      await expect(grid).toBeFocused();
      await expect(grid).toHaveAttribute('aria-activedescendant', 'table-row-0');

      // Confirm the premise the virtualization assertion below depends on,
      // rather than assuming it: with 50 docs seeded, the last row must NOT
      // be mounted at rest. If this fails, the window/row-height math this
      // file's docs comment above relies on no longer holds — DOC_COUNT (or
      // the window size) needs revisiting, not the assertion below deleted.
      await expect(row(DOC_COUNT - 1)).toHaveCount(0);

      // 2. ArrowDown moves the active descendant one row at a time.
      await win.keyboard.press('ArrowDown');
      await expect(grid).toHaveAttribute('aria-activedescendant', 'table-row-1');
      await win.keyboard.press('ArrowUp');
      await expect(grid).toHaveAttribute('aria-activedescendant', 'table-row-0');

      // 3. End jumps to the last row — the virtualization case. The row
      // must exist in the DOM (react-window actually scrolled to mount it,
      // not just moved an index that names nothing) — a dropped or
      // made-async `scrollToRow` call would leave it absent instead.
      //
      // KNOWN GAP (found by this test, not asserted here): on THIS first
      // jump — 47 intervening rows have never been rendered, so
      // `useDynamicRowHeight` (TableView.tsx) still has each of them at its
      // 24px default estimate — `scrollToRow({index: 49, align: 'auto'})`
      // computes its target offset from those estimates and the row lands
      // ~17px past the bottom of the window (confirmed via
      // getBoundingClientRect: row bottom 842 vs. a 800px-tall window),
      // clipped more than half off-screen. A second `scrollToRow` to the
      // same row (after the first pass has measured everything in between)
      // lands it flush with the bottom instead. `Home` below, jumping back
      // to row 0 — already measured during initial render — does not hit
      // this, which is why its `toBeInViewport` assertion holds. Not fixed
      // here: out of this ticket's file scope (`useRovingFocus.ts`/
      // `TableView.tsx`) and reported instead.
      await win.keyboard.press('End');
      await expect(grid).toHaveAttribute('aria-activedescendant', `table-row-${DOC_COUNT - 1}`);
      await expect(row(DOC_COUNT - 1)).toBeVisible({ timeout: 5000 });

      // Home jumps back to the first row, scrolling it back into view too —
      // and, unlike End above, row 0 was already measured, so this is the
      // clean case: fully mounted AND fully back on-screen.
      await win.keyboard.press('Home');
      await expect(grid).toHaveAttribute('aria-activedescendant', 'table-row-0');
      await expect(row(0)).toBeInViewport();

      // 4. Enter on the grid itself selects the active row (`aria-selected`
      // on the row itself) — no click, no per-row focus, just the
      // container's own key handling acting on whichever row is active.
      await win.keyboard.press('ArrowDown');
      await win.keyboard.press('Enter');
      await expect(row(1)).toHaveAttribute('aria-selected', 'true');
      await expect(row(0)).toHaveAttribute('aria-selected', 'false');
    });
  });
});

/**
 * Found in review, and only a real browser exposes it honestly: a `<div
 * tabIndex={-1}>` is excluded from *sequential* (Tab) focus per the HTML
 * focusing-steps algorithm, but is still click-focusable — jsdom's
 * `fireEvent.click` (used throughout the component suite) does no focus
 * management at all, so 48 passing component tests never caught a real
 * click leaving DOM focus on the row itself. From there every later
 * keydown reached the grid's `onKeyDown` with `e.target` = the row, not the
 * grid, and its own-target guard swallowed Arrow/Home/End until focus moved
 * again by hand. Playwright's `.click()` drives Chromium's actual focusing
 * steps, so this is the one place that regression can be caught for real.
 */
test('table roving focus: a real click does not trap focus on the row — ArrowDown still moves the grid afterward', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Click Focus Target' },
        { dbName: 'shop', collection: 'orders', docs: orderDocs() },
      );
      await expectStatusDot(win, 'Click Focus Target', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');
      await ws.queryBarRunButton.click();
      await ws.viewTableButton.click();

      const grid = win.getByRole('grid', { name: 'Documents' });
      const row = (i: number) => win.locator(`#table-row-${i}`);
      await expect(row(0)).toBeVisible({ timeout: 8000 });

      // The click also makes row 1 the active row — not just clickable —
      // so the very next Arrow continues from there, not from row 0.
      await row(1).click();
      await expect(grid).toHaveAttribute('aria-activedescendant', 'table-row-1');

      await win.keyboard.press('ArrowDown');
      await expect(grid).toBeFocused();
      await expect(grid).toHaveAttribute('aria-activedescendant', 'table-row-2');
    });
  });
});
