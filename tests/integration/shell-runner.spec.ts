import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { MongoClient } from 'mongodb';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import type { ShellOutputEvent } from '@shared/types';
import { ShellService } from '../../electron/services/ShellService';
import { MongoPool } from '../../electron/mongo/MongoPool';
import { SecretsVault } from '../../electron/secrets/SecretsVault';
import { createSafeStorageMock } from '../helpers/safeStorageMock';
import { createTempDb, type TempDb } from '../helpers/db';
import { createTestSpawner, type TestSpawner } from '../helpers/runnerSpawner';
import {
  getSharedServer,
  stopSharedServer,
  uriToHostPort,
  makeConnection,
  makeReader,
} from '../helpers/mongo';

/**
 * The shell's REPL runs in a runner child; main holds the client and answers
 * the child's calls. These tests fork the real runner under Node and drive it
 * through the real service against a real mongod.
 */

let server: MongoMemoryServer;
let hp: { host: string; port: number };
let tmp: TempDb | undefined;
let pool: MongoPool | undefined;
let spawner: TestSpawner;
let svc: ShellService | undefined;
let events: ShellOutputEvent[];

beforeAll(async () => {
  server = await getSharedServer();
  hp = uriToHostPort(server.getUri());
}, 60_000);

afterAll(async () => {
  await stopSharedServer();
});

afterEach(async () => {
  // A leaked child would hold vitest open: the assertion runs before cleanup
  // so cleanup cannot hide a leak.
  await svc?.disposeAll();
  await until(async () => spawner.alive().length === 0, 'shell children to die', 3000);
  const leaked = spawner.alive().length;
  svc = undefined;
  spawner.killAll();
  if (pool) await pool.disconnectAll();
  pool = undefined;
  tmp?.cleanup();
  tmp = undefined;
  expect(leaked, 'shell children still alive after the test').toBe(0);
});

function setup(
  readOnlyIds: string[] = [],
  overrides: Record<string, Partial<Parameters<typeof makeConnection>[2]>> = {},
): ShellService {
  tmp = createTempDb();
  const vault = new SecretsVault(tmp.db, createSafeStorageMock());
  const conns = ['c1', 'c2'].map((id) =>
    makeConnection(id, hp, {
      defaultDb: 'test',
      readOnly: readOnlyIds.includes(id),
      ...overrides[id],
    }),
  );
  pool = new MongoPool({ repo: makeReader(conns), vault });
  spawner = createTestSpawner();
  events = [];
  svc = new ShellService({ pool, spawner, emit: (e) => events.push(e) });
  return svc;
}

async function until(cond: () => Promise<boolean> | boolean, what: string, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const outputOf = (from = 0): string =>
  events
    .slice(from)
    .filter((e) => e.kind === 'stdout' || e.kind === 'stderr')
    .map((e) => e.data ?? '')
    .join('');

/** Send one line and wait for `marker` in what the session prints next. */
async function say(sessionId: string, line: string, marker: string): Promise<string> {
  const from = events.length;
  svc!.write(sessionId, line + '\n');
  await until(() => outputOf(from).includes(marker), `"${marker}" after "${line}"`);
  return outputOf(from);
}

async function countDocs(dbName: string, coll: string): Promise<number> {
  const client = new MongoClient(server.getUri());
  try {
    return await client.db(dbName).collection(coll).countDocuments();
  } finally {
    await client.close();
  }
}

describe('ShellService — the REPL runs in a child', () => {
  it('evaluates JS, reads and writes through main, and reports it as output events', async () => {
    const s = setup();
    const info = await s.start({ connectionId: 'c1' });
    expect(await say(info.sessionId, '1+1', '2')).toContain('2');

    await say(info.sessionId, 'await db.shell_items.insertOne({ k: "v1" })', 'acknowledged');
    expect(await countDocs('test', 'shell_items')).toBe(1);
    const read = await say(info.sessionId, 'await db.shell_items.findOne()', '"k": "v1"');
    expect(read).toContain('"k": "v1"');
    // The REPL ran in a child of its own, not in this process.
    expect(spawner.spawns).toHaveLength(1);
    const pid = spawner.spawns[0]!.child.pid;
    expect(pid).not.toBe(process.pid);
    expect(await say(info.sessionId, 'process.pid', String(pid))).toContain(String(pid));
  });

  it('`use` switches the database for later calls and the prompt follows', async () => {
    const s = setup();
    const info = await s.start({ connectionId: 'c1' });
    await say(info.sessionId, 'use shell_other', 'switched to db shell_other');
    await say(info.sessionId, 'await db.moved.insertOne({ here: 1 })', 'acknowledged');
    // The prompt follows the db the REPL is on.
    await until(() => outputOf().endsWith('shell_other> '), 'prompt for the new db');
    expect(await countDocs('shell_other', 'moved')).toBe(1);
    expect(await countDocs('test', 'moved')).toBe(0);
  });

  it('`show dbs` and `show collections` go through main', async () => {
    const s = setup();
    const info = await s.start({ connectionId: 'c1' });
    await say(info.sessionId, 'await db.listed_coll.insertOne({})', 'acknowledged');
    expect(await say(info.sessionId, 'show dbs', 'admin')).toContain('admin');
    expect(await say(info.sessionId, 'show collections', 'listed_coll')).toContain('listed_coll');
  });
});

describe('ShellService — the database a session starts on', () => {
  it("starts on the connection's default database and writes land there", async () => {
    const s = setup([], { c1: { defaultDb: 'smoke' } });
    const info = await s.start({ connectionId: 'c1' });
    expect(info.dbName).toBe('smoke');
    await until(() => outputOf().endsWith('smoke> '), 'prompt for the default db');
    await say(info.sessionId, 'await db.items.insertOne({ k: 1 })', 'acknowledged');
    expect(await countDocs('smoke', 'items')).toBe(1);
    expect(await countDocs('test', 'items')).toBe(0);
  });

  it('an explicit dbName wins over the connection default', async () => {
    const s = setup([], { c1: { defaultDb: 'smoke' } });
    const info = await s.start({ connectionId: 'c1', dbName: 'other' });
    expect(info.dbName).toBe('other');
    await until(() => outputOf().endsWith('other> '), 'prompt for the explicit db');
  });

  it('a blank dbName counts as unset, so the connection default applies', async () => {
    const s = setup([], { c1: { defaultDb: 'smoke' } });
    const info = await s.start({ connectionId: 'c1', dbName: '  ' });
    expect(info.dbName).toBe('smoke');
    await until(() => outputOf().endsWith('smoke> '), 'prompt for the default db');
  });

  it('falls back to test when the connection has no default database', async () => {
    const s = setup([], { c1: { defaultDb: undefined } });
    const info = await s.start({ connectionId: 'c1' });
    expect(info.dbName).toBe('test');
    await until(() => outputOf().endsWith('test> '), 'prompt for the fallback db');
  });

  it('a Restart (stop not awaited, then start) reopens on the new database', async () => {
    // The pane's cleanup fires `stop` without awaiting it and starts again at
    // once. start() reuses a live session for the connection and ignores
    // dbName then, so stop must end the session before its first await.
    const s = setup();
    const first = await s.start({ connectionId: 'c1', dbName: 'first_db' });
    void s.stop(first.sessionId);
    const second = await s.start({ connectionId: 'c1', dbName: 'second_db' });
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.dbName).toBe('second_db');
    await until(() => outputOf().endsWith('second_db> '), 'prompt for the restarted db');
  });
});

describe('ShellService — cursors', () => {
  it('a bare cursor prints a one-line hint, not its internals', async () => {
    const s = setup();
    const info = await s.start({ connectionId: 'c1' });
    const out = await say(info.sessionId, 'db.hint_items.find()', 'Cursor on');
    expect(out).toContain('Cursor on test.hint_items — iterate it or call .toArray()');
    expect(out).not.toContain('FacadeCursor');
    // A database-level cursor names the database.
    const dbOut = await say(info.sessionId, 'db.listCollections()', 'Cursor on test —');
    expect(dbOut).toContain('Cursor on test — iterate it or call .toArray()');
  });

  it('a long session never runs out of cursor slots', async () => {
    const s = setup();
    const info = await s.start({ connectionId: 'c1' });
    await say(info.sessionId, 'await db.slots.insertOne({ n: 1 })', 'acknowledged');
    // Past the host's 256-handle table, in one session. Each bare find() opens
    // a handle only once something iterates it, so drive 300 through next().
    const from = events.length;
    s.write(info.sessionId, 'for (let i = 0; i < 300; i++) { await db.slots.find().next(); }; "looped"\n');
    await until(() => outputOf(from).includes('looped'), 'the loop to finish', 20_000);
    expect(outputOf(from)).not.toMatch(/cursors|Error/);
    expect(await say(info.sessionId, 'JSON.stringify(await db.slots.find().toArray())', '"n":1')).toContain('"n":1');
  });
});

describe('ShellService — un-awaited results', () => {
  // A result starts right after its prompt (`test> 3`) unless that prompt was
  // already printed before the line was sent, so a line start is `> ` or `^`.
  const emptyObject = /(?:^|> )\{\}$/m;

  /** A session on `test` with exactly three documents in `async_items`; the mongod outlives each test. */
  async function seeded(): Promise<string> {
    const info = await setup().start({ connectionId: 'c1' });
    await say(
      info.sessionId,
      'await db.async_items.deleteMany({}); await db.async_items.insertMany([{n:1},{n:2},{n:3}])',
      'acknowledged',
    );
    return info.sessionId;
  }

  it('prints the documents of a find().toArray() left without await', async () => {
    const sessionId = await seeded();
    const out = await say(sessionId, 'db.async_items.find({n:{$gt:1}}).toArray()', '"n": 3');
    expect(out).toContain('"n": 2');
    expect(out).not.toContain('"n": 1');
    expect(out).not.toMatch(emptyObject);
  });

  it('prints the number of a countDocuments() left without await', async () => {
    const sessionId = await seeded();
    const from = events.length;
    svc!.write(sessionId, 'db.async_items.countDocuments()\n');
    await until(() => /(?:^|> )3$/m.test(outputOf(from)), 'a result line that is exactly 3');
    expect(outputOf(from)).not.toMatch(emptyObject);
  });

  it('prints the same documents with and without await', async () => {
    const sessionId = await seeded();
    const documents = (out: string): string | undefined => /\[[\s\S]*\]/.exec(out)?.[0];
    const awaited = await say(sessionId, 'await db.async_items.find({n:2}).toArray()', '"n": 2');
    const bare = await say(sessionId, 'db.async_items.find({n:2}).toArray()', '"n": 2');
    expect(documents(awaited)).toContain('"n": 2');
    expect(documents(bare)).toBe(documents(awaited));
  });

  it('prints the message of a rejection left without await, and the session stays alive', async () => {
    const sessionId = await seeded();
    const out = await say(sessionId, 'db.runCommand({ definitelyNotACommand: 1 })', 'definitelyNotACommand');
    expect(out).not.toMatch(emptyObject);
    expect(await say(sessionId, '40+2', '42')).toContain('42');
  });

  it('prints the message of a rejection that is awaited, and of a synchronous throw', async () => {
    const sessionId = await seeded();
    expect(await say(sessionId, 'await Promise.reject(new Error("await-boom"))', 'await-boom')).toContain(
      'await-boom',
    );
    expect(await say(sessionId, 'throw new Error("boom-sync")', 'boom-sync')).toContain('boom-sync');
    expect(await say(sessionId, '40+2', '42')).toContain('42');
  });

  it('prints a non-Error rejection or throw readably', async () => {
    const sessionId = await seeded();
    expect(await say(sessionId, 'Promise.reject("plain-reason")', 'plain-reason')).toContain('plain-reason');
    expect(await say(sessionId, 'Promise.reject({ code: 7 })', '"code": 7')).toContain('"code": 7');
    expect(await say(sessionId, 'throw "thrown-string"', 'thrown-string')).toContain('thrown-string');
    expect(await say(sessionId, 'throw { code: 8 }', '"code": 8')).toContain('"code": 8');
    // A falsy reason would read as success to the REPL and print nothing.
    expect(await say(sessionId, 'Promise.reject(null)', 'rejected with null')).toContain('rejected with null');
    expect(await say(sessionId, '40+2', '42')).toContain('42');
  });

  it('an Error with a cause and extra fields prints its message and does not take the session down', async () => {
    const sessionId = await seeded();
    const out = await say(
      sessionId,
      '(() => { const e = new Error("outer-msg", { cause: new Error("inner-msg") }); e.code = 42; e.self = e; throw e; })()',
      'outer-msg',
    );
    // One line, not the stack the writer's fallback would print.
    expect(out).toMatch(/Error: outer-msg\n/);
    expect(out).not.toMatch(/^\s+at /m);
    expect(await say(sessionId, '40+2', '42')).toContain('42');
  });

  it('a result that never settles leaves later commands working', async () => {
    const sessionId = await seeded();
    const from = events.length;
    svc!.write(sessionId, 'new Promise(() => {})\n');
    svc!.write(sessionId, '({ then() {} })\n');
    expect(await say(sessionId, '40+2', '42')).toContain('42');
    expect(await say(sessionId, 'await db.async_items.countDocuments()', '3')).toContain('3');
    expect(outputOf(from)).not.toMatch(emptyObject);
  });

  it('a result that settles late prints after the commands that ran meanwhile', async () => {
    const sessionId = await seeded();
    svc!.write(sessionId, 'new Promise((resolve) => { globalThis.release = resolve; })\n');
    const from = events.length;
    expect(await say(sessionId, '40+2', '42')).toContain('42');
    expect(await say(sessionId, 'release("late-value")', 'late-value')).toContain('late-value');
    expect(outputOf(from).indexOf('42')).toBeLessThan(outputOf(from).indexOf('late-value'));
  });

  it('a thenable that settles twice prints once', async () => {
    const sessionId = await seeded();
    await say(sessionId, '({ then(resolve) { resolve("first-value"); resolve("second-value"); } })', 'first-value');
    expect(await say(sessionId, '40+2', '42')).toContain('42');
    expect(outputOf()).not.toContain('second-value');
  });

  it('a `then` that throws fails that command and not the session', async () => {
    const sessionId = await seeded();
    const getter = await say(sessionId, '({ get then() { throw new Error("getter-boom"); } })', 'getter-boom');
    expect(getter).toContain('getter-boom');
    const method = await say(sessionId, '({ then() { throw new Error("method-boom"); } })', 'method-boom');
    expect(method).toContain('method-boom');
    expect(await say(sessionId, '40+2', '42')).toContain('42');
    expect(svc!.list()).toHaveLength(1);
  });

  it('a bare cursor and a bare collection are not awaited', async () => {
    const sessionId = await seeded();
    expect(await say(sessionId, 'db.async_items.find()', 'Cursor on test.async_items')).toContain(
      'Cursor on test.async_items — iterate it or call .toArray()',
    );
    // A printed result ends in a newline, a prompt does not, so a newline
    // means the proxy was printed rather than mistaken for a thenable and awaited.
    expect(await say(sessionId, 'db.async_items', '\n')).toContain('\n');
    expect(await say(sessionId, 'db', '\n')).toContain('\n');
  });
});

describe('ShellService — lifecycle', () => {
  it('stop() kills the child', async () => {
    const s = setup();
    const info = await s.start({ connectionId: 'c1' });
    await say(info.sessionId, '1', '1');
    expect(spawner.alive()).toHaveLength(1);
    await s.stop(info.sessionId);
    await until(() => spawner.alive().length === 0, 'child to die', 3000);
    expect(events.at(-1)).toMatchObject({ kind: 'exit', exitCode: 0 });
  });

  it('disposeAll() (app quit) kills every child', async () => {
    const s = setup();
    await s.start({ connectionId: 'c1' });
    await s.start({ connectionId: 'c2' });
    expect(spawner.alive()).toHaveLength(2);
    await s.disposeAll();
    await until(() => spawner.alive().length === 0, 'children to die', 3000);
    expect(s.list()).toHaveLength(0);
  });

  it('a pool disconnect ends the session and kills the child', async () => {
    const s = setup();
    const info = await s.start({ connectionId: 'c1' });
    await pool!.disconnect('c1');
    await until(() => s.list().length === 0, 'session to end');
    await until(() => spawner.alive().length === 0, 'child to die', 3000);
    const end = events.at(-1)!;
    expect(end).toMatchObject({ sessionId: info.sessionId, kind: 'exit', exitCode: 1 });
    expect(outputOf()).toContain('the connection was disconnected');
    expect(() => s.write(info.sessionId, '1\n')).toThrow();
  });

  it('a disconnect of another connection leaves the session alone', async () => {
    const s = setup();
    const info = await s.start({ connectionId: 'c1' });
    await pool!.readClient('c2');
    await pool!.disconnect('c2');
    expect(await say(info.sessionId, '40+2', '42')).toContain('42');
    expect(s.list()).toHaveLength(1);
  });

  it('a connection that turns read-only ends the session', async () => {
    const s = setup();
    const info = await s.start({ connectionId: 'c1' });
    pool!.emit('read-only-enabled', 'c1');
    await until(() => s.list().length === 0, 'session to end');
    await until(() => spawner.alive().length === 0, 'child to die', 3000);
    expect(outputOf()).toContain('set to read-only');
    expect(() => s.write(info.sessionId, '1\n')).toThrow();
  });

  it('a child that dies on its own ends the session with an error event', async () => {
    const s = setup();
    const info = await s.start({ connectionId: 'c1' });
    await say(info.sessionId, '1', '1');
    spawner.spawns[0]!.child.kill('SIGKILL');
    await until(() => s.list().length === 0, 'session to end');
    const err = events.find((e) => e.kind === 'stderr');
    expect(err?.data).toMatch(/exited unexpectedly/);
    expect(events.at(-1)).toMatchObject({ sessionId: info.sessionId, kind: 'exit', exitCode: 1 });
  });

  it('process.exit() inside the REPL is a clean error, not a hang', async () => {
    const s = setup();
    const info = await s.start({ connectionId: 'c1' });
    s.write(info.sessionId, 'process.exit(3)\n');
    await until(() => s.list().length === 0, 'session to end');
    expect(outputOf()).toContain('exit code 3');
  });

  it('`.exit` in the REPL ends the session cleanly', async () => {
    const s = setup();
    const info = await s.start({ connectionId: 'c1' });
    s.write(info.sessionId, '.exit\n');
    await until(() => s.list().length === 0, 'session to end');
    await until(() => spawner.alive().length === 0, 'child to die', 3000);
    expect(events.at(-1)).toMatchObject({ sessionId: info.sessionId, kind: 'exit', exitCode: 0 });
  });

  it('refuses a read-only connection wholesale, before spawning anything', async () => {
    const s = setup(['c2']);
    await expect(s.start({ connectionId: 'c2' })).rejects.toMatchObject({ code: 'READ_ONLY' });
    expect(spawner.spawns).toHaveLength(0);
  });
});

describe('ShellService — what the child can see', () => {
  const sentinel = 'pw-SENTINEL-9f3a';

  /** A connection with a stored password, whose pool client is a stand-in for the authenticated one. */
  async function authedSession(): Promise<{ s: ShellService; sessionId: string }> {
    tmp = createTempDb();
    const now = new Date().toISOString();
    tmp.db
      .prepare(
        `INSERT INTO connections (id, name, connection_type, host, port, auth_mech, created_at, updated_at)
         VALUES ('authed', 'authed', 'standard', 'localhost', 27017, 'scram256', ?, ?)`,
      )
      .run(now, now);
    const vault = new SecretsVault(tmp.db, createSafeStorageMock());
    vault.set('authed', 'password', sentinel);
    const authed = makeConnection('authed', hp, {
      defaultDb: 'test',
      authMech: 'scram256',
      authUsername: 'nobody',
    });
    pool = new MongoPool({ repo: makeReader([authed]), vault });
    // The user is unknown to the server, so the pool's own connect would fail
    // authentication; stand in for it with an unauthenticated client. What the
    // tests inspect is what main hands the child.
    const direct = new MongoClient(server.getUri());
    pool.readClient = () => Promise.resolve(direct);
    spawner = createTestSpawner();
    events = [];
    svc = new ShellService({ pool, spawner, emit: (e) => events.push(e) });
    const info = await svc.start({ connectionId: 'authed' });
    return { s: svc, sessionId: info.sessionId };
  }

  it('no message posted to the child carries a URI, a user or a password', async () => {
    const { sessionId } = await authedSession();
    await say(sessionId, 'await db.runCommand({ ping: 1 })', 'ok');
    const spawn = spawner.spawns[0]!;
    expect(JSON.stringify(spawn.args)).not.toContain(sentinel);
    expect(JSON.stringify(spawn.env)).not.toContain(sentinel);
    // The start request names a database and a banner, and nothing else.
    const start = spawn.sent[0] as Record<string, unknown>;
    expect(Object.keys(start).sort((a, b) => a.localeCompare(b))).toEqual(['banner', 'dbName', 'type']);
    const everything = JSON.stringify(spawn.sent);
    expect(everything).not.toContain(sentinel);
    expect(everything).not.toContain('mongodb://');
    expect(everything).not.toContain('nobody');
    // Input lines and RPC replies were both among what was posted.
    const types = spawn.sent.map((m) => (m as { type?: string }).type);
    expect(types).toContain('shell-in');
    expect(types).toContain('rpc-result');
  });

  it('an escape through process.env and process.argv finds no URI and no password', async () => {
    const { sessionId } = await authedSession();
    const env = await say(sessionId, 'JSON.stringify(process.env)', 'PATH');
    const argv = await say(sessionId, 'JSON.stringify(process.argv)', 'runner');
    for (const seen of [env, argv, outputOf()]) {
      expect(seen).not.toContain(sentinel);
      expect(seen).not.toContain('mongodb://');
      expect(seen).not.toContain('nobody');
    }
    // A shell-out sees the same scrubbed environment.
    const viaChild = await say(
      sessionId,
      "require('child_process').execSync('env').toString()",
      'PATH=',
    );
    expect(viaChild).not.toContain(sentinel);
    expect(viaChild).not.toContain('mongodb://');
  });

  it('the child has no client of its own: the facade exposes no driver internals', async () => {
    const { sessionId } = await authedSession();
    const out = await say(
      sessionId,
      'JSON.stringify([db.items.s, db.items.client, db.items.topology, db.items.db, db.items.namespace])',
      'items',
    );
    // Only the namespace is a real property of the facade; the rest are absent
    // (JSON turns `undefined` into `null` inside an array).
    expect(out).toContain('[null,null,null,null,"test.items"]');
  });
});
