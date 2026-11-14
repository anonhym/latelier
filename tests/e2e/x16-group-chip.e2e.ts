import { test, expect } from '@playwright/test';
import {
  baseConnInput,
  startMemoryServer,
  stopAllMemoryServers,
  withApp,
} from '../helpers/e2eApp';
import { WorkspacePage } from './pages';

test.afterAll(stopAllMemoryServers);

/**
 * X16 §13.1 / §13.7 — the group chip is drawn only while tabs of two or more
 * Connections are open: closing one Connection's last tab removes it.
 */
test('the Connection group chip goes when only one Connection has tabs left', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    const ws = new WorkspacePage(win);
    await ws.switcher.waitWelcome();
    await win.keyboard.press('Escape');

    await win.evaluate(async (input) => {
      const api = (window as unknown as {
        atelier: {
          conn: { create: (i: unknown) => Promise<{ id: string }> };
          tabs: {
            openCollection: (i: {
              connectionId: string;
              dbName: string;
              collection: string;
            }) => Promise<{ id: string }>;
          };
        };
      }).atelier;
      const a = await api.conn.create({ ...(input as object), name: 'Chip Alpha' });
      const b = await api.conn.create({ ...(input as object), name: 'Chip Beta' });
      await api.tabs.openCollection({ connectionId: a.id, dbName: 'db', collection: 'coll-a' });
      await api.tabs.openCollection({ connectionId: b.id, dbName: 'db', collection: 'coll-b' });
    }, baseConnInput(host, port));
    await win.reload();
    await win.waitForLoadState('domcontentloaded');

    const strip = win.getByRole('tablist', { name: 'Open tabs' });
    const chip = (name: string) =>
      win.getByRole('group', { name }).getByRole('button', { name, exact: true });
    await expect(win.getByRole('tab', { name: /coll-b/ })).toBeVisible({ timeout: 10_000 });
    await expect(strip.getByRole('tab')).toHaveCount(2);
    await expect(chip('Chip Alpha')).toBeVisible();
    await expect(chip('Chip Beta')).toBeVisible();

    await ws.closeTab('coll-a');

    await expect(strip.getByRole('tab')).toHaveCount(1);
    await expect(chip('Chip Beta')).toHaveCount(0);
    await expect(chip('Chip Alpha')).toHaveCount(0);
  });
});
