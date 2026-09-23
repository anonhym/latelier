import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { MongoMemoryServer } from 'mongodb-memory-server';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Shared E2E helpers for the Playwright + Electron suite. Earlier files
 * inlined this same boilerplate; consolidating reduces duplication and makes
 * cleanup harder to forget when new tests are added.
 *
 * `MongoMemoryServer` instances are tracked at module scope so callers can
 * invoke `await stopAllMemoryServers()` from `test.afterAll()` and have all
 * leaked instances reaped even if a test threw mid-setup.
 */

const MEMORY_SERVERS: MongoMemoryServer[] = [];

export function freshUserData(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mongolab-e2e-'));
}

export async function launchApp(userDataDir: string): Promise<ElectronApplication> {
  const app = await electron.launch({
    args: [path.resolve(here, '../..', 'dist-electron/main.js')],
    env: {
      ...process.env,
      ATELIER_USER_DATA_DIR: userDataDir,
      NODE_ENV: 'test',
    },
  });
  // A test instance never shows its window (`electron/main.ts`). macOS still
  // renders a hidden window, but Linux under xvfb (CI) backgrounds it:
  // timers are throttled and frames stop, so rAF, scroll events and
  // ResizeObserver stall. Measured on CI (PR #122): 0 of 49 `setTimeout(0)`
  // callbacks ran in 3s, and one ArrowDown's render was not committed
  // before the next key. Electron documents that disabling background
  // throttling keeps timers running and frames drawn for the window.
  await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.setBackgroundThrottling(false);
  });
  return app;
}

/**
 * Run a body with a launched Electron app + isolated userData dir.
 * Guarantees `app.close()` and `rmSync(userDataDir)` even if `launchApp`
 * throws or the body's first await rejects.
 */
export async function withApp<T>(
  fn: (app: ElectronApplication, userDataDir: string) => Promise<T>,
): Promise<T> {
  const userDataDir = freshUserData();
  let app: ElectronApplication | null = null;
  try {
    app = await launchApp(userDataDir);
    return await fn(app, userDataDir);
  } finally {
    if (app) await app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

/**
 * Variant of `withApp` that reuses an external `userDataDir` — used by
 * relaunch tests (theme persistence, secrets vault) that must keep the
 * SQLite file across two launches.
 */
export async function withAppOnUserData<T>(
  userDataDir: string,
  fn: (app: ElectronApplication) => Promise<T>,
): Promise<T> {
  let app: ElectronApplication | null = null;
  try {
    app = await launchApp(userDataDir);
    return await fn(app);
  } finally {
    if (app) await app.close();
  }
}

export interface MemoryHostPort {
  server: MongoMemoryServer;
  host: string;
  port: number;
}

/**
 * Spin up a `MongoMemoryServer` and parse its host/port. The server is
 * tracked in module scope; call `stopAllMemoryServers()` from afterAll to
 * reap on suite teardown.
 *
 * Retries up to 3 times on `Port "<n>" already in use`. Even when the
 * previous server was awaited-stopped, the kernel can hold the port in
 * TIME_WAIT briefly — and `mongodb-memory-server` picks ports randomly,
 * so a retry almost always lands on a fresh one.
 */
export async function startMemoryServer(
  opts?: ConstructorParameters<typeof MongoMemoryServer>[0],
): Promise<MemoryHostPort> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const server = await MongoMemoryServer.create(opts);
      MEMORY_SERVERS.push(server);
      const m = server.getUri().match(/mongodb:\/\/([^:/]+):(\d+)/);
      if (!m) {
        await server.stop().catch(() => {});
        throw new Error('cannot parse memory mongo uri');
      }
      return { server, host: m[1]!, port: Number(m[2]!) };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!/already in use/i.test(msg)) throw err;
      // Brief backoff so the port has a chance to clear.
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw lastErr;
}

export async function stopAllMemoryServers(): Promise<void> {
  await Promise.all(MEMORY_SERVERS.splice(0).map((m) => m.stop().catch(() => {})));
}

export const baseConnInput = (host: string, port: number) => ({
  name: 'E2E Target',
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
