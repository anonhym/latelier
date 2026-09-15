import { test, expect, type Page } from '@playwright/test';
import {
  freshUserData,
  startMemoryServer,
  stopAllMemoryServers,
  withAppOnUserData,
} from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import { expectStatusDot } from './helpers/uiAsserts';
import fs from 'node:fs';

test.afterAll(stopAllMemoryServers);

interface BridgeApi {
  conn: { create: (i: unknown) => Promise<{ id: string; name: string }> };
  tabs: {
    openCollection: (i: {
      connectionId: string;
      dbName: string;
      collection: string;
    }) => Promise<{ id: string }>;
    setActive: (id: string) => Promise<unknown>;
  };
  doc: {
    insert: (i: {
      connectionId: string;
      dbName: string;
      collection: string;
      docJson: string;
    }) => Promise<{ insertedId: unknown }>;
  };
}

/**
 * X16.5 — seeds three Connections (all against the same memory server,
 * since only status bookkeeping is under test, not talking to distinct
 * hosts) with one tab each, and makes the *second* one — `beta` — the
 * Focused Tab. Same shape `focused-tab-restore.e2e.ts` uses for its own
 * two-connection setup: create via the IPC bridge directly, not the UI, since
 * seeding isn't the thing under test.
 */
async function seedThreeConnectionsWithTabs(
  win: Page,
  host: string,
  port: number,
): Promise<{ alpha: { id: string; name: string }; beta: { id: string; name: string }; gamma: { id: string; name: string } }> {
  return win.evaluate(async ({ host, port }) => {
    const api = (window as unknown as { atelier: BridgeApi }).atelier;
    const mk = (name: string) => ({
      name,
      color: '#1A6835',
      connectionType: 'standard' as const,
      host,
      port,
      authMech: 'none' as const,
      tls: { enabled: false, verify: true },
      advanced: {
        connectTimeoutMs: 3000,
        socketTimeoutMs: 3000,
        serverSelectionTimeoutMs: 3000,
        readPreference: 'primary' as const,
        maxPoolSize: 5,
        directConnection: true,
      },
    });
    const alpha = await api.conn.create(mk('Dormant Alpha'));
    const beta = await api.conn.create(mk('Dormant Beta'));
    const gamma = await api.conn.create(mk('Dormant Gamma'));
    await api.tabs.openCollection({ connectionId: alpha.id, dbName: 'db', collection: 'coll-a' });
    const betaTab = await api.tabs.openCollection({
      connectionId: beta.id,
      dbName: 'db',
      collection: 'coll-b',
    });
    await api.tabs.openCollection({ connectionId: gamma.id, dbName: 'db', collection: 'coll-c' });
    // `beta`'s tab is the Focused Tab — the one that auto-connects on relaunch.
    await api.tabs.setActive(betaTab.id);
    return { alpha, beta, gamma };
  }, { host, port });
}

/**
 * X16.5, spec §4.7 — with tabs across several Connections, only the
 * Focused Tab's own Connection auto-connects on launch; the rest stay
 * Dormant. Modeled on `focused-tab-restore.e2e.ts`'s quit + relaunch shape.
 */
test('quit + relaunch: every tab returns, only the Focused Tab Connection connects, the rest are Dormant', async () => {
  const { host, port } = await startMemoryServer();
  const userDataDir = freshUserData();

  try {
    let ids!: Awaited<ReturnType<typeof seedThreeConnectionsWithTabs>>;
    await withAppOnUserData(userDataDir, async (app) => {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      const ws = new WorkspacePage(win);
      await ws.switcher.waitVisible();
      await win.keyboard.press('Escape');
      ids = await seedThreeConnectionsWithTabs(win, host, port);
    });

    // --- quit + relaunch --------------------------------------------------
    await withAppOnUserData(userDataDir, async (app) => {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');

      // All three tabs come back.
      await expect(win.getByRole('tab', { name: /coll-a/ })).toBeVisible({ timeout: 10_000 });
      await expect(win.getByRole('tab', { name: /coll-b/ })).toBeVisible();
      await expect(win.getByRole('tab', { name: /coll-c/ })).toBeVisible();

      // The Focused Tab (beta / coll-b) is selected, and its Connection connects.
      await expect(win.getByRole('tab', { name: /coll-b/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expectStatusDot(win, ids.beta.name, 'connected', 10_000);
      // `status: 'connected'` alone doesn't pin down *why* — a live client can
      // also come from an unrelated `listDatabases` lazily connecting the pool
      // entry. `lastUsedAt` only moves when the launch-restore effect's own
      // `api.conn.touchUsed` fires (see `openConnection` in Workspace.tsx), so
      // it is the one signal specific to that effect having actually run.
      const beta = await win.evaluate(async (id) => {
        const api = (window as unknown as {
          atelier: { conn: { list: () => Promise<Array<{ id: string; lastUsedAt?: string }>> } };
        }).atelier;
        const rows = await api.conn.list();
        return rows.find((r) => r.id === id);
      }, ids.beta.id);
      expect(beta?.lastUsedAt).toBeTruthy();

      // The other two never connect — Dormant. `data-dormant="true"` is the
      // tab strip's e2e-reliable signal (TabStrip.tsx); the navigator root's
      // own "not connected" ghost text is the same fact on the sidebar side.
      await expect(win.getByRole('tab', { name: /coll-a/ })).toHaveAttribute(
        'data-dormant',
        'true',
      );
      await expect(win.getByRole('tab', { name: /coll-c/ })).toHaveAttribute(
        'data-dormant',
        'true',
      );
      await expect(win.getByRole('tab', { name: /coll-b/ })).not.toHaveAttribute('data-dormant', 'true');

      await expectStatusDot(win, ids.alpha.name, 'unknown');
      await expectStatusDot(win, ids.gamma.name, 'unknown');

      const alphaRoot = win.locator(`[data-connection-id="${ids.alpha.id}"]`);
      const gammaRoot = win.locator(`[data-connection-id="${ids.gamma.id}"]`);
      const betaRoot = win.locator(`[data-connection-id="${ids.beta.id}"]`);
      await expect(alphaRoot.getByText('not connected')).toBeVisible();
      await expect(gammaRoot.getByText('not connected')).toBeVisible();
      await expect(betaRoot.getByText('not connected')).toHaveCount(0);
    });
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

/**
 * X16.5, spec §4.7 — clicking a Dormant tab is the wake gesture: it
 * connects that tab's own Connection and the pane fills with the real result
 * grid, not the "is not connected" placeholder it just left behind.
 */
test('clicking a Dormant tab after relaunch connects its Connection and fills the pane', async () => {
  const { host, port } = await startMemoryServer();
  const userDataDir = freshUserData();

  try {
    let ids!: Awaited<ReturnType<typeof seedThreeConnectionsWithTabs>>;
    await withAppOnUserData(userDataDir, async (app) => {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      const ws = new WorkspacePage(win);
      await ws.switcher.waitVisible();
      await win.keyboard.press('Escape');
      ids = await seedThreeConnectionsWithTabs(win, host, port);
      // A document in gamma's collection, seeded before relaunch, so clicking
      // its Dormant tab afterward has something distinctive to show once the
      // pane actually fills — not just a Connect button disappearing.
      await win.evaluate(async ({ connectionId }) => {
        const api = (window as unknown as { atelier: BridgeApi }).atelier;
        await api.doc.insert({
          connectionId,
          dbName: 'db',
          collection: 'coll-c',
          docJson: JSON.stringify({ marker: 'dormant-wake-e2e' }),
        });
      }, { connectionId: ids.gamma.id });
    });

    await withAppOnUserData(userDataDir, async (app) => {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');

      // Wait for restore + the Focused Tab's own auto-connect to settle first.
      await expect(win.getByRole('tab', { name: /coll-b/ })).toHaveAttribute(
        'aria-selected',
        'true',
        { timeout: 10_000 },
      );
      await expectStatusDot(win, ids.beta.name, 'connected', 10_000);

      const gammaTab = win.getByRole('tab', { name: /coll-c/ });
      await expect(gammaTab).toHaveAttribute('data-dormant', 'true');

      await gammaTab.click();

      await expect(gammaTab).toHaveAttribute('aria-selected', 'true');
      await expectStatusDot(win, ids.gamma.name, 'connected', 10_000);
      // Dormant marking clears once the Connection is live.
      await expect(gammaTab).not.toHaveAttribute('data-dormant', 'true');

      // The not-connected placeholder is gone and the real pane — with the
      // seeded document — is what replaced it.
      await expect(win.getByText(/is not connected/)).toHaveCount(0);
      await expect(win.getByText('dormant-wake-e2e')).toBeVisible({ timeout: 10_000 });
    });
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
