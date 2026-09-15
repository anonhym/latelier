import { test, expect } from '@playwright/test';
import {
  baseConnInput,
  startMemoryServer,
  stopAllMemoryServers,
  withApp,
} from '../helpers/e2eApp';

test.afterAll(stopAllMemoryServers);

/**
 * GAP 7 — `mongo.onStatus` push channel.
 *
 * The only way the renderer learns a connection went online/offline is the
 * `mongo:status-event` push channel; everything else (sidebar pill, navigator
 * gating, reconnect banner) reads from these events. A regression that
 * renames the channel, drops `webContents.send` after the renderer loads,
 * or breaks the preload's `ipcRenderer.on` wrapper would leave the UI silent
 * with no test coverage signalling it. This test subscribes before connect,
 * collects events, then unsubscribes and asserts disconnect events stop.
 */
test('mongo.onStatus delivers connect events; unsubscribe stops the stream', async () => {
  const { host, port } = await startMemoryServer();
  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    const observed = await win.evaluate(
      async ({ host, port, conn }) => {
        const api = (window as unknown as {
          atelier: {
            conn: { create: (input: unknown) => Promise<{ id: string }> };
            mongo: {
              connect: (id: string) => Promise<{ status: string }>;
              disconnect: (id: string) => Promise<{ id: string }>;
              onStatus: (cb: (runtime: { id: string; status: string }) => void) => () => void;
            };
          };
        }).atelier;

        const created = await api.conn.create({ ...conn, host, port });

        // Subscribe BEFORE connect so the 'connecting' / 'connected' events
        // are observable at the boundary.
        const events: Array<{ id: string; status: string }> = [];
        const unsub = api.mongo.onStatus((runtime) => events.push(runtime));

        await api.mongo.connect(created.id);
        // Drain the event queue — events are sent on a microtask.
        await new Promise((r) => setTimeout(r, 100));
        const eventsAfterConnect = events.slice();

        unsub();

        // Disconnect after unsubscribe. Any new push events must NOT land in
        // our buffer — the listener was removed.
        await api.mongo.disconnect(created.id);
        await new Promise((r) => setTimeout(r, 100));

        return {
          id: created.id,
          eventsAfterConnect,
          eventsAfterUnsub: events.slice(),
        };
      },
      { host, port, conn: baseConnInput(host, port) },
    );

    // At least one 'connected' event must have arrived before unsubscribe.
    // We don't pin the count or whether 'connecting' was emitted because
    // the timing of the first event vs. the IPC `connect` resolution is
    // not strictly defined — the contract is "the renderer sees the final
    // state via this channel."
    expect(observed.eventsAfterConnect.length).toBeGreaterThan(0);
    expect(observed.eventsAfterConnect.every((e) => e.id === observed.id)).toBe(true);
    expect(observed.eventsAfterConnect.some((e) => e.status === 'connected')).toBe(true);

    // Critical: unsubscribe stops the stream. If unsubscribe leaks (a common
    // ipcRenderer pitfall), the disconnect event arrives in our buffer and
    // this fails.
    expect(observed.eventsAfterUnsub.length).toBe(observed.eventsAfterConnect.length);
  });
});
