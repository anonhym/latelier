import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Database from 'better-sqlite3';
import {
  failOnCiWhenKeychainMissing,
  nativeCredentialStoreLaunch,
  selectedStorageBackend,
} from '../helpers/e2eApp';

/**
 * GAP 3 — Secrets vault round-trip across relaunch.
 *
 * Spin up an auth-enabled `mongodb-memory-server`, create a SCRAM-authed
 * connection, persist the password through `safeStorage`, close the app, and
 * relaunch on the same userData. The second `mongo.connect` must succeed —
 * which only happens if the encrypted password was decrypted from cold
 * SQLite storage and used to authenticate.
 *
 * On systems with no usable keychain (Linux without a reachable keyring), the
 * very first `conn.create` with a password throws `SECRETS_UNAVAILABLE`. On a
 * developer machine the test detects that and skips, since the *encrypted*
 * round-trip under test can't be exercised there at all — even though end
 * users on such hosts can opt into the plaintext fallback (see issue #4 + the
 * `secrets.allowPlaintextFallback` pref). On CI the same condition fails the
 * test instead: the "Run E2E" step in `.github/workflows/ci.yml` starts a
 * session keyring on purpose, so its absence means the coverage was lost.
 *
 * Beyond the round-trip, the spec pins two facts a passing round-trip alone
 * would not: on Linux the selected backend is a real keyring (Chromium's
 * `basic_text` fallback "encrypts" with a hardcoded key yet reports success),
 * and the stored row is really ciphertext rather than the password bytes.
 */

async function launchApp(userDataDir: string): Promise<ElectronApplication> {
  return electron.launch({
    ...nativeCredentialStoreLaunch(),
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
        return { skipped: true as const, backend: await selectedStorageBackend(app) };
      }

      expect(result.ok, `conn.create / mongo.connect failed: ${JSON.stringify(result)}`).toBe(true);
      if (result.ok) {
        expect(result.status).toBe('connected');
        connectionId = result.id;
      }

      // A weak backend would also round-trip, so assert it is a real keyring.
      expect(['basic_text', 'unknown']).not.toContain(await selectedStorageBackend(app));
      return { skipped: false as const };
    });

    if (firstLaunchOk.skipped) {
      failOnCiWhenKeychainMissing(firstLaunchOk.backend);
      test.skip(
        true,
        'no usable OS keychain on this host (safeStorage is unavailable)',
      );
      return;
    }

    // --- at rest: the stored row is ciphertext, not the password. ---------
    // The app is closed, so the file is quiescent. `latelier.db` is
    // `DB_FILENAME` in `electron/db/sqlite.ts`; e2e specs spell it out (see
    // create-conn.e2e.ts), so a rename fails here with "unable to open
    // database file".
    const db = new Database(path.join(userDataDir, 'latelier.db'), { readonly: true });
    try {
      const row = db
        .prepare(
          "SELECT ciphertext, is_plaintext FROM connection_secrets WHERE connection_id = ? AND field = 'password'",
        )
        .get(connectionId!) as { ciphertext: Buffer; is_plaintext: number } | undefined;
      expect(row, 'no stored password row for the created connection').toBeDefined();
      expect(row!.is_plaintext).toBe(0);
      expect(row!.ciphertext.length).toBeGreaterThan(0);
      expect(row!.ciphertext.includes(Buffer.from('rootpw'))).toBe(false);
    } finally {
      db.close();
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
