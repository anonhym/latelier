import { test, expect } from '@playwright/test';
import { stopAllMemoryServers } from '../helpers/e2eApp';
import { withOpenOrders } from './helpers/uiSeed';

test.afterAll(stopAllMemoryServers);

const DOCS = [{ name: 'ada', tier: 'gold', note: 'vip-note' }];

/**
 * W14 §11 — the Fields list writes the projection. Unchecking a column takes
 * it out of the Table at once without calling the rows out of date, the next
 * Run sends the projection, and the rows that come back are the proof: a field
 * the server no longer returns is marked "on next Run" when it is checked
 * again, which no view-side hiding could say.
 */
test('unchecking a column hides it at once, Run fetches the projected shape, checking it again waits for Run', async () => {
  test.setTimeout(120_000);
  await withOpenOrders('Fields List Uncheck', DOCS, 'gold', async (win, ws) => {
    await ws.viewTableButton.click();
    await expect(ws.tableHeader('tier')).toBeVisible();
    await ws.toggleOptionsExpanded();

    await ws.fieldsButton.click();
    await win.getByRole('checkbox', { name: 'tier', exact: true }).uncheck();

    await expect(ws.tableHeader('tier')).toHaveCount(0);
    await expect(ws.tableHeader('name')).toBeVisible();
    // The rows on screen still hold everything the query asks for.
    await expect(win.getByTestId('band-stale')).toHaveCount(0);
    await expect(ws.fieldsProjection).toHaveValue('{"tier":0}');
    await win.keyboard.press('Escape');
    await expect(ws.fieldsButton).toHaveText('Project: all but 1');

    await ws.queryBarRunButton.click();
    await expect(ws.tableHeader('name')).toBeVisible();
    await expect(win.getByText('gold')).toHaveCount(0);
    await expect(ws.fieldsButton).toHaveText('Project: all but 1');

    // The server really did drop it: checking it again has nothing to show until the next Run.
    await ws.fieldsButton.click();
    await expect(ws.fieldsProjection).toHaveValue('{"tier":0}');
    await expect(win.getByRole('checkbox', { name: 'tier', exact: true })).not.toBeChecked();
    await win.getByRole('checkbox', { name: 'tier', exact: true }).check();
    await expect(win.getByTestId('fields-on-next-run')).toBeVisible();
    await expect(win.getByTestId('band-stale')).toBeVisible();
    await win.keyboard.press('Escape');

    await ws.queryBarRunButton.click();
    await expect(win.getByText('gold')).toBeVisible({ timeout: 8000 });
    await expect(ws.fieldsButton).toHaveText('Project');
  });
});

test('a projection typed in the Fields text unchecks its rows and the table follows', async () => {
  test.setTimeout(120_000);
  await withOpenOrders('Fields List Typed', DOCS, 'gold', async (win, ws) => {
    await ws.viewTableButton.click();
    await ws.toggleOptionsExpanded();
    await ws.fieldsButton.click();

    await ws.fieldsProjection.fill('{ tier: 0, note: 0 }');
    await ws.fieldsProjection.press('Enter');

    await expect(win.getByRole('checkbox', { name: 'tier', exact: true })).not.toBeChecked();
    await expect(win.getByRole('checkbox', { name: 'note', exact: true })).not.toBeChecked();
    await expect(win.getByRole('checkbox', { name: 'name', exact: true })).toBeChecked();
    await expect(win.getByTestId('fields-mode-tag')).toHaveText('Excluding 2');
    await expect(ws.tableHeader('tier')).toHaveCount(0);
    await expect(ws.tableHeader('note')).toHaveCount(0);
    await expect(ws.tableHeader('name')).toBeVisible();
    await win.keyboard.press('Escape');
    await expect(ws.fieldsButton).toHaveText('Project: all but 2');
  });
});

/**
 * W14 §11.6 — a tab saved before the merge carries a hidden list. Written the
 * way an old build left it, then read back by the app on a reload: the same
 * columns show, and the list has become the exclusion that hides them.
 */
test('a tab saved with a hidden list reopens with the same columns', async () => {
  test.setTimeout(120_000);
  await withOpenOrders('Fields List Migrated', DOCS, 'gold', async (win, ws) => {
    await ws.viewTableButton.click();
    await expect(ws.tableHeader('tier')).toBeVisible();

    await win.evaluate(async () => {
      const api = (window as unknown as {
        atelier: {
          tabs: {
            list: () => Promise<Array<{ id: string; collection: string }>>;
            update: (id: string, patch: { state: Record<string, unknown> }) => Promise<unknown>;
          };
        };
      }).atelier;
      const tab = (await api.tabs.list()).find((t) => t.collection === 'orders');
      if (!tab) throw new Error('the orders tab is not in the saved list');
      await api.tabs.update(tab.id, { state: { columnConfig: { hidden: ['tier'] } } });
    });
    await win.reload();
    await win.waitForLoadState('domcontentloaded');

    await expect(ws.tableHeader('name')).toBeVisible({ timeout: 15_000 });
    await expect(ws.tableHeader('tier')).toHaveCount(0);
    await ws.toggleOptionsExpanded();
    await expect(ws.fieldsButton).toHaveText('Project: all but 1');
    await ws.fieldsButton.click();
    await expect(ws.fieldsProjection).toHaveValue('{"tier":0}');
    await expect(win.getByRole('checkbox', { name: 'tier', exact: true })).not.toBeChecked();
  });
});
