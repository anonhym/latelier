# W11 — Mongo shell pane (in-process REPL)

## Purpose

Give users a first-class shell affordance from inside the workspace: a
button in the workspace chrome that opens a bottom pane wrapping a
JavaScript REPL with a Mongo driver context, scoped to the active
connection (and optionally the active db). The REPL runs **in-process**
in the main Electron process — there is no external `mongosh`
dependency.

This spec implements GitHub.

## Scope

- **In**: `ShellService` in main that hosts a `node:repl.REPLServer` per
  connection, sharing the existing `MongoPool` `MongoClient` so the
  shell never re-authenticates; IPC channels for start / write / stop
  and an output event stream; renderer pane that renders the output as a
  monospace stream and forwards keystrokes to stdin; a "Shell" toggle
  button on the workspace chrome.
- **Out**: full mongosh feature parity (autocomplete, history, custom
  helpers like `it`); shell-history persistence; multiple concurrent
  shell sessions per connection.

## Why in-process (not `spawn('mongosh')`)

The earlier draft of this spec spawned a `mongosh` child process. Two
problems pushed us to the in-process route:

1. **Runtime dependency.** `mongosh` would need to be installed on every
   user's machine; first launch on a fresh install would fail until
   `brew install mongosh` (or equivalent) ran.
2. **Connection re-auth.** The child would have to be handed a URI with
   embedded credentials, opening a brand-new MongoDB connection — a
   second auth round-trip in addition to the one the app already paid.

The in-process REPL reuses the `MongoClient` the rest of the app
already holds. No new connection, no second login, no password ever
serialised to argv.

## Dependencies

- C02 (`Connection`), F04 (IPC pattern), F05 (`MongoPool` —
  `getClient(connectionId)` is the integration point).

## 1. Types

```ts
// shared/types.ts
export interface ShellSessionInfo {
  sessionId: string;
  connectionId: string;
  dbName?: string;
  startedAt: string;
}

export type ShellOutputKind = 'stdout' | 'stderr' | 'exit';

export interface ShellOutputEvent {
  sessionId: string;
  kind: ShellOutputKind;
  /** Present for stdout/stderr. Plain text. */
  data?: string;
  /** Present only when kind === 'exit'. */
  exitCode?: number | null;
  /** Present only when kind === 'exit' and the process was signalled. */
  signal?: string | null;
}
```

`stderr` and `exitCode`/`signal` are kept on the wire even though the
in-process REPL never produces them (errors land on stdout via the
REPL's writer). They survive in the type so a future swap to a
subprocess-backed implementation is non-breaking.

## 2. IPC channels

| Channel          | Input                                                         | Output                | Notes |
| ---------------- | ------------------------------------------------------------- | --------------------- | ----- |
| `mshell:start`   | `{ connectionId: string; dbName?: string }`                   | `ShellSessionInfo`    | starts a `node:repl` |
| `mshell:write`   | `{ sessionId: string; data: string }`                         | `void`                | writes to the session's input stream |
| `mshell:stop`    | `{ sessionId: string }`                                       | `void`                | closes the REPL |
| `mshell:list`    | —                                                             | `ShellSessionInfo[]`  | enumerate live sessions |
| `mshell:onOutput`| event `mshell:output-event` carrying `ShellOutputEvent`       | —                     | renderer subscribes via preload |

## 3. ShellService (main)

```ts
class ShellService {
  start(input: { connectionId: string; dbName?: string }): Promise<ShellSessionInfo>;
  write(sessionId: string, data: string): void;
  stop(sessionId: string): Promise<void>;
  list(): ShellSessionInfo[];
  /** Called from app `before-quit` to close any live sessions. */
  disposeAll(): Promise<void>;
}
```

Behaviour:

- `start` calls `pool.getClient(connectionId)` first so a connect
  failure surfaces as a clean error before any session state is
  allocated.
- A `repl.REPLServer` is created with passthrough `input` / `output`
  streams. Output bytes fan out as `kind: 'stdout'` events.
- The REPL `context` exposes:
  - `db` — a Proxy wrapping the live client. `db.<name>` returns a
    `Collection` from the current database. Db methods (`runCommand`,
    `stats`, `listCollections`) pass through.
  - `use(name)` — switches the current database, updates the prompt.
  - `help()` — short reminder of available verbs.
- Mongosh-style sugar is rewritten / intercepted:
  - `use foo` (no parens) is rewritten to `use("foo")` before reaching
    the parser.
  - `show dbs` / `show databases` is intercepted in the evaluator and
    runs `admin.listDatabases`.
  - `show collections` / `show tables` runs `db.listCollections()` on
    the current database.
- The evaluator wraps user input in an async IIFE so top-level `await`
  works (`await db.users.findOne()` etc.).
- Sessions are scoped per connection — calling `start` for a connection
  that already has a live session reuses it. Idempotent toggle.
- `disposeAll` is wired into `app.on('before-quit')`.

## 4. Renderer pane (`MongoShellPane.tsx`)

- A bottom pane inside the workspace, ~260 px tall by default,
  resizable via a `ResizeHandle` (height persisted in
  `prefs:set('ui.workspace.shellHeight', n)`).
- Toggled by a chrome button in the title bar (`{I.terminal} Shell`).
- Hidden entirely when there is no active connection.
- Output area: monospace `<pre>` showing the rolling output buffer
  (capped at 200 KB, drop-from-front); scrolls to bottom on append.
- Input row: a single-line `<input>` that, on Enter, calls
  `api.mshell.write(sessionId, value + '\n')` and clears.
- Restart / Stop / Close controls in the pane header.

## 5. Security

- No credentials cross the IPC boundary. The shell binds to the
  already-authenticated `MongoClient` from the pool.
- The shell has the same database authority the rest of the app has —
  no privilege escalation.
- All evaluation happens in the **main** process (Node). The renderer
  only sees text in / text out.

## 6. Acceptance criteria

- [x] Clicking the chrome "Shell" button opens the pane scoped to the
      active connection; clicking again hides it.
- [x] On open, the pane prints a banner naming the connection.
- [x] Typing `await db.runCommand({ ping: 1 })` prints `{ "ok": 1 }`.
- [x] `show dbs` and `show collections` work.
- [x] `use <name>` switches the current database and updates the prompt.
- [x] Closing the pane / quitting the app stops the session cleanly.

## 7. Test cases

### Integration (main)
- **shell-service.spec.ts**: drives a `ShellService` against a fake
  `MongoPool` + fake `MongoClient`. Covers banner, session reuse,
  expression evaluation, `db.<coll>.findOne`, `show dbs`, `show
  collections`, `use <name>`, stop / write-after-stop / list semantics.

### Component
- **mongo-shell-pane.spec.tsx**: mounts the pane against a mocked
  `api.mshell`; verifies start-on-mount, input → `mshell.write`, and
  the streamed-output rendering path.

### E2E
- **mongo-shell.e2e.ts**: launches the real Electron app, seeds a
  connection against an in-memory MongoDB, starts a session, runs `await
  db.runCommand({ ping: 1 })` through the IPC bridge, and asserts the
  `{ "ok": 1 }` payload appears in the output stream.
