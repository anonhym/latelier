import { test, expect } from '@playwright/test';
import {
  baseConnInput,
  startMemoryServer,
  stopAllMemoryServers,
  withApp,
} from '../helpers/e2eApp';

test.afterAll(stopAllMemoryServers);

/**
 * GAP 11 — `saved.*` and `recent.*` channels work end-to-end through the
 * preload. Both Zod schemas accept enum-typed `kind` values that the
 * renderer is required to send; a drift between TS types and the handler's
 * Zod schema (the historical failure mode for these channels) would fail
 * silently in a unit test and only surface here.
 *
 * `query.find` writes a recent-query row; this test asserts the round-trip
 * through `recent.list`.
 */
test('saved.create / saved.list and recent auto-record after query.find', async () => {
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
            doc: { insert: (input: unknown) => Promise<unknown> };
            query: {
              find: (input: unknown) => Promise<{
                documents: unknown[];
                durationMs: number;
                hasMore: boolean;
              }>;
            };
            saved: {
              create: (input: unknown) => Promise<{ id: string; name: string }>;
              list: (input: unknown) => Promise<Array<{ id: string; name: string; kind: string }>>;
              get: (input: { id: string }) => Promise<{ id: string; payload: unknown }>;
              delete: (input: { id: string }) => Promise<void>;
            };
            recent: {
              list: (input: unknown) => Promise<
                Array<{ id: string; kind: string; resultCount?: number }>
              >;
            };
          };
        }).atelier;

        const created = await api.conn.create({ ...conn, host, port });
        await api.mongo.connect(created.id);

        const dbName = 'saved_recent';
        const collection = 'docs';
        await api.doc.insert({
          connectionId: created.id,
          dbName,
          collection,
          docJson: '{"a":1}',
        });
        await api.doc.insert({
          connectionId: created.id,
          dbName,
          collection,
          docJson: '{"a":2}',
        });

        // ─── recent.* ────────────────────────────────────────────────────
        // Run a find — service should record a recent entry asynchronously.
        await api.query.find({
          connectionId: created.id,
          dbName,
          collection,
          filter: '{"a":1}',
          limit: 10,
          skip: 0,
        });
        // Recent recording is fire-and-forget; poll until it lands rather
        // than relying on a fixed sleep (CI under load can need more than
        // 100 ms before the SQLite write commits).
        let recents: Array<{ id: string; kind: string; resultCount?: number }> = [];
        for (let i = 0; i < 20; i++) {
          recents = await api.recent.list({
            connectionId: created.id,
            dbName,
            collection,
          });
          if (recents.length > 0) break;
          await new Promise((r) => setTimeout(r, 50));
        }

        // ─── saved.* ─────────────────────────────────────────────────────
        // Create + list + get + delete to exercise the full surface.
        const savedFind = await api.saved.create({
          connectionId: created.id,
          dbName,
          collection,
          kind: 'find',
          name: 'recent matches',
          payload: {
            kind: 'find',
            builder: {
              conditions: [],
              logic: 'AND',
              projection: [],
              sort: '',
              limit: '50',
            },
            queryRaw: '{"a":1}',
          },
        });
        const savedList = await api.saved.list({
          connectionId: created.id,
          dbName,
          collection,
          kind: 'find',
        });
        const fetched = await api.saved.get({ id: savedFind.id });
        await api.saved.delete({ id: savedFind.id });
        const listAfterDelete = await api.saved.list({
          connectionId: created.id,
          dbName,
          collection,
          kind: 'find',
        });

        return { recents, savedFind, savedList, fetched, listAfterDelete };
      },
      { host, port, conn: baseConnInput(host, port) },
    );

    // ─── recent.* assertions ───────────────────────────────────────────
    expect(Array.isArray(result.recents)).toBe(true);
    expect(result.recents.length).toBeGreaterThan(0);
    const recent = result.recents[0]!;
    expect(recent.kind).toBe('find');
    // The find returned 1 doc; recent should record that.
    expect(recent.resultCount).toBe(1);

    // ─── saved.* assertions ────────────────────────────────────────────
    expect(result.savedFind.name).toBe('recent matches');
    expect(typeof result.savedFind.id).toBe('string');

    const summary = result.savedList.find((s) => s.id === result.savedFind.id);
    expect(summary).toBeTruthy();
    expect(summary?.kind).toBe('find');

    expect(result.fetched.id).toBe(result.savedFind.id);
    // Payload must round-trip the kind discriminator — a Zod schema regression
    // that drops the inner `kind` would surface here.
    expect((result.fetched.payload as { kind?: string }).kind).toBe('find');

    expect(result.listAfterDelete.find((s) => s.id === result.savedFind.id)).toBeUndefined();
  });
});
