import { test, expect, type Page } from '@playwright/test';
import { baseConnInput, startMemoryServer, stopAllMemoryServers, withApp } from '../helpers/e2eApp';

test.afterAll(stopAllMemoryServers);

/**
 * The sidebar stacks the Databases/Agents switch above the navigator in one
 * column. A navigator sized to the whole column's height is pushed down by the
 * switch and runs over the status bar. jsdom has no layout, so only a real
 * window shows it: each sidebar body must end where the status bar starts.
 */
async function bottomOf(win: Page, selector: string): Promise<number> {
  const box = await win.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} has no box`);
  return box.y + box.height;
}

test('the sidebar ends above the status bar, in Databases and Agents mode', async () => {
  const mongo = await startMemoryServer();
  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.evaluate(
      async ({ input }) => {
        const api = (window as unknown as {
          atelier: { conn: { create: (i: unknown) => Promise<{ id: string }> }; mongo: { connect: (id: string) => Promise<unknown> } };
        }).atelier;
        const created = await api.conn.create(input);
        await api.mongo.connect(created.id);
      },
      { input: baseConnInput(mongo.host, mongo.port) },
    );
    await win.reload();

    const statusBar = win.getByTestId('status-bar');
    await expect(statusBar).toBeVisible();
    const statusTop = (await statusBar.boundingBox())!.y;

    await expect(win.getByLabel('Database navigator')).toBeVisible();
    expect(await bottomOf(win, '[aria-label="Database navigator"]')).toBeLessThanOrEqual(statusTop + 0.5);

    await win.getByRole('tablist', { name: 'Sidebar mode' }).getByRole('tab', { name: /Agents/ }).click();
    const agentsSidebar = win.getByTestId('agents-sidebar');
    await expect(agentsSidebar).toBeVisible();
    expect(await bottomOf(win, '[data-testid="agents-sidebar"]')).toBeLessThanOrEqual(statusTop + 0.5);
  });
});
