import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { MongoMemoryServer } from 'mongodb-memory-server';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Reproduces the C11 + C12 recovery flow against a real Mongo:
 *
 *   1. Probe with TLS on against a non-TLS server  → fails.
 *   2. Probe with TLS off (the retry handler's effect) → succeeds.
 *
 * Drives the IPC bridge directly so the test fails fast if the
 * `api.conn.test` contract changes; the component tests cover the UI.
 */
test('connect-fails-then-succeeds via api.conn.test', async () => {
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

    const result = await win.evaluate(
      async ({ host, port }) => {
        const api = (window as unknown as {
          atelier: {
            conn: {
              test: (input: unknown) => Promise<{
                ok: boolean;
                errorCode?: string;
                errorMessage?: string;
              }>;
            };
          };
        }).atelier;

        const baseInput = {
          name: 'Retry Target',
          color: '#1A6835',
          connectionType: 'standard',
          host,
          port,
          authMech: 'none',
          advanced: {
            connectTimeoutMs: 3000,
            socketTimeoutMs: 3000,
            serverSelectionTimeoutMs: 3000,
            readPreference: 'primary',
            maxPoolSize: 5,
            directConnection: true,
          },
        };

        // Step 1: TLS on against a non-TLS server.
        const fail = await api.conn.test({
          ...baseInput,
          tls: { enabled: true, verify: true },
        });

        // Step 2: same input, TLS flipped off (the retry handler's effect).
        const ok = await api.conn.test({
          ...baseInput,
          tls: { enabled: false, verify: true },
        });

        return { fail, ok };
      },
      { host, port },
    );

    // First probe must fail. We don't pin the exact error code because the
    // driver wraps handshake failures inconsistently — we just require that
    // the failure shape is recognisable to the C11 docker-tls recipe (one of
    // TLS_HANDSHAKE / TIMEOUT / NETWORK).
    expect(result.fail.ok).toBe(false);
    expect(['TLS_HANDSHAKE', 'TIMEOUT', 'NETWORK']).toContain(result.fail.errorCode);

    // Second probe must succeed.
    expect(result.ok.ok).toBe(true);
  } finally {
    await app.close();
    await mongoServer.stop();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
