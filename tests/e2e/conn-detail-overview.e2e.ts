import { test, expect } from '@playwright/test';
import {
  baseConnInput,
  startMemoryServer,
  stopAllMemoryServers,
  withApp,
} from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import { seedActiveConnection } from './helpers/uiSeed';
import { expectStatusDot, expectConsoleClean } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

/**
 * C06 — Overview tab: selecting a connected connection loads the server-info
 * cards (Host, Version, Topology, Databases, Storage, Performance).
 */
test('detail overview tab: server info cards render after connecting', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      const switcher = new WorkspacePage(win).switcher;

      // X16.1 — `seedActiveConnection` chooses the Connection in the
      // Switcher, which opens and then closes the popover — so seed first,
      // then open it.
      const { name } = await seedActiveConnection(win, {
        ...baseConnInput(host, port),
        name: 'Overview Target',
      });
      await switcher.waitVisible();
      await expect(switcher.item(name)).toBeVisible({ timeout: 8000 });
      await expectStatusDot(win, name, 'connected');

      // reviewed: the deep detail screen (`/connections/:id`) is
      // reached only via "Manage" (ADR 0001) and is still live — it is
      // the only place these server-info cards render, so this stays pointed
      // at it rather than the retired bare `/connections` list.
      await switcher.manage(name);

      // The Overview tab is active by default. Cards mount only after
      // `api.mongo.serverInfo` resolves, so we want assertions specific to the
      // card content — not labels like "Host"/"Version" that also appear in
      // the always-rendered detail-panel header (false-positive risk).
      //
      // 'Topology' is unique to the Server card's row labels, and the Server
      // card also renders a server version like '7.x.y' — both are real
      // signals that the IPC round-trip completed.
      await expect(win.getByText('Topology', { exact: true })).toBeVisible({ timeout: 8000 });
      await expect(win.locator('text=/^\\d+\\.\\d+\\.\\d+$/').first()).toBeVisible();
    });
  });
});
