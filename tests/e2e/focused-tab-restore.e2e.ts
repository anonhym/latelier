import { test, expect } from '@playwright/test';
import {
  baseConnInput,
  freshUserData,
  startMemoryServer,
  stopAllMemoryServers,
  withAppOnUserData,
} from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import fs from 'node:fs';

test.afterAll(stopAllMemoryServers);

/**
 * X16.1, spec §4.7 — launch restores the tab set as persisted, and the
 * Focused Tab (`is_active`) is where the Data View's Connection comes from.
 * Modeled on `workspace-restore.e2e.ts`'s quit + relaunch shape, but asserting
 * the *rendered* Data View on the second launch (TitleBar name, which tab is
 * selected), not just the raw tab rows.
 *
 * The Focused Tab is deliberately the second tab opened, so a restore that
 * followed strip order rather than `is_active` would land on the wrong one.
 */
test('restores the same Focused Tab, and its Connection, across a quit + relaunch', async () => {
  const { host, port } = await startMemoryServer();
  const userDataDir = freshUserData();

  try {
    await withAppOnUserData(userDataDir, async (app) => {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      const ws = new WorkspacePage(win);

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
              setActive: (id: string) => Promise<unknown>;
            };
          };
        }).atelier;
        const c = await api.conn.create(input);
        await api.tabs.openCollection({ connectionId: c.id, dbName: 'db', collection: 'alpha' });
        const beta = await api.tabs.openCollection({
          connectionId: c.id,
          dbName: 'db',
          collection: 'beta',
        });
        // `beta` is second in the strip and is the Focused Tab.
        await api.tabs.setActive(beta.id);
      }, baseConnInput(host, port));

      // Reload so the freshly-mounted Workspace reads the persisted tabs the
      // same way a real relaunch would — proves the restore isn't merely an
      // artifact of the tabs having been opened this session.
      await win.reload();
      await win.waitForLoadState('domcontentloaded');
      await expect(ws.switcher.triggerNamed('E2E Target')).toBeVisible({ timeout: 10_000 });
      await expect(win.getByRole('tab', { name: /beta/ })).toHaveAttribute('aria-selected', 'true');
    });

    // --- quit + relaunch: the tabs and the Focused Tab come back ----------
    await withAppOnUserData(userDataDir, async (app) => {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      const ws = new WorkspacePage(win);

      // The Connection is named because the Focused Tab names it — nothing
      // else persists the choice.
      await expect(ws.switcher.triggerNamed('E2E Target')).toBeVisible({ timeout: 10_000 });
      await expect(win.getByRole('tab', { name: /alpha/ })).toBeVisible();
      await expect(win.getByRole('tab', { name: /beta/ })).toHaveAttribute('aria-selected', 'true');
      await expect(win.getByRole('tab', { name: /alpha/ })).toHaveAttribute(
        'aria-selected',
        'false',
      );
    });
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

/**
 * X16.1 acceptance criterion, spec §10 case 23 — quitting with a
 * Connection connected and no tabs open lands on the empty state. That is the
 * one case the retired `ui.workspace` Active-Connection pref covered and tabs
 * do not, and a Connection you had no tab on is a Connection you were not
 * using.
 */
test('a Connection connected with no tabs open yields the empty state on relaunch', async () => {
  const { host, port } = await startMemoryServer();
  const userDataDir = freshUserData();

  try {
    await withAppOnUserData(userDataDir, async (app) => {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      await win.evaluate(async (input) => {
        const api = (window as unknown as {
          atelier: {
            conn: { create: (i: unknown) => Promise<{ id: string }> };
            mongo: { connect: (id: string) => Promise<unknown> };
          };
        }).atelier;
        const c = await api.conn.create(input);
        await api.mongo.connect(c.id);
      }, baseConnInput(host, port));
      await win.reload();
      await win.waitForLoadState('domcontentloaded');
      // A renderer reload leaves the main process — and so the pooled client —
      // alive, so this Connection is still Open. X16.4: no tabs plus
      // something connected is the "pick a collection" prompt, not the
      // Switcher CTA. Either way it is the empty state: no tab was invented.
      await expect(win.getByText(/Select a collection from the sidebar/i)).toBeVisible({
        timeout: 10_000,
      });
    });

    // --- relaunch: still the empty state, no crash, no redirect ----------
    await withAppOnUserData(userDataDir, async (app) => {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      // Still on the Data View — the empty state only renders there, so its
      // visibility is itself proof of no redirect.
      // A real relaunch is a new main process, so nothing is connected: the
      // Switcher CTA, and nothing restored on its behalf.
      await expect(win.getByText(/No connection is open/i)).toBeVisible({ timeout: 10_000 });
    });
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
