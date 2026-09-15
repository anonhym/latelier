import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { MongoClient } from 'mongodb';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { ScriptService } from '../../electron/services/ScriptService';
import { MongoPool } from '../../electron/mongo/MongoPool';
import { SecretsVault } from '../../electron/secrets/SecretsVault';
import { AppError, ReadOnlyConnectionError } from '../../electron/errors';
import { createSafeStorageMock } from '../helpers/safeStorageMock';
import { createTempDb, type TempDb } from '../helpers/db';
import {
  getSharedServer,
  stopSharedServer,
  uriToHostPort,
  makeConnection,
  makeReader,
} from '../helpers/mongo';

/** Sleep that rejects on abort, used to simulate slow driver ops. */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('aborted');
      (err as { name: string }).name = 'AbortError';
      reject(err);
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        const err = new Error('aborted');
        (err as { name: string }).name = 'AbortError';
        reject(err);
      },
      { once: true },
    );
  });
}

/**
 * Fake MongoClient — only the surface the script tests exercise.
 */
function fakeClient(): MongoClient {
  return {
    db(name?: string) {
      const dbName = name ?? 'test';
      return {
        databaseName: dbName,
        command: async () => ({ ok: 1, db: dbName }),
        listCollections: () => ({
          toArray: async () => [{ name: 'users' }, { name: 'orders' }],
        }),
        collection: (cn: string) => ({
          findOne: async () => ({ _id: 'x', name: cn, value: 42 }),
          countDocuments: async (
            _filter?: unknown,
            opts?: { signal?: AbortSignal },
          ) => {
            // Simulate a slow op so cancel/timeout tests can interrupt.
            if (opts?.signal) {
              await new Promise<void>((resolve, reject) => {
                const t = setTimeout(resolve, 200);
                opts.signal!.addEventListener(
                  'abort',
                  () => {
                    clearTimeout(t);
                    const err = new Error('aborted');
                    (err as { name: string }).name = 'AbortError';
                    reject(err);
                  },
                  { once: true },
                );
              });
            }
            return 7;
          },
          find: (_filter?: unknown, opts?: { signal?: AbortSignal }) => {
            // Capture the signal that the driver/cursor would normally hold,
            // and surface it back through `toArray`/`forEach` so the
            // wrapper's behaviour can be observed in tests.
            const collSignal = opts?.signal;
            return {
              // Cursor-shaping methods return `this` so the chain stays alive.
              sort() {
                return this;
              },
              limit() {
                return this;
              },
              project() {
                return this;
              },
              toArray: async (cursorOpts?: { signal?: AbortSignal }) => {
                const sig = cursorOpts?.signal ?? collSignal;
                if (sig) {
                  await abortableSleep(200, sig);
                }
                return [{ _id: 'a', __sigSeen: !!sig }, { _id: 'b' }];
              },
              forEach: async (
                cb: (doc: unknown) => void,
                cursorOpts?: { signal?: AbortSignal },
              ) => {
                const sig = cursorOpts?.signal ?? collSignal;
                if (sig) {
                  await abortableSleep(200, sig);
                }
                cb({ _id: 'a', __sigSeen: !!sig });
              },
              next: async (cursorOpts?: { signal?: AbortSignal }) => {
                const sig = cursorOpts?.signal ?? collSignal;
                if (sig) {
                  await abortableSleep(200, sig);
                }
                return { _id: 'a', __sigSeen: !!sig };
              },
            };
          },
        }),
      } as unknown;
    },
  } as unknown as MongoClient;
}

function fakePool(client: MongoClient): MongoPool {
  return {
    readClient: async () => client,
    isReadOnly: () => false,
  } as unknown as MongoPool;
}

/**
 * Pool whose `readClient` never resolves on its own, but rejects when the
 * caller's cancel token aborts. This models a network hang during connect.
 */
function hangingPool(): { pool: MongoPool; abortGetClient: () => void } {
  let externalAbort: () => void = () => {};
  const pool = {
    readClient: () =>
      new Promise<MongoClient>((_, reject) => {
        externalAbort = () => {
          const err = new Error('aborted');
          (err as { name: string }).name = 'AbortError';
          reject(err);
        };
      }),
  } as unknown as MongoPool;
  return { pool, abortGetClient: () => externalAbort() };
}

describe('ScriptService', () => {
  it('captures the last expression as the result', async () => {
    const svc = new ScriptService({ pool: fakePool(fakeClient()) });
    const r = await svc.run({
      connectionId: 'c1',
      source: '1 + 2',
    });
    expect(r.valueJson).toBe('3');
    expect(r.printBuffer).toBe('');
  });

  it('returns null valueJson when the last statement is not an expression', async () => {
    const svc = new ScriptService({ pool: fakePool(fakeClient()) });
    const r = await svc.run({
      connectionId: 'c1',
      source: 'const x = 5;',
    });
    expect(r.valueJson).toBeNull();
  });

  it('supports top-level await', async () => {
    const svc = new ScriptService({ pool: fakePool(fakeClient()) });
    const r = await svc.run({
      connectionId: 'c1',
      source: 'await db.runCommand({ ping: 1 })',
    });
    // valueJson is canonical EJSON, so numbers come back wrapped.
    const value = JSON.parse(r.valueJson!);
    expect(value.ok.$numberInt).toBe('1');
    expect(value.db).toBe('test');
  });

  it('respects dbName override', async () => {
    const svc = new ScriptService({ pool: fakePool(fakeClient()) });
    const r = await svc.run({
      connectionId: 'c1',
      dbName: 'prod',
      source: 'await db.runCommand({ ping: 1 })',
    });
    const value = JSON.parse(r.valueJson!);
    expect(value.db).toBe('prod');
  });

  it('captures print() output', async () => {
    const svc = new ScriptService({ pool: fakePool(fakeClient()) });
    const r = await svc.run({
      connectionId: 'c1',
      source: 'print("hello", "world"); 42',
    });
    expect(r.printBuffer).toContain('hello world');
    // Plain primitives (numbers/booleans/strings) bypass EJSON wrapping.
    expect(r.valueJson).toBe('42');
  });

  it('caps the print buffer at ~64 KB', async () => {
    const svc = new ScriptService({ pool: fakePool(fakeClient()) });
    const r = await svc.run({
      connectionId: 'c1',
      source: 'for (let i = 0; i < 10000; i++) print("x".repeat(100));',
      maxTimeMs: 5000,
    });
    expect(r.printBuffer.length).toBeLessThanOrEqual(64 * 1024);
  });

  it('throws ValidationError on syntax errors', async () => {
    const svc = new ScriptService({ pool: fakePool(fakeClient()) });
    await expect(
      svc.run({
        connectionId: 'c1',
        source: 'const x = ;',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('enforces maxTimeMs on a CPU-bound runaway', async () => {
    const svc = new ScriptService({ pool: fakePool(fakeClient()) });
    const t0 = Date.now();
    await expect(
      svc.run({
        connectionId: 'c1',
        source: 'while (true) {}',
        maxTimeMs: 200,
      }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    // Should kill within a reasonable margin of the limit.
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('cancel(token) aborts an in-flight driver-bound script', async () => {
    const svc = new ScriptService({ pool: fakePool(fakeClient()) });
    const token = 'tok-1';
    const promise = svc.run({
      connectionId: 'c1',
      source: 'await db.users.countDocuments({})',
      cancelToken: token,
    });
    // Cancel after a tick — the fake's countDocuments waits 200ms with the
    // signal it received from the auto-thread.
    setTimeout(() => svc.cancel(token), 20);
    await expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('round-trips an array of documents through EJSON', async () => {
    const svc = new ScriptService({ pool: fakePool(fakeClient()) });
    const r = await svc.run({
      connectionId: 'c1',
      source: 'await db.users.find().toArray()',
    });
    const docs = JSON.parse(r.valueJson!);
    expect(Array.isArray(docs)).toBe(true);
    expect(docs).toHaveLength(2);
    expect(docs[0]._id).toBe('a');
  });

  it('the AppError thrown carries a stable code', async () => {
    const svc = new ScriptService({ pool: fakePool(fakeClient()) });
    let caught: unknown;
    try {
      await svc.run({ connectionId: 'c1', source: 'throw new Error("boom")' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AppError);
  });

  // ── Regression tests for reviewer feedback ─────────────────────────────

  it('cancel(token) aborts a script even while the pool connect is hung', async () => {
    // Repro: token-during-connect — register the controller before
    // awaiting `pool.readClient`, otherwise `cancel(token)` finds nothing
    // in `active` and the run is uncancelable.
    const { pool, abortGetClient } = hangingPool();
    const svc = new ScriptService({ pool });
    const token = 'tok-hang';
    const promise = svc.run({
      connectionId: 'c1',
      source: '1 + 1',
      cancelToken: token,
    });
    // After a tick, fire the cancel. The hung connect's promise rejects
    // (modelling the driver responding to abort) and the run surfaces
    // a TIMEOUT error.
    setTimeout(() => {
      svc.cancel(token);
      abortGetClient();
    }, 20);
    await expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('wall-clock timeout fires for an async hang that vm.timeout cannot catch', async () => {
    // Repro: vm `timeout` only catches sync CPU runaways. An async wait
    // on a never-resolving promise (or an async loop awaiting a slow op
    // that ignores the signal) would hang `await result` forever
    // without the wall-clock race.
    //
    // We use `new Promise(() => {})` rather than `while (true) await
    // Promise.resolve()` because the latter would churn microtasks
    // forever and prevent the worker from exiting after the assertion.
    const svc = new ScriptService({ pool: fakePool(fakeClient()) });
    const t0 = Date.now();
    await expect(
      svc.run({
        connectionId: 'c1',
        source: 'await new Promise(() => {})',
        maxTimeMs: 200,
      }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('cancel() reaches cursor.toArray() through the wrapped cursor', async () => {
    // Repro: prior wrapCollection only threaded signal into the
    // collection method; .toArray() ran uncancelable. With cursor
    // wrapping, the signal flows through.
    const svc = new ScriptService({ pool: fakePool(fakeClient()) });
    const token = 'tok-cursor';
    const promise = svc.run({
      connectionId: 'c1',
      source: 'await db.users.find().toArray()',
      cancelToken: token,
    });
    setTimeout(() => svc.cancel(token), 20);
    await expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('cancel() reaches cursor.forEach() through the wrapped cursor', async () => {
    const svc = new ScriptService({ pool: fakePool(fakeClient()) });
    const token = 'tok-foreach';
    const promise = svc.run({
      connectionId: 'c1',
      source: 'await db.users.find().forEach(() => {})',
      cancelToken: token,
    });
    setTimeout(() => svc.cancel(token), 20);
    await expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('cancel() reaches cursor.next() after sort/limit chaining', async () => {
    // Cursor-shaping methods return `this`; the wrapper must keep the
    // signal threaded across the chain.
    const svc = new ScriptService({ pool: fakePool(fakeClient()) });
    const token = 'tok-chain';
    const promise = svc.run({
      connectionId: 'c1',
      source: 'await db.users.find().sort({ _id: 1 }).limit(10).next()',
      cancelToken: token,
    });
    setTimeout(() => svc.cancel(token), 20);
    await expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('signal threads into cursor.toArray() even when find() is called with no args', async () => {
    // Repro: prior `args.length === positional` rejected `find()` (0
    // args, positional=1). With padded positionals, `find()` still
    // gets the signal, and so do its cursor terminals.
    const svc = new ScriptService({ pool: fakePool(fakeClient()) });
    const token = 'tok-no-args';
    const promise = svc.run({
      connectionId: 'c1',
      source: 'await db.users.find().toArray()',
      cancelToken: token,
    });
    setTimeout(() => svc.cancel(token), 20);
    await expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('cancel() works on countDocuments() called with zero args', async () => {
    // Same family as above but for a non-cursor-returning method.
    const svc = new ScriptService({ pool: fakePool(fakeClient()) });
    const token = 'tok-count-no-args';
    const promise = svc.run({
      connectionId: 'c1',
      source: 'await db.users.countDocuments()',
      cancelToken: token,
    });
    setTimeout(() => svc.cancel(token), 20);
    await expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('reports SyntaxError line numbers that match the user source', async () => {
    // Repro: the IIFE wrapper shifts every line by +1. Line 2 in the
    // user's source must report as `script.js:2`, not `script.js:3`.
    const svc = new ScriptService({ pool: fakePool(fakeClient()) });
    let caught: { code: string; message: string } | undefined;
    try {
      await svc.run({
        connectionId: 'c1',
        // `const x = ;` is on line 1; expect `script.js:1` — never
        // `script.js:2` (the wrapper would put it there).
        source: 'const x = ;',
      });
    } catch (e) {
      caught = e as { code: string; message: string };
    }
    expect(caught?.code).toBe('VALIDATION');
    expect(caught?.message).not.toMatch(/script\.js:2\b/);
  });

  it('reports runtime stack lines that match the user source', async () => {
    // Line 3 of the user's source throws; the surfaced stack/message
    // should reference line 3, not line 4.
    const svc = new ScriptService({ pool: fakePool(fakeClient()) });
    let caught: { code: string; message: string; stack?: string } | undefined;
    try {
      await svc.run({
        connectionId: 'c1',
        source: ['const a = 1;', 'const b = 2;', 'throw new Error("boom")'].join('\n'),
      });
    } catch (e) {
      caught = e as { code: string; message: string; stack?: string };
    }
    expect(caught).toBeDefined();
    const blob = `${caught?.message ?? ''}\n${caught?.stack ?? ''}`;
    // Wrapper-shifted line number is +1 — it must NOT appear.
    expect(blob).not.toMatch(/script\.js:4\b/);
  });

  // ── Fuzz-found bug 1: shared cancelToken orphans the earlier run ──────
  // A duplicate cancelToken used to silently overwrite the first run's
  // AbortController in `active`, so `cancel(token)` only ever reached the
  // second run — the first ran to completion uncancelable. The fix rejects
  // a `run()` call whose token is already registered, instead of clobbering
  // the earlier controller.

  it('rejects run() with a cancelToken that is already in flight, instead of orphaning the earlier run', async () => {
    const svc = new ScriptService({ pool: fakePool(fakeClient()) });
    const token = 'dup-token';
    const runA = svc.run({
      connectionId: 'c1',
      // Fake driver call waits 200ms and honors the AbortSignal.
      source: 'await db.users.countDocuments({})',
      cancelToken: token,
    });
    // Let run A register its controller before run B reuses the token.
    await new Promise((r) => setImmediate(r));

    await expect(
      svc.run({ connectionId: 'c1', source: '1 + 1', cancelToken: token }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // The token was never orphaned — cancel() still reaches run A.
    svc.cancel(token);
    await expect(runA).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('frees a cancelToken for reuse once the run holding it finishes', async () => {
    const svc = new ScriptService({ pool: fakePool(fakeClient()) });
    const token = 'reuse-token';
    await svc.run({ connectionId: 'c1', source: '1 + 1', cancelToken: token });
    // `finally` deletes the token on completion — a second run may reuse it.
    const r = await svc.run({ connectionId: 'c1', source: '2 + 2', cancelToken: token });
    expect(r.valueJson).toBe('4');
  });

  it('two different cancelTokens cancel independently (adjacent-case regression)', async () => {
    const svc = new ScriptService({ pool: fakePool(fakeClient()) });
    const pA = svc.run({
      connectionId: 'c1',
      source: 'await db.users.countDocuments({})',
      cancelToken: 'tok-indep-a',
    });
    const pB = svc.run({
      connectionId: 'c1',
      source: 'await db.users.countDocuments({})',
      cancelToken: 'tok-indep-b',
    });
    await new Promise((r) => setImmediate(r));
    svc.cancel('tok-indep-a');
    await expect(pA).rejects.toMatchObject({ code: 'TIMEOUT' });
    // B was never cancelled — it completes normally.
    const rB = await pB;
    expect(rB.valueJson).toBe('7');
  });

  // ── P1 review regression: cancel-then-immediate-reuse re-orphans a run ──
  // cancel(token) used to delete the map entry immediately. A same-token
  // run() fired right after would then see the token as free, start, and
  // get its own controller silently destroyed when the *first* run's
  // `finally` unconditionally deleted whatever was in the map for that
  // token by then. The fix keeps the entry until its owning run's own
  // cleanup removes it, so a same-token run() right after cancel() still
  // sees the token as in-use (CONFLICT) until the cancelled run actually
  // finishes.

  it('rejects a same-token run() fired immediately after cancel(), until the cancelled run actually finishes', async () => {
    const svc = new ScriptService({ pool: fakePool(fakeClient()) });
    const token = 'cancel-then-reuse-token';

    const runA = svc.run({
      connectionId: 'c1',
      source: 'await db.users.countDocuments({})',
      cancelToken: token,
    });
    // Let run A register its controller before cancel/reuse.
    await new Promise((r) => setImmediate(r));

    svc.cancel(token);

    // Immediately reuse the token, before run A's own `finally` has run.
    // The token is still legitimately held by A — this must be rejected,
    // not allowed to start and later be silently destroyed by A's cleanup.
    await expect(
      svc.run({ connectionId: 'c1', source: '1 + 1', cancelToken: token }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // Let run A's own cleanup settle.
    await expect(runA).rejects.toMatchObject({ code: 'TIMEOUT' });

    // Now that A has genuinely finished, the token is reusable.
    const r = await svc.run({ connectionId: 'c1', source: '3 + 3', cancelToken: token });
    expect(r.valueJson).toBe('6');
  });

  // ── Fuzz-found bug 2: unbounded, uncancelable EJSON encode ─────────────
  // `safeEjsonEncodeJson` used to run outside the vm/wall-clock race, so a
  // large-but-under-cap array result could block the single-threaded main
  // process for seconds, independent of maxTimeMs and not stoppable via
  // cancel(). The fix encodes arrays incrementally, checking the same
  // deadline/AbortSignal every batch and yielding to the event loop
  // between batches.

  const LARGE_ARRAY_SOURCE =
    'Array.from({ length: 600000 }, (_, i) => ({ n: i, s: "x" }))';

  it(
    'enforces maxTimeMs during EJSON-encoding of a large result, not just script execution',
    async () => {
      const svc = new ScriptService({ pool: fakePool(fakeClient()) });
      const t0 = Date.now();
      await expect(
        svc.run({
          connectionId: 'c1',
          // Fast to build inside the vm; encoding 600k docs takes far
          // longer than the 300ms budget below.
          source: LARGE_ARRAY_SOURCE,
          maxTimeMs: 300,
        }),
      ).rejects.toMatchObject({ code: 'TIMEOUT' });
      // Must bail out DURING encode, nowhere near the multi-second wall
      // time a full unbounded encode of 600k docs takes. Generous slack
      // for CI, still nothing like "ran to completion".
      expect(Date.now() - t0).toBeLessThan(5000);
    },
    15000,
  );

  it(
    'cancel() stops an in-progress EJSON encode of a large result',
    async () => {
      const svc = new ScriptService({ pool: fakePool(fakeClient()) });
      const token = 'tok-encode-cancel';
      const t0 = Date.now();
      const promise = svc.run({
        connectionId: 'c1',
        source: LARGE_ARRAY_SOURCE,
        cancelToken: token,
        // Large budget — only cancel() should be able to stop this run.
        maxTimeMs: 20000,
      });
      // Give the vm time to finish building the array and enter the
      // encode step, then cancel mid-encode.
      setTimeout(() => svc.cancel(token), 50);
      await expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' });
      expect(Date.now() - t0).toBeLessThan(5000);
    },
    15000,
  );

  it(
    'does not block the event loop for the full duration of encoding a large result',
    async () => {
      const svc = new ScriptService({ pool: fakePool(fakeClient()) });
      let ticks = 0;
      const timer = setInterval(() => {
        ticks++;
      }, 10);
      await svc.run({
        connectionId: 'c1',
        source: LARGE_ARRAY_SOURCE,
        maxTimeMs: 20000,
      });
      clearInterval(timer);
      // A fully-synchronous encode would starve this timer for the whole
      // run — several event-loop ticks proves the main thread was freed
      // up periodically during encoding.
      expect(ticks).toBeGreaterThan(2);
    },
    15000,
  );

  it('a normal small result still encodes fine and fast (adjacent-case regression)', async () => {
    const svc = new ScriptService({ pool: fakePool(fakeClient()) });
    const t0 = Date.now();
    const r = await svc.run({
      connectionId: 'c1',
      source: 'await db.users.find().toArray()',
    });
    expect(Date.now() - t0).toBeLessThan(1000);
    const docs = JSON.parse(r.valueJson!);
    expect(docs).toHaveLength(2);
  });

  it('a script needing close to its full maxTimeMs still completes (adjacent-case regression)', async () => {
    const svc = new ScriptService({ pool: fakePool(fakeClient()) });
    // Fake driver waits 200ms; budget is comfortably above that but far
    // from unlimited.
    const r = await svc.run({
      connectionId: 'c1',
      source: 'await db.users.countDocuments({})',
      maxTimeMs: 1000,
    });
    expect(r.valueJson).toBe('7');
  });
});

// ── Real-cursor behaviour against mongodb-memory-server ───────────────────
// The fakeClient above returns plain objects, not real `AbstractCursor`
// instances, so it can't exercise the cursor auto-iterate path. These
// tests hit a real Mongo so `db.coll.find()` returns a true FindCursor.
describe('ScriptService — real cursor results', () => {
  let server: MongoMemoryServer;
  let hp: { host: string; port: number };
  let tmp: TempDb;
  let pool: MongoPool;

  beforeAll(async () => {
    server = await getSharedServer();
    hp = uriToHostPort(server.getUri());
  }, 60_000);

  afterAll(async () => {
    await stopSharedServer();
  });

  afterEach(async () => {
    if (pool) await pool.disconnectAll();
    tmp?.cleanup();
  });

  function setup(): MongoPool {
    tmp = createTempDb();
    const vault = new SecretsVault(tmp.db, createSafeStorageMock());
    const conn = makeConnection('c1', hp, { defaultDb: 'cursors_test' });
    pool = new MongoPool({ repo: makeReader([conn]), vault });
    return pool;
  }

  it('auto-iterates a bare find() into an array of documents', async () => {
    const svc = new ScriptService({ pool: setup() });
    // Seed three docs first, then run a script whose final expression
    // is a bare `find()` cursor — the prior behaviour returned `null`.
    await svc.run({
      connectionId: 'c1',
      dbName: 'cursors_test',
      source:
        'await db.bare_find.insertMany([{n:1},{n:2},{n:3}]); 1',
    });
    const r = await svc.run({
      connectionId: 'c1',
      dbName: 'cursors_test',
      source: 'db.bare_find.find()',
    });
    const docs = JSON.parse(r.valueJson!);
    expect(Array.isArray(docs)).toBe(true);
    expect(docs).toHaveLength(3);
    // No truncation note for a small result.
    expect(r.printBuffer).not.toMatch(/cursor truncated/);
  });

  it('auto-iterates an aggregation cursor', async () => {
    const svc = new ScriptService({ pool: setup() });
    await svc.run({
      connectionId: 'c1',
      dbName: 'cursors_test',
      source:
        'await db.agg_find.insertMany([{g:"x"},{g:"x"},{g:"y"}]); 1',
    });
    const r = await svc.run({
      connectionId: 'c1',
      dbName: 'cursors_test',
      source:
        'db.agg_find.aggregate([{ $group: { _id: "$g", c: { $sum: 1 } } }])',
      ejsonRelaxed: true,
    });
    const groups = JSON.parse(r.valueJson!) as Array<{ _id: string; c: number }>;
    expect(groups).toHaveLength(2);
    const sorted = groups.slice().sort((a, b) => a._id.localeCompare(b._id));
    expect(sorted[0]).toEqual({ _id: 'x', c: 2 });
    expect(sorted[1]).toEqual({ _id: 'y', c: 1 });
  });

  it('caps a large find() at 50 docs and notes the truncation', async () => {
    const svc = new ScriptService({ pool: setup() });
    // Seed 60 docs so the 50-doc cap kicks in.
    const seed = Array.from({ length: 60 }, (_, i) => `{ n: ${i} }`).join(',');
    await svc.run({
      connectionId: 'c1',
      dbName: 'cursors_test',
      source: `await db.big_find.insertMany([${seed}]); 1`,
    });
    const r = await svc.run({
      connectionId: 'c1',
      dbName: 'cursors_test',
      source: 'db.big_find.find()',
    });
    const docs = JSON.parse(r.valueJson!);
    expect(Array.isArray(docs)).toBe(true);
    expect(docs).toHaveLength(50);
    expect(r.printBuffer).toMatch(/cursor truncated to first 50 documents/);
  });

  it('explicit .toArray() still returns the full result with no truncation note', async () => {
    const svc = new ScriptService({ pool: setup() });
    const seed = Array.from({ length: 60 }, (_, i) => `{ n: ${i} }`).join(',');
    await svc.run({
      connectionId: 'c1',
      dbName: 'cursors_test',
      source: `await db.full_find.insertMany([${seed}]); 1`,
    });
    const r = await svc.run({
      connectionId: 'c1',
      dbName: 'cursors_test',
      source: 'await db.full_find.find().toArray()',
    });
    const docs = JSON.parse(r.valueJson!);
    expect(docs).toHaveLength(60);
    expect(r.printBuffer).not.toMatch(/cursor truncated/);
  });
});

// ── Read-only connection guard (ADR 0005 Bucket C) ────────────────────────
describe('ScriptService — read-only connection', () => {
  let server: MongoMemoryServer;
  let hp: { host: string; port: number };
  let tmp: TempDb;
  let pool: MongoPool;

  beforeAll(async () => {
    server = await getSharedServer();
    hp = uriToHostPort(server.getUri());
  }, 60_000);

  afterAll(async () => {
    await stopSharedServer();
  });

  afterEach(async () => {
    if (pool) await pool.disconnectAll();
    tmp?.cleanup();
  });

  function setup(): MongoPool {
    tmp = createTempDb();
    const vault = new SecretsVault(tmp.db, createSafeStorageMock());
    const ro = makeConnection('ro', hp, { defaultDb: 'script_ro_test', readOnly: true });
    const rw = makeConnection('rw', hp, { defaultDb: 'script_ro_test' });
    pool = new MongoPool({ repo: makeReader([ro, rw]), vault });
    return pool;
  }

  it('reads still work on a read-only connection', async () => {
    const svc = new ScriptService({ pool: setup() });
    await svc.run({
      connectionId: 'rw',
      dbName: 'script_ro_test',
      source: 'await db.ro_reads.insertMany([{n:1},{n:2}]); 1',
    });
    const r = await svc.run({
      connectionId: 'ro',
      dbName: 'script_ro_test',
      source: 'await db.ro_reads.find().toArray()',
    });
    expect(JSON.parse(r.valueJson!)).toHaveLength(2);
  });

  it('a write throws ReadOnlyConnectionError and does not mutate data', async () => {
    const svc = new ScriptService({ pool: setup() });
    await svc.run({
      connectionId: 'rw',
      dbName: 'script_ro_test',
      source: 'await db.ro_writes.insertMany([{n:1}]); 1',
    });
    await expect(
      svc.run({
        connectionId: 'ro',
        dbName: 'script_ro_test',
        source: 'await db.ro_writes.deleteMany({})',
      }),
    ).rejects.toBeInstanceOf(ReadOnlyConnectionError);
    const r = await svc.run({
      connectionId: 'rw',
      dbName: 'script_ro_test',
      source: 'await db.ro_writes.find().toArray()',
    });
    expect(JSON.parse(r.valueJson!)).toHaveLength(1);
  });

  it('an aggregate with $merge/$out throws ReadOnlyConnectionError', async () => {
    const svc = new ScriptService({ pool: setup() });
    await expect(
      svc.run({
        connectionId: 'ro',
        dbName: 'script_ro_test',
        source: "db.ro_writes.aggregate([{ $merge: { into: 'ro_merge_target' } }])",
      }),
    ).rejects.toBeInstanceOf(ReadOnlyConnectionError);
  });

  it('db.dropDatabase() throws ReadOnlyConnectionError', async () => {
    const svc = new ScriptService({ pool: setup() });
    await expect(
      svc.run({ connectionId: 'ro', dbName: 'script_ro_test', source: 'await db.dropDatabase()' }),
    ).rejects.toBeInstanceOf(ReadOnlyConnectionError);
  });

  it('the identical write succeeds on the non-read-only connection (regression)', async () => {
    const svc = new ScriptService({ pool: setup() });
    const r = await svc.run({
      connectionId: 'rw',
      dbName: 'script_ro_test',
      source: 'await db.ro_regress.insertOne({ n: 1 }); 1',
    });
    expect(r.valueJson).toBe('1');
  });

  /**
   * A connectionId whose repo lookup returns writable for its first two
   * calls (the connect handshake, then the script's first write check) and
   * read-only from the third call on — simulating the Connection flipping to
   * read-only partway through an in-flight script, deterministically rather
   * than via a wall-clock race.
   */
  function flippingPool(connId: string): MongoPool {
    tmp = createTempDb();
    const vault = new SecretsVault(tmp.db, createSafeStorageMock());
    const conn = makeConnection(connId, hp, { defaultDb: 'script_flip_test' });
    let calls = 0;
    pool = new MongoPool({
      repo: {
        findById: (id) => (id === connId ? { ...conn, readOnly: ++calls > 2 } : null),
      },
      vault,
    });
    return pool;
  }

  it('a write refused once the connection flips to read-only mid-script, not just at construction', async () => {
    const svc = new ScriptService({ pool: flippingPool('flip') });
    await expect(
      svc.run({
        connectionId: 'flip',
        dbName: 'script_flip_test',
        source: `
          await db.flip_target.insertOne({ n: 1 });
          await db.flip_target.deleteMany({});
        `,
      }),
    ).rejects.toBeInstanceOf(ReadOnlyConnectionError);
    const r = await svc.run({
      connectionId: 'flip',
      dbName: 'script_flip_test',
      source: 'await db.flip_target.find().toArray()',
    });
    // The first write landed; the second (post-flip) one was refused and
    // did not mutate data.
    expect(JSON.parse(r.valueJson!)).toHaveLength(1);
  });

  it('a sibling proxy obtained via getSiblingDB before the flip also refuses a write after it', async () => {
    const svc = new ScriptService({ pool: flippingPool('flip-sibling') });
    await expect(
      svc.run({
        connectionId: 'flip-sibling',
        dbName: 'script_flip_test',
        source: `
          const other = db.getSiblingDB('script_flip_sibling');
          await db.flip_sibling_main.insertOne({ n: 1 });
          await other.flip_sibling_target.deleteMany({});
        `,
      }),
    ).rejects.toBeInstanceOf(ReadOnlyConnectionError);
  });
});
