import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { MongoMemoryServer } from 'mongodb-memory-server';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * GAP 3 — Secrets vault round-trip across relaunch.
 *
 * Spin up an auth-enabled `mongodb-memory-server`, create a SCRAM-authed
 * connection, persist the password through `safeStorage`, close the app, and
 * relaunch on the same userData. The second `mongo.connect` must succeed —
 * which only happens if the encrypted password was decrypted from cold
 * SQLite storage and used to authenticate.
 *
 * On systems where `safeStorage.isEncryptionAvailable()` is `false` (Linux
 * without libsecret — common in CI), the very first `conn.create` with a
 * password throws `SECRETS_UNAVAILABLE`. The test detects that and skips,
 * since the *encrypted* round-trip under test can't be exercised at all in
 * that env — even though end users on such hosts can opt into the plaintext
 * fallback (see issue #4 + the `secrets.allowPlaintextFallback` pref). CI
 * hosts that want this coverage need `libsecret-1-dev` + a session keyring
 * (or equivalent on Win/Mac).
 */

async function launchApp(userDataDir: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [path.resolve(here, '../..', 'dist-electron/main.js')],
    env: {
      ...process.env,
      ATELIER_USER_DATA_DIR: userDataDir,
      NODE_ENV: 'test',
    },
  });
}

/**
 * Run a body with a launched Electron app, guaranteeing close() even if the
 * body throws. `electron.launch` throwing leaves `app` null, so close() is
 * skipped — there's nothing to close in that case.
 */
async function withApp<T>(
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

test('secret round-trips through safeStorage across a quit + relaunch', async () => {
  // Track shared resources so the outer finally can clean up regardless of
  // where in the body a failure happens (per a reviewer bot's finding).
  let mongoServer: MongoMemoryServer | null = null;
  let userDataDir: string | null = null;
  try {
    mongoServer = await MongoMemoryServer.create({
      auth: {
        enable: true,
        customRootName: 'admin',
        customRootPwd: 'rootpw',
      },
    });
    const m = mongoServer.getUri().match(/mongodb:\/\/([^:/]+):(\d+)/);
    if (!m) throw new Error('cannot parse memory mongo uri');
    const host = m[1]!;
    const port = Number(m[2]!);

    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mongolab-e2e-'));

    const connInput = {
      name: 'Secrets Target',
      color: '#1A6835',
      connectionType: 'standard' as const,
      host,
      port,
      authMech: 'scram256' as const,
      authUsername: 'admin',
      authDatabase: 'admin',
      tls: { enabled: false, verify: true },
      advanced: {
        connectTimeoutMs: 5000,
        socketTimeoutMs: 5000,
        serverSelectionTimeoutMs: 5000,
        readPreference: 'primary' as const,
        maxPoolSize: 1,
        directConnection: true,
      },
      password: 'rootpw',
    };

    let connectionId: string | null = null;

    // --- first launch: create + connect, proving safeStorage encrypts. -----
    const firstLaunchOk = await withApp(userDataDir, async (app) => {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');

      const result = await win.evaluate(async (input) => {
        const api = (window as unknown as {
          atelier: {
            conn: { create: (input: unknown) => Promise<{ id: string }> };
            mongo: { connect: (id: string) => Promise<{ status: string }> };
          };
        }).atelier;

        try {
          const created = await api.conn.create(input);
          const status = await api.mongo.connect(created.id);
          return { ok: true as const, id: created.id, status: status.status };
        } catch (err) {
          return {
            ok: false as const,
            code: (err as { code?: string }).code,
            message: (err as { message?: string }).message,
          };
        }
      }, connInput);

      if (!result.ok && result.code === 'SECRETS_UNAVAILABLE') {
        // Skip: this host has no OS keychain access. The contract under test
        // (encrypt+persist+decrypt) can't run here at all.
        return { skipped: true as const };
      }

      expect(result.ok, `conn.create / mongo.connect failed: ${JSON.stringify(result)}`).toBe(true);
      if (result.ok) {
        expect(result.status).toBe('connected');
        connectionId = result.id;
      }
      return { skipped: false as const };
    });

    if (firstLaunchOk.skipped) {
      test.skip(
        true,
        'safeStorage.isEncryptionAvailable() is false on this host (CI without libsecret?)',
      );
      return;
    }

    // --- second launch: connect again with no fresh password input. --------
    // Only succeeds if the stored ciphertext was decrypted by safeStorage.
    expect(connectionId).not.toBeNull();
    await withApp(userDataDir, async (app) => {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');

      const status = await win.evaluate(async (id) => {
        const api = (window as unknown as {
          atelier: {
            mongo: { connect: (id: string) => Promise<{ status: string }> };
          };
        }).atelier;
        try {
          const r = await api.mongo.connect(id);
          return { ok: true as const, status: r.status };
        } catch (err) {
          return {
            ok: false as const,
            code: (err as { code?: string }).code,
            message: (err as { message?: string }).message,
          };
        }
      }, connectionId!);

      expect(status.ok, `relaunch mongo.connect failed: ${JSON.stringify(status)}`).toBe(true);
      if (status.ok) expect(status.status).toBe('connected');
    });
  } finally {
    // Catch on .stop() so a failing test body's error isn't masked by a
    // secondary teardown failure.
    if (mongoServer) await mongoServer.stop().catch(() => {});
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
