import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import * as repl from 'node:repl';
import { inspect } from 'node:util';
import type {
  ShellOutputEvent,
  ShellSessionInfo,
} from '@shared/types';
import { NotFoundError, ValidationError } from '../errors.ts';
import type { Logger } from '../log.ts';
import type { MongoPool } from '../mongo/MongoPool.ts';
import { makeDbProxy } from '../mongo/dbProxy.ts';
import { ejsonStringifyRelaxed } from '../mongo/ejson.ts';

type EmitFn = (event: ShellOutputEvent) => void;

export interface ShellServiceOpts {
  pool: MongoPool;
  emit: EmitFn;
  log?: Logger;
}

interface Session {
  info: ShellSessionInfo;
  stdin: PassThrough;
  /** Triggers shutdown of the underlying REPL. Idempotent. */
  shutdown: () => void;
  /** Resolves when the REPL has actually emitted its `exit` event. */
  exited: Promise<void>;
  isExited: boolean;
}

/**
 * In-process Mongo shell. One Node `repl.REPLServer` per session, fed through
 * passthrough streams that fan out as `mshell:output-event`s. Reuses the
 * Connection's already-open `MongoClient` from the pool — no new auth, no
 * argv-borne password.
 *
 * The eval context exposes a `db` global that proxies into the live
 * `MongoClient`. Mongosh-style sugar (`use foo`, `show dbs`, `show
 * collections`) is rewritten before it reaches Node's parser.
 */
export class ShellService {
  private readonly pool: MongoPool;
  private readonly emit: EmitFn;
  private readonly log?: Logger;
  private readonly sessions = new Map<string, Session>();
  private readonly byConnection = new Map<string, string>();

  constructor(opts: ShellServiceOpts) {
    this.pool = opts.pool;
    this.emit = opts.emit;
    this.log = opts.log;
  }

  async start(input: { connectionId: string; dbName?: string }): Promise<ShellSessionInfo> {
    this.pool.assertWritable(input.connectionId);

    // One live session per connection. Reusing avoids zombie REPLs when a
    // user clicks the chrome toggle off/on rapidly.
    const existing = this.sessions.get(this.byConnection.get(input.connectionId) ?? '');
    if (existing && !existing.isExited) return existing.info;

    // Force a connect — MongoPool.readClient throws SystemError if the
    // connection can't be established. Do this before allocating the REPL so
    // the renderer sees a clean error instead of a half-initialised session.
    const client = await this.pool.readClient(input.connectionId);

    const sessionId = randomUUID();
    const info: ShellSessionInfo = {
      sessionId,
      connectionId: input.connectionId,
      dbName: input.dbName,
      startedAt: new Date().toISOString(),
    };

    const stdin = new PassThrough();
    const stdout = new PassThrough();
    stdout.setEncoding('utf8');
    stdout.on('data', (chunk: string) => {
      this.emit({ sessionId, kind: 'stdout', data: chunk });
    });

    // Per-session mutable cursor — `use foo` swaps it without breaking the
    // `db` Proxy identity.
    const ctx = {
      currentDb: input.dbName ?? 'test',
      client,
    };
    const dbProxy = makeDbProxy(ctx);

    const server = repl.start({
      prompt: `${ctx.currentDb}> `,
      input: stdin,
      output: stdout,
      terminal: false,
      useColors: false,
      ignoreUndefined: true,
      writer: shellWriter,
    });
    server.context.db = dbProxy;
    server.context.use = (name: string) => {
      ctx.currentDb = name;
      server.setPrompt(`${name}> `);
      return `switched to db ${name}`;
    };
    server.context.help = helpText;
    // Mongosh-style `show ...` sugar. Returned values flow through the
    // standard REPL writer so they get the same EJSON formatting as queries.
    server.context.__shellShow = async (kind: 'dbs' | 'collections') => {
      if (kind === 'dbs') {
        // `authorizedDatabases: true` lets users with scoped roles (Atlas
        // read-only, per-db users) see the dbs they have access to even when
        // they lack the cluster-wide listDatabases privilege.
        const r = (await ctx.client.db('admin').command({
          listDatabases: 1,
          authorizedDatabases: true,
        })) as {
          databases: Array<{ name: string; sizeOnDisk?: number }>;
        };
        return r.databases.map((d) => `${d.name}\t${d.sizeOnDisk ?? 0}`).join('\n');
      }
      const colls = await ctx.client.db(ctx.currentDb).listCollections().toArray();
      return colls.map((c) => c.name).join('\n');
    };

    let resolveExit!: () => void;
    const exited = new Promise<void>((r) => {
      resolveExit = r;
    });

    const session: Session = {
      info,
      stdin,
      isExited: false,
      exited,
      shutdown: () => {
        try {
          server.close();
        } catch {
          // best-effort; the exit event still resolves us via the
          // `exit` listener below.
        }
        stdin.end();
      },
    };

    server.on('exit', () => {
      session.isExited = true;
      this.emit({ sessionId, kind: 'exit', exitCode: 0, signal: null });
      this.sessions.delete(sessionId);
      if (this.byConnection.get(input.connectionId) === sessionId) {
        this.byConnection.delete(input.connectionId);
      }
      resolveExit();
      this.log?.info('mshell', 'exited', { sessionId });
    });

    this.sessions.set(sessionId, session);
    this.byConnection.set(input.connectionId, sessionId);
    this.log?.info('mshell', 'started', {
      sessionId,
      connectionId: input.connectionId,
    });

    // Greet the user with a banner and a prompt. The repl writes its own
    // prompt only after the first input arrives, so we nudge it here.
    stdout.write(
      `L'Atelier shell (in-process). Connected to ${input.connectionId}. ` +
        `Type help() for hints.\n${ctx.currentDb}> `,
    );

    return info;
  }

  write(sessionId: string, data: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) throw new NotFoundError(`shell session ${sessionId} not found`);
    if (s.isExited) throw new ValidationError('shell session has exited');
    // Re-checked on every write, not just at start() — a session already
    // open when the connection flips to read-only (conn:update) must not
    // keep its require/process escape hatch. Consistent with start()'s
    // wholesale refusal: the whole session is unusable read-only, not just
    // its writes, since the REPL can't reliably tell reads from writes.
    this.pool.assertWritable(s.info.connectionId);
    s.stdin.write(rewriteShellSugar(data));
  }

  async stop(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s || s.isExited) return;
    s.shutdown();
    // Wait for the actual `exit` event so list()/byConnection are coherent.
    await s.exited;
  }

  list(): ShellSessionInfo[] {
    return [...this.sessions.values()].map((s) => s.info);
  }

  async disposeAll(): Promise<void> {
    await Promise.allSettled(
      [...this.sessions.values()].map((s) => {
        s.shutdown();
        return s.exited;
      }),
    );
  }
}

// ─── REPL plumbing ──────────────────────────────────────────────────────────

function shellWriter(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  // EJSON returns undefined for values it can't serialize (e.g. plain
  // functions, including our `db` Proxy). Fall through to util.inspect so
  // typing `db` still produces something readable.
  try {
    const ejson = ejsonStringifyRelaxed(value, 2);
    if (typeof ejson === 'string') return ejson;
  } catch {
    // fall through
  }
  return inspect(value, { depth: 4, colors: false });
}

function helpText(): string {
  return [
    "L'Atelier shell — in-process Node REPL with a Mongo driver context.",
    '',
    '  db                          — current database (use("name") to switch)',
    '  db.<coll>.find(filter, opt) — returns a cursor (call .toArray())',
    '  db.<coll>.findOne(filter)',
    '  db.<coll>.insertOne(doc)',
    '  db.<coll>.updateOne(filter, update)',
    '  db.<coll>.deleteOne(filter)',
    '  db.<coll>.countDocuments(filter)',
    '  db.<coll>.aggregate(pipeline).toArray()',
    '  db.runCommand({ ping: 1 })',
    '  show dbs / show collections',
    '',
    'All async ops can be awaited at the top level.',
  ].join('\n');
}

/**
 * Rewrite mongosh-style sugar to JS that Node's default REPL evaluator can
 * parse: `use foo` / `show dbs` / `show collections` and their aliases.
 *
 * `[ \t]*` (not `\s*`) so the trailing newline that delimits the REPL line
 * is preserved — without it, the REPL never sees a complete line and hangs.
 */
// `use foo`, `use "foo"`, `use 'foo';` — accept optional matching quotes
// and a trailing semicolon. The bare-name capture group rejects whitespace
// and quote characters so `use "foo` (unbalanced) doesn't slip through.
const SHELL_SUGAR: ReadonlyArray<readonly [RegExp, string]> = [
  [/^[ \t]*use[ \t]+"([^"\s]+)"[ \t]*(?:;[ \t]*)?$/m, 'use("$1")'],
  [/^[ \t]*use[ \t]+'([^'\s]+)'[ \t]*(?:;[ \t]*)?$/m, 'use("$1")'],
  [/^[ \t]*use[ \t]+([^\s"';]+)[ \t]*(?:;[ \t]*)?$/m, 'use("$1")'],
  [/^[ \t]*show[ \t]+(?:dbs|databases)[ \t]*(?:;[ \t]*)?$/m, 'await __shellShow("dbs")'],
  [/^[ \t]*show[ \t]+(?:collections|tables)[ \t]*(?:;[ \t]*)?$/m, 'await __shellShow("collections")'],
];

function rewriteShellSugar(line: string): string {
  return SHELL_SUGAR.reduce((acc, [re, sub]) => acc.replace(re, sub), line);
}
