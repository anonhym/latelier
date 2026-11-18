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
 * The value editors' size limits (list chips, text box, mixed-type helper
 * line) at a 400px Inspector. jsdom has no layout engine, so a component test
 * cannot tell a capped box from an uncapped one.
 */
const CHIPS_AT_REST_MAX_PX = 84;
const MAX_TEXT_LINES = 4;

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

/** 60% of the documents hold `code` as a string, 40% as a number. */
const MIXED_DOCS = Array.from({ length: 10 }, (_, i) => ({ n: i, code: i < 6 ? `c${i}` : i }));

test('value editors keep their caps at a 400px Inspector', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.setViewportSize({ width: 1600, height: 900 });

    await seedActiveConnectionWithDocs(
      win,
      { ...baseConnInput(host, port), name: 'Value Editors Target' },
      { dbName: 'shop', collection: 'orders', docs: MIXED_DOCS },
    );

    const ws = new WorkspacePage(win);
    await ws.openCollectionFromNavigator('shop', 'orders');
    await expect(win.getByText('"c0"').first()).toBeVisible({ timeout: 8000 });
    await ws.openBuilder();
    await resizePanel(win, 400);

    // (a) A $in with 12 values stays under the resting cap and offers "Show all".
    await win.getByRole('button', { name: 'Add condition', exact: true }).click();
    await win.getByPlaceholder('field', { exact: true }).fill('n');
    await win.getByPlaceholder('$op', { exact: true }).fill('$in');
    await win.getByRole('listbox', { name: 'Operator suggestions' }).getByRole('option').first().click();
    const chipsInput = win.getByPlaceholder('add a value, Enter');
    await chipsInput.pressSequentially(`${Array.from({ length: 12 }, (_, i) => i + 100).join(',')},`);
    // The footer's button is withheld while the box is being typed into.
    await win.keyboard.press('Tab');
    await expect(win.getByText('12 values')).toBeVisible();
    await expect(win.getByRole('button', { name: 'Show all', exact: true })).toBeVisible();
    const area = win.locator('[data-value-box] .mantine-TagsInput-input');
    expect((await rect(area)).height, 'chips area at rest').toBeLessThanOrEqual(CHIPS_AT_REST_MAX_PX);

    // (b) A long text value grows the box but never past four lines.
    await win.getByRole('button', { name: 'Add condition', exact: true }).click();
    await win.getByPlaceholder('field', { exact: true }).nth(1).fill('label');
    const text = win.getByPlaceholder('value', { exact: true }).first();
    await text.fill('a rather long value that wraps onto several lines of the box '.repeat(8));
    const lineHeight = await text.evaluate((el) => Number.parseFloat(getComputedStyle(el).lineHeight));
    const padding = await text.evaluate((el) => {
      const s = getComputedStyle(el);
      return Number.parseFloat(s.paddingTop) + Number.parseFloat(s.paddingBottom);
    });
    const grown = await rect(text);
    expect(grown.height, 'the box grew past one line').toBeGreaterThan(lineHeight + padding + 1);
    expect(grown.height, 'the box stops at four lines').toBeLessThanOrEqual(lineHeight * MAX_TEXT_LINES + padding + 1);

    // (c) A mixed field shows exactly one helper line under a typed value.
    await win.getByRole('button', { name: 'Add condition', exact: true }).click();
    await win.getByPlaceholder('field', { exact: true }).nth(2).fill('code');
    await win.getByPlaceholder('value', { exact: true }).nth(1).fill('5');
    const skips = win.getByText(/^Skips the 40% that store code as a number/);
    await expect(skips).toHaveCount(1);
    await expect(win.getByRole('status').filter({ hasText: /Skips the|so only/ })).toHaveCount(1);
  });
});

test('a wrapped value box grows when the Inspector is narrowed, with no edit', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.setViewportSize({ width: 1600, height: 900 });

    await seedActiveConnectionWithDocs(
      win,
      { ...baseConnInput(host, port), name: 'Narrow Grow Target' },
      { dbName: 'shop', collection: 'orders', docs: MIXED_DOCS },
    );

    const ws = new WorkspacePage(win);
    await ws.openCollectionFromNavigator('shop', 'orders');
    await expect(win.getByText('"c0"').first()).toBeVisible({ timeout: 8000 });
    await ws.openBuilder();
    await resizePanel(win, 800);
    await win.getByRole('button', { name: 'Add condition', exact: true }).click();
    await win.getByPlaceholder('field', { exact: true }).first().fill('label');
    const text = win.getByPlaceholder('value', { exact: true }).first();
    await text.fill('a rather long value that wraps onto lines of the box '.repeat(1));
    const wide = (await rect(text)).height;

    // Narrowing re-wraps the same text. Nothing is typed, so only the width
    // change can make the box taller.
    await resizePanel(win, 330);
    await expect.poll(async () => (await rect(text)).height, { message: 'the box grew with the narrower width' })
      .toBeGreaterThan(wide + 1);
  });
});

test('a few long chips that wrap past three lines still offer "Show all"', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.setViewportSize({ width: 1600, height: 900 });

    await seedActiveConnectionWithDocs(
      win,
      { ...baseConnInput(host, port), name: 'Long Chips Target' },
      { dbName: 'shop', collection: 'orders', docs: MIXED_DOCS },
    );

    const ws = new WorkspacePage(win);
    await ws.openCollectionFromNavigator('shop', 'orders');
    await expect(win.getByText('"c0"').first()).toBeVisible({ timeout: 8000 });
    await ws.openBuilder();
    await resizePanel(win, 400);

    await win.getByRole('button', { name: 'Add condition', exact: true }).click();
    await win.getByPlaceholder('field', { exact: true }).fill('label');
    await win.getByPlaceholder('$op', { exact: true }).fill('$in');
    await win.getByRole('listbox', { name: 'Operator suggestions' }).getByRole('option').first().click();
    const chipsInput = win.getByPlaceholder('add a value, Enter');
    const longChips = ['alpha', 'bravo', 'charlie', 'delta'].map((w) => `${w}-${'x'.repeat(40)}`);
    await chipsInput.pressSequentially(`${longChips.join(',')},`);
    await win.keyboard.press('Tab');

    // Four chips are under the count rule's threshold, so only the measured
    // overflow can have put the footer here.
    await expect(win.getByText('4 values')).toBeVisible();
    await expect(win.getByRole('button', { name: 'Show all', exact: true })).toBeVisible();
  });
});
