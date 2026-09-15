import { test, expect } from '@playwright/test';
import {
  baseConnInput,
  startMemoryServer,
  stopAllMemoryServers,
  withApp,
} from '../helpers/e2eApp';

test.afterAll(stopAllMemoryServers);

/**
 * GAP 8 — `agg.run`, `agg.runAndSave`, `agg.explain` over the real preload.
 *
 * The aggregation service is the largest in the codebase (~460 LOC) and is
 * exercised today only at the integration layer (no preload, no
 * contextBridge). Preload's `parseAggResult` does its own `JSON.parse` on
 * `rowsJson` — distinct from `parseFindResult` and tested by neither. A
 * Zod schema drift in `electron/ipc/handlers/agg.ts`, an EJSON encoder
 * regression on rows, or a `writeStageOmitted` regression in explain
 * would all be invisible to existing tests.
 */
test('agg.run + runAndSave + explain via preload', async () => {
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
              count: (input: unknown) => Promise<{ count: number }>;
              find: (input: unknown) => Promise<{ documents: unknown[] }>;
            };
            agg: {
              run: (input: unknown) => Promise<{
                rows: unknown[];
                durationMs: number;
                stageCounts: Record<number, number>;
                hasMore: boolean;
              }>;
              runAndSave: (input: unknown) => Promise<{
                rows: unknown[];
                writtenCount?: number;
              }>;
              explain: (input: unknown) => Promise<{
                plan: unknown;
                verbosity: string;
                writeStageOmitted: boolean;
              }>;
            };
          };
        }).atelier;

        const created = await api.conn.create({ ...conn, host, port });
        await api.mongo.connect(created.id);

        const dbName = 'agg_e2e';
        const src = 'orders';
        const dest = 'totals';

        // Seed five docs across two accounts.
        const seed = [
          { account: 'a', amount: 100, posted: true },
          { account: 'a', amount: 50, posted: true },
          { account: 'b', amount: 75, posted: true },
          { account: 'b', amount: 40, posted: false },
          { account: 'c', amount: 10, posted: true },
        ];
        for (const s of seed) {
          await api.doc.insert({
            connectionId: created.id,
            dbName,
            collection: src,
            docJson: JSON.stringify(s),
          });
        }

        const matchGroupSort = [
          { id: 1, op: '$match', body: '{"posted":true}', enabled: true },
          {
            id: 2,
            op: '$group',
            body: '{"_id":"$account","total":{"$sum":"$amount"}}',
            enabled: true,
          },
          { id: 3, op: '$sort', body: '{"total":-1}', enabled: true },
        ];

        // ─── agg.run ─────────────────────────────────────────────────────
        const runOut = await api.agg.run({
          connectionId: created.id,
          dbName,
          collection: src,
          stages: matchGroupSort,
        });

        // ─── agg.runAndSave ($out → dest) ────────────────────────────────
        // The service appends the $out stage from `target`; passing it in
        // `stages` would duplicate. Mirrors AggregationService.runAndSave.
        const runSaveOut = await api.agg.runAndSave({
          connectionId: created.id,
          dbName,
          collection: src,
          stages: matchGroupSort,
          target: { dbName, collection: dest, mode: '$out' },
        });
        const destCount = await api.query.count({
          connectionId: created.id,
          dbName,
          collection: dest,
          filter: '{}',
        });

        // ─── agg.explain (write stage stripped by the service) ────────────
        // Explicitly include $out so we can assert writeStageOmitted: true.
        const explainStages = [
          ...matchGroupSort,
          { id: 4, op: '$out', body: `"${dest}"`, enabled: true },
        ];
        const explainOut = await api.agg.explain({
          connectionId: created.id,
          dbName,
          collection: src,
          stages: explainStages,
          verbosity: 'queryPlanner',
        });

        return { runOut, runSaveOut, destCount, explainOut };
      },
      { host, port, conn: baseConnInput(host, port) },
    );

    // run() returns parsed rows; should have one row per posted account
    // (a, b, c). $sort by total descending → a (150) > b (75) > c (10).
    // Numbers come back EJSON-encoded (canonical), so `total` is wrapped as
    // `{$numberInt: "150"}` or `{$numberLong: "150"}` depending on driver.
    expect(result.runOut.rows).toHaveLength(3);
    const firstRow = result.runOut.rows[0] as {
      _id: string;
      total: number | { $numberInt?: string; $numberLong?: string; $numberDouble?: string };
    };
    expect(firstRow._id).toBe('a');
    const asNumber = (v: typeof firstRow.total): number => {
      if (typeof v === 'number') return v;
      const s = v.$numberInt ?? v.$numberLong ?? v.$numberDouble;
      if (typeof s !== 'string') throw new Error(`bad number: ${JSON.stringify(v)}`);
      return Number(s);
    };
    expect(asNumber(firstRow.total)).toBe(150);
    // stageCounts populated for every enabled stage (instrumentation).
    expect(Object.keys(result.runOut.stageCounts)).toHaveLength(3);
    expect(result.runOut.stageCounts[1]).toBe(4); // posted:true survivors
    expect(result.runOut.stageCounts[2]).toBe(3); // groups
    expect(typeof result.runOut.durationMs).toBe('number');

    // runAndSave wrote 3 group docs to `dest`. `writtenCount` may be set or
    // omitted depending on how the service classifies the write — assert
    // existence of the key OR that the dest collection actually has 3 docs.
    expect(result.destCount.count).toBe(3);

    // explain returns a plan + flags the stripped write stage.
    expect(result.explainOut.verbosity).toBe('queryPlanner');
    expect(result.explainOut.plan).toBeTruthy();
    expect(result.explainOut.writeStageOmitted).toBe(true);
  });
});
