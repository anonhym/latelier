import { test, expect } from '@playwright/test';
import {
  baseConnInput,
  startMemoryServer,
  stopAllMemoryServers,
  withApp,
} from '../helpers/e2eApp';

test.afterAll(stopAllMemoryServers);

/**
 * GAP 10 — `script.run` and `script.cancel` over the real preload.
 *
 * The `ScriptService` is 393 LOC and handler-tested at integration level
 * with a fake pool — the preload contract (Zod `ScriptRunInput`, the cancel
 * token UUID round-trip, the `valueJson` EJSON safe-encode) has never
 * crossed the contextBridge in a test.
 *
 * Two scenarios:
 *   (a) Happy path — `1 + 2` returns `valueJson: "3"`.
 *   (b) Cancel — start a long-sleeping script, fire `script.cancel` with
 *       the same token, assert the call rejects with a recognisable error.
 */
test('script.run returns valueJson; script.cancel aborts an in-flight run', async () => {
  const { host, port } = await startMemoryServer();
  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    const result = await win.evaluate(
      async ({ host, port, conn }) => {
        const api = (window as unknown as {
          atelier: {
            conn: { create: (input: unknown) => Promise<{ id: string }> };
            mongo: { connect: (id: string) => Promise<{ status: string }> };
            script: {
              run: (input: {
                connectionId: string;
                dbName?: string;
                source: string;
                cancelToken?: string;
                maxTimeMs?: number;
              }) => Promise<{ valueJson: string | null; printBuffer: string; durationMs: number }>;
              cancel: (input: { token: string }) => Promise<void>;
            };
          };
        }).atelier;

        const created = await api.conn.create({ ...conn, host, port });
        await api.mongo.connect(created.id);

        // (a) Happy path — pure JS, no Mongo.
        const happy = await api.script.run({
          connectionId: created.id,
          source: '1 + 2',
        });

        // Also exercise a print() so printBuffer round-trips.
        const printed = await api.script.run({
          connectionId: created.id,
          source: 'print("hello"); 42',
        });

        // (b) Cancel — fire repeated cancels until the run rejects. There's
        // no observable signal that the script has registered in the main
        // process's `active` Map, so we retry to handle the race where a
        // single cancel arrives before registration. Each iteration is
        // bounded; the in-flight script sleeps 10 s so it stays cancelable.
        const cancelToken = (
          window.crypto?.randomUUID?.() ?? `cancel-${Date.now()}-${Math.random()}`
        );
        const runPromise = api.script
          .run({
            connectionId: created.id,
            source: 'await new Promise((r) => setTimeout(r, 10000)); 1',
            cancelToken,
            maxTimeMs: 30000,
          })
          .then((value) => ({ rejected: false as const, value }))
          .catch((e: { code?: string; message?: string }) => ({
            rejected: true as const,
            error: e,
          }));

        let settled: Awaited<typeof runPromise> | null = null;
        for (let i = 0; i < 20 && !settled; i++) {
          await new Promise((r) => setTimeout(r, 50));
          await api.script.cancel({ token: cancelToken }).catch(() => {});
          settled = await Promise.race([
            runPromise,
            new Promise<null>((r) => setTimeout(() => r(null), 50)),
          ]);
        }

        return { happy, printed, settled };
      },
      { host, port, conn: baseConnInput(host, port) },
    );

    // Happy path: `1 + 2` → valueJson "3" (canonical EJSON).
    expect(result.happy.valueJson).toBe('3');
    expect(typeof result.happy.durationMs).toBe('number');
    expect(result.happy.printBuffer).toBe('');

    // print() captured.
    expect(result.printed.printBuffer).toContain('hello');
    expect(result.printed.valueJson).toBe('42');

    // Cancellation surfaced as a structured IpcError. Code is internal-
    // policy — we don't pin it to a specific value because the service may
    // map cancel→TIMEOUT or cancel→INTERNAL depending on how the abort
    // signal beats the wallClock race. The test's value is "the cancel got
    // through and the run rejected", not which exact code it produced.
    expect(result.settled, 'in-flight script never settled after repeated cancels').not.toBeNull();
    expect(result.settled?.rejected).toBe(true);
    if (result.settled?.rejected) {
      expect(typeof result.settled.error.code).toBe('string');
      expect(typeof result.settled.error.message).toBe('string');
    }
  });
});
