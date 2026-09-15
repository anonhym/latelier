import { test, expect } from '@playwright/test';
import {
  baseConnInput,
  startMemoryServer,
  stopAllMemoryServers,
  withApp,
} from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import { seedConnection } from './helpers/uiSeed';
import { expectStatusDot, expectConsoleClean } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

/**
 * C05 — Connect / disconnect: the Switcher row's inline toggle drives the
 * live status dot from unknown → connected → unknown ('disconnected' maps to
 * 'unknown' — see `ConnectionService.list()`).
 */
test('connect: status dot flips to connected, disconnect flips back', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      const switcher = new WorkspacePage(win).switcher;
      await switcher.waitVisible();

      // reviewed: this used to seed a decoy Connection first to avoid
      // racing a `connections[0]` "most recently created" fallback. That was
      // replaced outright with an explicit/persisted choice (see
      // Workspace.tsx) — nothing auto-activates on mere creation any more —
      // so 'Toggle Target' starts 'unknown' regardless of seed order, and the
      // decoy is no longer needed.

      // Seed via IPC (not UI, because the subject of this test is the toggle).
      const { name } = await seedConnection(win, {
        ...baseConnInput(host, port),
        name: 'Toggle Target',
      });
      await expect(switcher.item(name)).toBeVisible({ timeout: 8000 });

      // Initial state: never connected → 'unknown' dot.
      await expectStatusDot(win, name, 'unknown');

      // Connect is a plain row click — the same gesture that makes a row Active.
      await switcher.select(name);
      await expectStatusDot(win, name, 'connected');

      // Disconnect is the row's own inline action icon (hover to reveal it),
      // not a control on a separate detail screen.
      await switcher.disconnect(name);

      // Spec §4.6 — the click opens a confirmation naming the
      // Connection and its tab count; only confirming it actually
      // disconnects. Same dialog-scoping convention as conn-delete.e2e.ts:
      // Mantine's Modal sets role="dialog" on its visible content (named via
      // aria-labelledby), so target it by its title-derived accessible name
      // rather than the bare role, which the still-open Switcher popover
      // also carries.
      const dialog = win.getByRole('dialog', { name: `Disconnect "${name}"?` });
      await expect(dialog).toBeVisible({ timeout: 3000 });
      await dialog.getByRole('button', { name: 'Disconnect' }).click();

      // Pool sets 'disconnected'; the sidebar maps it to 'unknown'.
      await expectStatusDot(win, name, 'unknown');
    });
  });
});
