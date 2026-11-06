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
 * The Filter tab used to shift under the pointer: every added row, banner or
 * match count pushed the add buttons and the footer down, the whole drawer
 * scrolled rather than the list, and the pane stopped short of the window's
 * bottom when the filter was short.
 *
 * This has to be an e2e. jsdom has no layout engine, so a component test
 * cannot see a box move.
 */
const TOLERANCE_PX = 1;

async function top(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  expect(box, 'element has a layout box').not.toBeNull();
  return box!.y;
}

async function addConditionsUpTo(win: Page, count: number) {
  const add = win.getByRole('button', { name: 'Add condition', exact: true });
  const fields = win.getByPlaceholder('field');
  while ((await fields.count()) < count) {
    const before = await fields.count();
    await add.click();
    await expect(fields).toHaveCount(before + 1);
  }
}

test('the Filter tab keeps its add buttons and footer in place while only the condition list scrolls', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await seedActiveConnectionWithDocs(
      win,
      { ...baseConnInput(host, port), name: 'Filter Layout Target' },
      { dbName: 'shop', collection: 'orders', docs: [{ name: 'doc-1' }] },
    );

    const ws = new WorkspacePage(win);
    await ws.openCollectionFromNavigator('shop', 'orders');
    await expect(win.getByText('doc-1')).toBeVisible({ timeout: 8000 });

    const pane = win.getByTestId('builder-pane');
    const list = win.getByTestId('filter-list');
    const add = win.getByRole('button', { name: 'Add condition', exact: true });
    const footer = pane.getByRole('button', { name: 'Reset', exact: true });

    // The pane fills the drawer, so its background, border and footer reach
    // the bottom of the window even with no condition at all.
    const bottoms = await pane.evaluate((el) => ({
      pane: el.getBoundingClientRect().bottom,
      drawer: el.parentElement!.getBoundingClientRect().bottom,
    }));
    expect(Math.abs(bottoms.pane - bottoms.drawer)).toBeLessThanOrEqual(TOLERANCE_PX);

    const addTop = await top(add);
    const footerTop = await top(footer);
    const expectInPlace = async (when: string) => {
      expect(Math.abs((await top(add)) - addTop), `add button at ${when}`).toBeLessThanOrEqual(TOLERANCE_PX);
      expect(Math.abs((await top(footer)) - footerTop), `footer at ${when}`).toBeLessThanOrEqual(TOLERANCE_PX);
    };

    for (const count of [1, 3, 10]) {
      await addConditionsUpTo(win, count);
      await expectInPlace(`${count} conditions`);
    }

    // Ten rows overflow the list, which scrolls by itself; the footer stays
    // on screen below it.
    const overflow = await list.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(overflow.scroll).toBeGreaterThan(overflow.client);
    await expect(footer).toBeInViewport();

    // A valid filter brings in the match-count line; it takes its room from
    // the list, not from the controls around it.
    await win.getByPlaceholder('field').first().fill('name');
    await win.getByPlaceholder('value').first().fill('doc-1');
    await expect(pane.getByText('≈1 match')).toBeVisible({ timeout: 8000 });
    await expectInPlace('a valid filter with its count line');
    await expect(footer).toBeInViewport();
  });
});
