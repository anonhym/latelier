import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const SUFFIXES = ['', '-wal', '-shm'];

function launch(userDataDir: string) {
  return electron.launch({
    args: [path.resolve(here, '../..', 'dist-electron/main.js')],
    env: {
      ...process.env,
      ATELIER_USER_DATA_DIR: userDataDir,
      NODE_ENV: 'test',
    },
  });
}

test('a database left under the pre-rename name is adopted as latelier.db on the next start', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mongolab-e2e-'));
  const dbFile = (name: string, suffix = '') => path.join(userDataDir, name + suffix);

  try {
    // --- first launch: seed a connection ------------------------------------
    const first = await launch(userDataDir);
    try {
      const win = await first.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      await win.evaluate(async () => {
        const api = (window as unknown as {
          atelier: { conn: { create: (input: unknown) => Promise<{ id: string }> } };
        }).atelier;
        await api.conn.create({
          name: 'Legacy Seed',
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
      });
    } finally {
      await first.close();
    }

    // --- put the database back under the name older builds used -------------
    for (const suffix of SUFFIXES) {
      if (fs.existsSync(dbFile('latelier.db', suffix))) {
        fs.renameSync(dbFile('latelier.db', suffix), dbFile('mongolab.db', suffix));
      }
    }
    expect(fs.existsSync(dbFile('mongolab.db'))).toBe(true);
    expect(fs.existsSync(dbFile('latelier.db'))).toBe(false);

    // --- second launch: the legacy file is adopted, the data is intact ------
    const second = await launch(userDataDir);
    try {
      const win = await second.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      const names = await win.evaluate(async () => {
        const api = (window as unknown as {
          atelier: { conn: { list: () => Promise<Array<{ name: string }>> } };
        }).atelier;
        return (await api.conn.list()).map((c) => c.name);
      });
      expect(names).toContain('Legacy Seed');
    } finally {
      await second.close();
    }

    expect(fs.existsSync(dbFile('latelier.db'))).toBe(true);
    for (const suffix of SUFFIXES) {
      expect(fs.existsSync(dbFile('mongolab.db', suffix))).toBe(false);
    }
    const logs = fs.readdirSync(path.join(userDataDir, 'logs'));
    expect(logs.some((name) => /^latelier\.\d{4}-\d{2}-\d{2}\.log$/.test(name))).toBe(true);
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
