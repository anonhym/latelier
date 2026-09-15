import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { MongoMemoryServer } from 'mongodb-memory-server';

const here = path.dirname(fileURLToPath(import.meta.url));

test('create → test → save → appears in list', async () => {
  const mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  const m = uri.match(/mongodb:\/\/([^:/]+):(\d+)/);
  if (!m) throw new Error('cannot parse memory mongo uri');
  const host = m[1]!;
  const port = Number(m[2]!);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mongolab-e2e-'));
  const app = await electron.launch({
    args: [path.resolve(here, '../..', 'dist-electron/main.js')],
    env: {
      ...process.env,
      ATELIER_USER_DATA_DIR: userDataDir,
      NODE_ENV: 'test',
    },
  });

  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    // The renderer must NOT see Node internals.
    const exposed = await win.evaluate(() => ({
      hasRequire: typeof (window as unknown as { require?: unknown }).require !== 'undefined',
      hasIpcRenderer:
        typeof (window as unknown as { ipcRenderer?: unknown }).ipcRenderer !== 'undefined',
      hasProcess: typeof (window as unknown as { process?: unknown }).process !== 'undefined',
      hasAtelier: typeof (window as unknown as { atelier?: unknown }).atelier !== 'undefined',
    }));
    expect(exposed.hasRequire).toBe(false);
    expect(exposed.hasIpcRenderer).toBe(false);
    expect(exposed.hasAtelier).toBe(true);

    // Call through to the bridge to create a connection end-to-end.
    const created = await win.evaluate(
      async ({ host, port }) => {
        const api = (window as unknown as {
          atelier: {
            conn: {
              create: (input: unknown) => Promise<{ id: string; name: string }>;
              list: () => Promise<Array<{ id: string; name: string }>>;
              test: (input: unknown) => Promise<{ ok: boolean }>;
            };
          };
        }).atelier;
        const input = {
          name: 'E2E Target',
          color: '#1A6835',
          connectionType: 'standard',
          host,
          port,
          authMech: 'none',
          tls: { enabled: false, verify: true },
          advanced: {
            connectTimeoutMs: 5000,
            socketTimeoutMs: 5000,
            serverSelectionTimeoutMs: 5000,
            readPreference: 'primary',
            maxPoolSize: 5,
            directConnection: true,
          },
        };
        const probe = await api.conn.test(input);
        if (!probe.ok) throw new Error('probe failed');
        const saved = await api.conn.create(input);
        const list = await api.conn.list();
        return { saved, list };
      },
      { host, port },
    );

    expect(created.saved.name).toBe('E2E Target');
    expect(created.list.map((x) => x.name)).toContain('E2E Target');

    // DB row persisted on disk.
    expect(fs.existsSync(path.join(userDataDir, 'mongolab.db'))).toBe(true);
  } finally {
    await app.close();
    await mongoServer.stop();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
