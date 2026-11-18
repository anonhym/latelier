import { test, expect, type Locator, type Page } from '@playwright/test';
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
 * A condition row at the drawer's default width left the value box a few
 * characters wide: the mongosh preview sat beside it and took the room the
 * box and its error message needed, and the field box had no floor at all.
 *
 * This has to be an e2e. jsdom has no layout engine, so a component test
 * cannot tell a 30px input from a 300px one.
 */
const MIN_VALUE_WIDTH = 140;
const MIN_FIELD_WIDTH = 96;

async function width(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  expect(box, 'element has a layout box').not.toBeNull();
  return box!.width;
}

/**
 * Fills the `index`th condition row (document order) with an ObjectId that
 * is not one, so the row shows its value error, and measures the row.
 */
async function fillAndMeasure(win: Page, index: number) {
  await win.getByPlaceholder('field', { exact: true }).nth(index).fill(`o${index}`);
  await win.getByRole('button', { name: /^Value type: / }).nth(index).click();
  await win.getByRole('menuitem', { name: 'objectid', exact: true }).click();
  const value = win.getByPlaceholder('value', { exact: true }).nth(index);
  await value.fill('zzz');

  const describedBy = await value.getAttribute('aria-describedby');
  expect(describedBy, 'the invalid value is described on its input').toBeTruthy();
  const error = win.locator(`[id="${describedBy}"]`);
  await expect(error).toHaveText('ObjectId must be 24 hex characters');

  const valueWidth = await width(value);
  expect(valueWidth).toBeGreaterThanOrEqual(MIN_VALUE_WIDTH);
  expect(await width(error)).toBeGreaterThanOrEqual(valueWidth);
  expect(await width(win.getByPlaceholder('field', { exact: true }).nth(index))).toBeGreaterThanOrEqual(MIN_FIELD_WIDTH);
}

test('a condition row keeps its value box, error and field box usable at the default drawer width, nested or not', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await seedActiveConnectionWithDocs(
      win,
      { ...baseConnInput(host, port), name: 'Row Width Target' },
      { dbName: 'shop', collection: 'orders', docs: [{ name: 'doc-1' }] },
    );

    const ws = new WorkspacePage(win);
    await ws.openCollectionFromNavigator('shop', 'orders');
    await expect(win.getByText('doc-1')).toBeVisible({ timeout: 8000 });

    await ws.openBuilder();
    await win.getByRole('button', { name: 'Add condition', exact: true }).click();
    await fillAndMeasure(win, 0);

    await win.getByRole('button', { name: 'More ways to add', exact: true }).click();
    await win.getByRole('menuitem', { name: 'Add group', exact: true }).click();
    await win.getByRole('button', { name: 'Add condition to group 2', exact: true }).click();
    await fillAndMeasure(win, 1);
  });
});

/** Drags the Inspector's divider until the panel is about `target` px wide (it clamps at 320 and 640). */
async function resizePanel(win: Page, target: number) {
  const handle = win.getByRole('separator', { name: 'Resize inspector' });
  const box = await handle.boundingBox();
  expect(box, 'the divider has a layout box').not.toBeNull();
  const y = box!.y + 100;
  await win.mouse.move(box!.x + 2, y);
  await win.mouse.down();
  await win.mouse.move(1600 - target, y, { steps: 15 });
  await win.mouse.up();
  await win.waitForTimeout(300);
}

const rect = async (locator: Locator) => {
  const box = await locator.boundingBox();
  expect(box, 'element has a layout box').not.toBeNull();
  return box!;
};

test('a condition row is two lines at a 400px panel, keeps its height while a long value is typed, and is one line at 640px', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.setViewportSize({ width: 1600, height: 900 });

    await seedActiveConnectionWithDocs(
      win,
      { ...baseConnInput(host, port), name: 'Row Height Target' },
      { dbName: 'shop', collection: 'orders', docs: [{ name: 'doc-1' }] },
    );

    const ws = new WorkspacePage(win);
    await ws.openCollectionFromNavigator('shop', 'orders');
    await expect(win.getByText('doc-1')).toBeVisible({ timeout: 8000 });
    await ws.openBuilder();
    await win.getByRole('button', { name: 'Add condition', exact: true }).click();
    await win.getByPlaceholder('field', { exact: true }).fill('name');

    await resizePanel(win, 400);
    const row = win.locator('[data-row-path]').first();
    const value = win.getByPlaceholder('value', { exact: true });
    await value.fill('alice');
    const oneLine = await rect(row);
    expect(oneLine.height, 'two lines: field row and value box').toBeLessThanOrEqual(80);

    // The value box sits under the field row, aligned with the field's left edge.
    const field = await rect(win.getByPlaceholder('field', { exact: true }));
    const operator = await rect(win.getByPlaceholder('$op', { exact: true }));
    const boxRect = await rect(row.locator('[data-value-box]'));
    expect(boxRect.y).toBeGreaterThan(field.y + field.height - 1);
    expect(Math.abs(boxRect.x - field.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(boxRect.x + boxRect.width - (operator.x + operator.width))).toBeLessThanOrEqual(1);

    await value.fill('a rather long value that is far wider than the box can show on one line '.repeat(3));
    const typed = await rect(row);
    expect(typed.height, 'typing never changes the row shape').toBeCloseTo(oneLine.height, 0);

    await resizePanel(win, 700);
    await expect.poll(async () => (await rect(win.getByPlaceholder('field', { exact: true }))).y, { timeout: 4000 })
      .toBeGreaterThan(0);
    const wideOperator = await rect(win.getByPlaceholder('$op', { exact: true }));
    const wideBox = await rect(row.locator('[data-value-box]'));
    expect(
      Math.abs(wideBox.y + wideBox.height / 2 - (wideOperator.y + wideOperator.height / 2)),
      'the value box shares the operator line',
    ).toBeLessThanOrEqual(2);
    expect(wideBox.x).toBeGreaterThan(wideOperator.x);
  });
});

test('the value box moves beside the operator from a 560px panel, not before', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.setViewportSize({ width: 1600, height: 900 });
    await seedActiveConnectionWithDocs(
      win,
      { ...baseConnInput(host, port), name: 'Switch Point Target' },
      { dbName: 'shop', collection: 'orders', docs: [{ name: 'doc-1' }] },
    );
    const ws = new WorkspacePage(win);
    await ws.openCollectionFromNavigator('shop', 'orders');
    await expect(win.getByText('doc-1')).toBeVisible({ timeout: 8000 });
    await ws.openBuilder();
    await win.getByRole('button', { name: 'Add condition', exact: true }).click();
    await win.getByPlaceholder('field', { exact: true }).fill('name');

    const panelWidth = () =>
      win.getByTestId('inspector').evaluate((el) => el.getBoundingClientRect().width);
    const besideOperator = async () => {
      const op = await rect(win.getByPlaceholder('$op', { exact: true }));
      const box = await rect(win.locator('[data-value-box]').first());
      return box.y < op.y + op.height;
    };

    // Drags until the panel is within a pixel of `target`.
    const settle = async (target: number) => {
      await resizePanel(win, target);
      for (let i = 0; i < 4 && Math.abs((await panelWidth()) - target) > 1; i++) {
        await resizePanel(win, target + (target - (await panelWidth())));
      }
      return panelWidth();
    };

    const at560 = await settle(561);
    expect(at560).toBeGreaterThanOrEqual(560);
    expect(await besideOperator()).toBe(true);

    const at550 = await settle(550);
    expect(at550).toBeLessThan(560);
    expect(await besideOperator()).toBe(false);
  });
});

test('boolean and $exists rows stay inside a 320px Inspector, at the root and nested two groups deep', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.setViewportSize({ width: 1600, height: 900 });
    await seedActiveConnectionWithDocs(
      win,
      { ...baseConnInput(host, port), name: 'Narrow Switch Target' },
      { dbName: 'shop', collection: 'orders', docs: [{ name: 'doc-1' }] },
    );
    const ws = new WorkspacePage(win);
    await ws.openCollectionFromNavigator('shop', 'orders');
    await expect(win.getByText('doc-1')).toBeVisible({ timeout: 8000 });
    await ws.openBuilder();
    await resizePanel(win, 320);

    const filter =
      '{"$and":[{"a":{"$exists":true}},{"b":{"$eq":true}},' +
      '{"$or":[{"c":{"$exists":false}},{"d":{"$eq":false}},' +
      '{"$and":[{"e":{"$exists":true}},{"f":{"$eq":true}}]}]}]}';
    await win.getByTestId('query-bar-input').fill(filter);
    await expect(win.getByPlaceholder('field', { exact: true })).toHaveCount(6);

    const panel = await rect(win.getByTestId('inspector'));
    expect(panel.width).toBeLessThan(330);
    const rows = win.locator('[data-row-path]');
    for (let i = 0; i < 6; i++) {
      const row = rows.nth(i);
      const fits = await row.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
      expect(fits, `row ${i} does not overflow its container`).toBe(true);
      const menu = await rect(row.getByRole('button', { name: /^Condition options / }));
      expect(menu.x + menu.width, `row ${i} menu inside the panel`).toBeLessThanOrEqual(panel.x + panel.width + 0.5);
      const toggle = await rect(row.getByRole('radiogroup', { name: 'Value' }));
      const field = await rect(row.getByPlaceholder('field', { exact: true }));
      if (i >= 2) expect(toggle.y, `row ${i} switch dropped under line 1`).toBeGreaterThan(field.y + field.height - 1);
      expect(toggle.x + toggle.width, `row ${i} switch inside the panel`).toBeLessThanOrEqual(panel.x + panel.width + 0.5);
    }
  });
});
