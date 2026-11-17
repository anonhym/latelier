import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * T2.5 (AC2/AC3/AC4) — Table-view column reorder, computed columns and
 * row-expand state persist across a quit + relaunch. Hiding a column now
 * writes the projection (W14 §11), so the saved `hidden` list this seeds is
 * the form an older build left: the app reads it back as the equivalent
 * exclusion and clears the list (§11.6). Modeled on
 * `workspace-restore.e2e.ts`: drives everything through `window.atelier`
 * directly (no live Mongo query needed — `columnConfig`/`expandedRows` are
 * pure per-tab UI state persisted via `workspace_tabs.state_json`, the same
 * mechanism `columns` widths already use).
 */
test('Table column order/computed + row expand survive a quit + relaunch, and a saved hidden list becomes the projection', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mongolab-e2e-'));

  const columnConfig = {
    hidden: ['secret'],
    order: ['banana', '_id', 'apple'],
    computed: [{ id: 'c1', path: 'address.city', label: 'City' }],
  };
  const expandedRows = { doc1: true };

  // --- first launch: seed a tab and patch its Table column config ---------
  const first = await electron.launch({
    args: [path.resolve(here, '../..', 'dist-electron/main.js')],
    env: {
      ...process.env,
      ATELIER_USER_DATA_DIR: userDataDir,
      NODE_ENV: 'test',
    },
  });
  try {
    const win = await first.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    const seeded = await win.evaluate(
      async ({ columnConfig, expandedRows }) => {
        const api = (window as unknown as {
          atelier: {
            conn: { create: (input: unknown) => Promise<{ id: string }> };
            tabs: {
              openCollection: (input: {
                connectionId: string;
                dbName: string;
                collection: string;
              }) => Promise<{ id: string }>;
              update: (
                id: string,
                patch: { state: Record<string, unknown> },
              ) => Promise<unknown>;
            };
          };
        }).atelier;
        const c = await api.conn.create({
          name: 'Seed',
          color: '#1A6835',
          connectionType: 'standard',
          host: '127.0.0.1',
          port: 27017,
          authMech: 'none',
          tls: { enabled: false, verify: true },
          advanced: {
            connectTimeoutMs: 3000,
            socketTimeoutMs: 3000,
            serverSelectionTimeoutMs: 3000,
            readPreference: 'primary',
            maxPoolSize: 1,
            directConnection: true,
          },
        });
        const a = await api.tabs.openCollection({
          connectionId: c.id,
          dbName: 'db',
          collection: 'orders',
        });
        await api.tabs.update(a.id, { state: { columnConfig, expandedRows } });
        return { tabId: a.id };
      },
      { columnConfig, expandedRows },
    );
    expect(seeded.tabId).toBeTruthy();
  } finally {
    await first.close();
  }

  // --- relaunch: columnConfig + expandedRows should still be there --------
  const second = await electron.launch({
    args: [path.resolve(here, '../..', 'dist-electron/main.js')],
    env: {
      ...process.env,
      ATELIER_USER_DATA_DIR: userDataDir,
      NODE_ENV: 'test',
    },
  });
  try {
    const win = await second.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    // The migration runs in the renderer as the tab list loads and is saved
    // from there, so the saved state is polled rather than read once.
    const read = () => win.evaluate(async () => {
      const api = (window as unknown as {
        atelier: {
          tabs: {
            list: () => Promise<
              Array<{
                collection: string;
                state?: {
                  columnConfig?: unknown;
                  builder?: { projectionRaw?: string };
                  expandedRows?: Record<string, boolean>;
                };
              }>
            >;
          };
        };
      }).atelier;
      const tabs = await api.tabs.list();
      return tabs.find((t) => t.collection === 'orders');
    });
    await expect.poll(async () => (await read())?.state?.builder?.projectionRaw).toBe('{"secret":0}');

    const state = await read();
    expect(state).toBeTruthy();
    // Everything but the hidden list is as it was saved; the list is gone.
    expect(state?.state?.columnConfig).toEqual({ order: columnConfig.order, computed: columnConfig.computed });
    expect(state?.state?.expandedRows).toEqual(expandedRows);
  } finally {
    await second.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
