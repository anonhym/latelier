import { test, expect, type Page } from '@playwright/test';
import { baseConnInput, startMemoryServer, stopAllMemoryServers, withApp } from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import { seedActiveConnectionWithDocs } from './helpers/uiSeed';
import { expectConsoleClean, expectStatusDot } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

/**
 * W05 §10's geometry, which only a real layout can show: the filter box keeps
 * its room, nothing in the row clips, the row keeps its height, and a
 * one-condition filter fits its field. The same window sizes as
 * `results-toolbar-no-clip.e2e.ts` (a window size is what the results pane's
 * width follows), then the pane's own width set directly, which is the input
 * the layout reads.
 */
const SIZES: Array<[number, number]> = [
  [900, 600],
  [960, 640],
  [1024, 768],
  [1100, 800],
  [1280, 800],
  [1440, 900],
];

// Around each step of `filterBarLayout`, and well inside every form.
const PANE_WIDTHS = [1500, 1200, 1178, 1177, 1170, 1090, 1078, 1077, 1070, 970, 964, 963, 955, 935, 925, 800, 790, 786, 785, 780, 600, 420];

const DOCS = Array.from({ length: 30 }, (_, n) => ({ n, status: n % 3 ? 'paid' : 'open', syndicateName: 'Le Condo-Fernand' }));
const ONE_CONDITION = '{"syndicateName":{"$eq":"Le Condo-Fernand"}}';

let seeded = 0;

async function open(win: Page) {
  const server = await startMemoryServer();
  const dbName = `filterbar${++seeded}`;
  await seedActiveConnectionWithDocs(
    win,
    { ...baseConnInput(server.host, server.port), name: 'FilterBar' },
    { dbName, collection: 'orders', docs: DOCS },
  );
  await expectStatusDot(win, 'FilterBar', 'connected');
  await new WorkspacePage(win).openCollectionFromNavigator(dbName, 'orders');
  await expect(win.getByTestId('result-bar')).toBeVisible({ timeout: 8000 });
}

/** Sets the query bar's own width, which is what the row's layout reads. */
async function setPaneWidth(win: Page, width: number) {
  await win.evaluate((w) => {
    const root = document.querySelector<HTMLElement>('[data-testid="filter-bar-row"]')!.parentElement!;
    root.style.width = `${w}px`;
    root.style.alignSelf = 'flex-start';
  }, width);
  await win.waitForTimeout(150);
}

interface RowReading {
  rowWidth: number;
  rowHeight: number;
  boxWidth: number;
  wrapped: boolean;
  overflow: number;
  clipped: string[];
  actionsLeft: Record<string, number>;
  folded: boolean;
}

function readRow(win: Page): Promise<RowReading> {
  return win.evaluate(() => {
    const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const row = q('filter-bar-row');
    const box = q('query-bar-filter-box');
    const actions = q('query-bar-actions');
    if (!row || !box || !actions) throw new Error('the filter bar row is not on screen');
    const rowRect = row.getBoundingClientRect();
    const clipped: string[] = [];
    for (const el of row.querySelectorAll<HTMLElement>('button')) {
      const r = el.getBoundingClientRect();
      const name = el.getAttribute('aria-label') ?? el.textContent ?? '';
      if (el.scrollWidth > el.clientWidth + 1 || r.right > rowRect.right + 1 || r.left < rowRect.left - 1 || r.width < 16) {
        clipped.push(name);
      }
    }
    const actionsLeft: Record<string, number> = {};
    for (const el of actions.querySelectorAll<HTMLElement>('button')) {
      actionsLeft[el.getAttribute('aria-label') ?? el.textContent ?? ''] = Math.round(el.getBoundingClientRect().left);
    }
    return {
      rowWidth: rowRect.width,
      rowHeight: Math.round(rowRect.height),
      boxWidth: box.getBoundingClientRect().width,
      // The controls sit under the field only in the last form.
      wrapped: actions.getBoundingClientRect().top >= box.getBoundingClientRect().bottom - 1,
      overflow: row.scrollWidth - row.clientWidth,
      clipped,
      actionsLeft,
      folded: q('query-bar-options-folded') !== null,
    };
  });
}

function expectRowWhole(read: RowReading, label: string) {
  expect(read.overflow, `${label}: row overflow`).toBeLessThanOrEqual(0);
  expect(read.clipped, `${label}: clipped`).toEqual([]);
  if (read.wrapped) {
    // The field takes its line whole; the controls have a 36px line of their own.
    expect(read.boxWidth, `${label}: wrapped field`).toBeGreaterThanOrEqual(read.rowWidth - 60);
    expect(read.rowHeight, `${label}: wrapped height`).toBe(44 + 36);
    return;
  }
  // 480 while a control can still collapse; the 320 floor once all have.
  const min = read.rowWidth >= 964 ? 480 : 320;
  expect(read.boxWidth, `${label}: filter box (row ${read.rowWidth})`).toBeGreaterThanOrEqual(min - 1);
  expect(read.rowHeight, `${label}: one line`).toBe(44);
}

test('the filter box meets its minimum and nothing in the row clips, at every window and pane width', async () => {
  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await expectConsoleClean(win, async () => {
      await open(win);
      for (const [width, height] of SIZES) {
        await win.setViewportSize({ width, height });
        await win.waitForTimeout(300);
        expectRowWhole(await readRow(win), `window ${width}`);
        // A refused Run has the widest label, which the budget is for.
        await win.getByTestId('query-bar-input').fill('{ bad:');
        await win.getByTestId('query-bar-input').press('ControlOrMeta+Enter');
        await expect(win.getByTestId('query-bar-strip')).toBeVisible();
        expectRowWhole(await readRow(win), `window ${width}, Run refusing`);
        await win.getByTestId('query-bar-input').fill('{}');
      }

      await win.setViewportSize({ width: 1920, height: 1000 });
      for (const width of PANE_WIDTHS) {
        await setPaneWidth(win, width);
        expectRowWhole(await readRow(win), `pane ${width}`);
        await win.getByTestId('query-bar-input').fill('{ bad:');
        await win.getByTestId('query-bar-input').press('ControlOrMeta+Enter');
        await expect(win.getByTestId('query-bar-strip')).toBeVisible();
        expectRowWhole(await readRow(win), `pane ${width}, Run refusing`);
        await win.getByTestId('query-bar-input').fill('{}');
      }
    });
  });
});

test('a one-condition filter fits its field on one line at a 1000px pane', async () => {
  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await expectConsoleClean(win, async () => {
      await open(win);
      await win.setViewportSize({ width: 1920, height: 1000 });
      await setPaneWidth(win, 1000);
      const input = win.getByTestId('query-bar-input');
      await input.fill(ONE_CONDITION);
      const read = await input.evaluate((el: HTMLTextAreaElement) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      }));
      expect(read.scrollWidth, 'no sideways overflow').toBeLessThanOrEqual(read.clientWidth);
      expect(read.scrollHeight, 'one line, no scrollbar').toBeLessThanOrEqual(read.clientHeight);
      const box = await win.getByTestId('query-bar-filter-box').boundingBox();
      expect(box!.height, 'the box keeps its 28px').toBe(28);
      // Empty or full, the field has a visible edge and fill.
      const style = await win.getByTestId('query-bar-filter-box').evaluate((el) => {
        const s = getComputedStyle(el);
        return { width: s.borderTopWidth, style: s.borderTopStyle, bg: s.backgroundColor, radius: s.borderTopLeftRadius };
      });
      expect(style.width).toBe('1px');
      expect(style.style).toBe('solid');
      expect(style.bg).not.toBe('rgba(0, 0, 0, 0)');
      expect(style.radius).toBe('6px');

      // The same edge and fill in the dark theme, from that theme's own tokens.
      await win.evaluate(() =>
        (window as unknown as { atelier: { prefs: { setTheme: (m: string) => Promise<void> } } }).atelier.prefs.setTheme('dark'),
      );
      await expect(win.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
      const dark = await win.getByTestId('query-bar-filter-box').evaluate((el) => {
        const s = getComputedStyle(el);
        return { width: s.borderTopWidth, style: s.borderTopStyle, bg: s.backgroundColor, border: s.borderTopColor };
      });
      expect(dark.width).toBe('1px');
      expect(dark.style).toBe('solid');
      expect(dark.bg).not.toBe('rgba(0, 0, 0, 0)');
      expect(dark.bg, 'the dark fill is its own').not.toBe(style.bg);
    });
  });
});

test('the form follows the width only: options, a hint and a run change no control', async () => {
  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await expectConsoleClean(win, async () => {
      await open(win);
      await win.setViewportSize({ width: 1920, height: 1000 });
      const workspace = new WorkspacePage(win);
      for (const width of [1500, 1000]) {
        await setPaneWidth(win, width);
        const before = await readRow(win);
        await workspace.openOption('sort');
        await workspace.queryBarSort.fill('{"n":-1}');
        await win.keyboard.press('Escape');
        await workspace.openOption('limit');
        await workspace.queryBarLimit.fill('5');
        await win.keyboard.press('Escape');
        await win.getByTestId('query-bar-input').fill(ONE_CONDITION);
        await win.getByTestId('query-run-btn').click();
        await expect(win.getByTestId('query-run-btn')).toBeEnabled({ timeout: 8000 });
        const after = await readRow(win);
        expect(after.folded, `${width}: options form`).toBe(before.folded);
        expect(after.wrapped, `${width}: wrapped`).toBe(before.wrapped);
        expect(after.actionsLeft, `${width}: a control moved`).toEqual(before.actionsLeft);
        expectRowWhole(after, `${width} with options set`);
        await workspace.openOption('sort');
        await workspace.queryBarSort.fill('');
        await win.keyboard.press('Escape');
        await workspace.openOption('limit');
        await workspace.queryBarLimit.fill('');
        await win.keyboard.press('Escape');
      }
    });
  });
});

test('long set options give way inside their group, never over the filter or the controls', async () => {
  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await expectConsoleClean(win, async () => {
      await open(win);
      await win.setViewportSize({ width: 1920, height: 1000 });
      const workspace = new WorkspacePage(win);
      // Wide enough for the unfolded group, so every set option is promoted to its own pill.
      await setPaneWidth(win, 1500);
      await workspace.openOption('sort');
      await workspace.queryBarSort.fill('{"aVeryLongFieldNameToSortBy":1,"anotherRatherLongFieldName":-1}');
      await win.keyboard.press('Escape');
      await workspace.openOption('limit');
      await workspace.queryBarLimit.fill('5');
      await win.keyboard.press('Escape');
      await workspace.openOption('hint', 'Hint');
      await win.getByTestId('query-bar-hint').fill('{"aVeryLongFieldNameToSortBy":1,"anotherRatherLongFieldName":-1}');
      await win.keyboard.press('Escape');
      await workspace.openOption('maxTimeMS', 'Max time');
      await win.getByTestId('query-bar-maxtime').fill('2500');
      await win.keyboard.press('Escape');
      await expect(win.getByTestId('option-pill-hint')).toBeVisible();

      // Every unfolded width, and the edge of the folded form.
      for (const width of [1500, 1200, 1170, 1090, 1078]) {
        await setPaneWidth(win, width);
        const read = await readRow(win);
        expect(read.folded, `${width}: unfolded`).toBe(false);
        expect(read.overflow, `${width}: row overflow`).toBeLessThanOrEqual(0);
        expect(read.boxWidth, `${width}: filter box`).toBeGreaterThanOrEqual(480 - 1);
        expect(read.rowHeight, `${width}: one line`).toBe(44);
        const spill = await win.evaluate(() => {
          const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!.getBoundingClientRect();
          const group = q('query-bar-options-group');
          return { overFilter: q('query-bar-filter-box').right - group.left, overActions: group.right - q('query-bar-actions').left };
        });
        expect(spill.overFilter, `${width}: group over the filter`).toBeLessThanOrEqual(0);
        expect(spill.overActions, `${width}: group over the controls`).toBeLessThanOrEqual(0);
      }
      // A label cut to an ellipsis keeps its whole text as the pill's tooltip.
      await expect(workspace.optionPill('sort')).toHaveAttribute('title', /aVeryLongFieldNameToSortBy/);

      // Tightest unfolded width with Run refusing (its widest label): pills past
      // the group's edge are still reachable — More stays whole and lists each
      // one, and one opened or focused scrolls into the group's view.
      await setPaneWidth(win, 1078);
      await win.getByTestId('query-bar-input').fill('{ bad:');
      await win.getByTestId('query-bar-input').press('ControlOrMeta+Enter');
      await expect(win.getByTestId('query-bar-strip')).toBeVisible();
      expect((await readRow(win)).clipped, 'More and the controls').toEqual([]);
      const names: Record<string, string> = { sort: 'Sort', project: 'Project', limit: 'Limit', hint: 'Hint', maxTimeMS: 'Max time' };
      for (const [key, name] of Object.entries(names)) {
        await workspace.queryBarMore.click();
        await expect(win.getByRole('menu').getByRole('menuitem', { name: new RegExp(`^${name}`) })).toBeVisible();
        const pill = workspace.optionPill(key);
        const label = (await pill.textContent()) ?? '';
        await win.keyboard.press('Escape');
        await pill.focus();
        const inView = await win.evaluate((k) => {
          const pillRect = document.querySelector<HTMLElement>(`[data-testid="option-pill-${k}"]`)!.getBoundingClientRect();
          const region = document.querySelector<HTMLElement>('[data-testid="query-bar-options-pills"]')!.getBoundingClientRect();
          return pillRect.left >= region.left - 1 && pillRect.right <= region.right + 1;
        }, key);
        expect(inView, `${key} (${label}) scrolls into view when focused`).toBe(true);
      }
      await win.getByTestId('query-bar-input').fill('{}');
    });
  });
});

// The sort editor's field suggestions open under its input, inside the editor's
// popover, whether the editor hangs from its own pill or from the folded one.
for (const [label, width] of [
  ['its own pill', 1500],
  ['the folded Options pill', 1000],
] as const) {
  test(`the sort editor's suggestions sit under its input (${label})`, async () => {
    await withApp(async (app) => {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      await expectConsoleClean(win, async () => {
        await open(win);
        await win.setViewportSize({ width: 1920, height: 1000 });
        await setPaneWidth(win, width);
        await new WorkspacePage(win).openOption('sort');
        const input = win.getByTestId('query-bar-sort');
        await input.click();
        await input.press('End');
        await input.pressSequentially('{"');
        const list = win.getByRole('listbox', { name: 'Field suggestions' });
        await expect(list).toBeVisible();
        await win.waitForTimeout(400);
        const inputBox = (await input.boundingBox())!;
        const listBox = (await list.boundingBox())!;
        const editor = (await win.locator('#query-bar-sort-label').locator('xpath=..').boundingBox())!;
        expect(listBox.x, `${label}: list left edge`).toBeGreaterThanOrEqual(editor.x - 1);
        expect(listBox.x, `${label}: list left edge`).toBeLessThanOrEqual(editor.x + editor.width);
        expect(Math.abs(listBox.x - inputBox.x), `${label}: under the input`).toBeLessThanOrEqual(2);
        expect(listBox.y, `${label}: below the input`).toBeGreaterThanOrEqual(inputBox.y + inputBox.height - 1);
      });
    });
  });
}
