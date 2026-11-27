# X27 — Agent Access: read-only MCP access to shared Connections

> **Status: Implemented.**

## Purpose

Users already ask AI coding agents (Claude Code, Claude Desktop, Cursor) questions whose answers sit in their MongoDB data: "how many orders failed yesterday", "what does a `subscription` document look like", "which index does this query use". Today the agent either gets a connection string, and with it everything the database user can do, or it gets nothing.

L'Atelier already holds the user's connections, their credentials in the vault, and a main process that enforces read-only. X27 lets an **Agent** read through the app instead: it reaches only the Connections the user has explicitly shared, only while they are open, only for reads, and never sees a host, URI or credential. The app is the gate, and it records what every Agent read.

The design was settled in a discussion that started from a study of the official MongoDB MCP server (`docs/research/mongodb-mcp-server.md`, §7 lists what is copied from it and what is not). An independent adversarial review then reshaped the read path, the pipeline rules, revocation and the Agent Read Log.

## Threat model

**Defended against:**

- **An Agent that does what its prompt tells it.** Document contents are untrusted input to the model, and a document can carry text written to steer it (prompt injection). Whatever the Agent is talked into, it can only read, only from shared Connections, only within the limits below, and every read is logged.
- **Another OS user on the same machine.** The socket is reachable by the owning user only (§4.3; see the Windows caveat there).
- **A compromised renderer.** The renderer displays untrusted document contents. It cannot turn Agent Access on, share a Connection, or see a token: each of those is a main-process action behind a main-process dialog.
- **Load on production.** Every Agent operation is bounded in time, size and concurrency, and labelled so a DBA can find it.

**Not defended against, stated on purpose:**

- **A process running as the same OS user** can read the Agent client's configuration file, which holds the token in plaintext (§5.3), and then read whatever that token can read. That is the same trust level as the Agent itself. Revoking or regenerating the token is the recovery.
- **The database user's own privileges.** As [ADR 0005](../docs/adr/0005-read-only-connection-enforcement.md) and [ADR 0014](../docs/adr/0014-out-of-process-script-runner.md) say, the app's checks are not a hard guarantee; a database user with only read roles is. §3.3 checks the user's privileges and warns.

## Scope

### In

- A global **Agent Access** switch, off by default, that only main can turn on.
- A per-Connection **Shared with Agents** flag, off by default, set only through a main-process dialog that also checks the database user's privileges.
- A local socket server in main speaking MCP, and an **Agent Bridge**: a small separate Rust executable shipped inside the app bundle, which an Agent client launches as a stdio MCP server.
- Named **Agent Tokens**: stored hashed, shown once, revocable and regenerable.
- An agent-only read path with its own client per shared Connection, its own limits, and no side effects on the user's history or the quit prompt.
- Ten read-only tools (§8), a stage allowlist for pipelines, and a namespace denylist.
- Revocation that cancels in-flight work.
- An **Agent Read Log** table, encrypted per X21, with retention, and a read count in the UI.
- A Settings section, a status-bar Agents control that shares the focused Connection, share actions on the navigator root, and a marker on shared Connections.

### Out — deliberately

- **Any write.** No write tool, no write grant, no `$out`/`$merge`, no shell or script. A later spec may add writes; nothing here prepares for them.
- **Scoping below the Connection** (a database or collection allowlist inside a shared Connection). The flag is on/off for iteration 1; the system namespaces in §7.3 are always denied.
- **HTTP or any network listener.** See §14.
- **Atlas tools, `$search`/`$vectorSearch`, server logs, `currentOp`, cluster administration.**
- **A viewer for the Agent Read Log.** Iteration 1 stores it and shows a count. The viewer is a follow-up.
- **Letting an Agent open, wake or connect a Connection, or start the app.**
- **PII redaction or tokenisation of results.** Researched in `docs/research/pii-tokenization-for-agents.md` and dropped for iteration 1.

## Dependencies

- [F04](./F04-ipc-bridge.md): IPC envelope and router, for the renderer-facing channels in §13.
- [F05](./F05-mongo-client-pool.md), [X16](./X16-multi-connection.md): Open Connections, pool status events.
- [F06](./F06-app-lifecycle.md): startup and the teardown sequence.
- [X13](./X13-operation-audit-log.md) and [ADR 0002](../docs/adr/0002-audit-log-scope.md): the Audit Log stays writes-only; the Agent Read Log is a separate table.
- [X21](./X21-encryption-at-rest.md): column encryption for Mongo-derived values in the Agent Read Log.
- [C13](./C13-connection-export-import.md): Connection Export must not carry the new flag.
- [X23](./X23-connection-families.md) and [X24](./X24-family-export.md): Shared with Agents is a property of one Connection and is never shared through a Family or a Family Export.
- [ADR 0005](../docs/adr/0005-read-only-connection-enforcement.md): read handles and their limits.
- New toolchain: Rust, to build the Agent Bridge. The build script builds it with `cargo build --release` for each target, and CI and the release workflow install the toolchain with pinned versions. The crate has no dependencies.
- New dependency: the MCP TypeScript SDK. Its package name and major version are pinned at implementation, because v2 split the SDK into separate packages.

## 1. Terms

- **Agent**: an external AI client connected to L'Atelier over MCP.
- **Agent Access**: the app-wide setting that lets Agents in.
- **Shared with Agents**: a persisted flag on one Connection that makes it visible to Agents while it is open.
- **Agent Token**: the secret an Agent presents, one per named Agent.
- **Agent Bridge**: the `latelier-agent-bridge` executable, forwarding bytes between an Agent's stdio and the app's socket. It speaks no MCP itself.
- **Agent Read Log**: the record of every Agent tool call.

"MCP server" stays an implementation word. Avoid "assistant", "bot" and "AI mode" in the UI.

## 2. Gates

An Agent can reach a Connection only while **all three** hold:

1. **Agent Access** is on.
2. The Connection is **Shared with Agents**.
3. The Connection is an **Open Connection**: `pool.status(id).status === 'connected'`.

The gates are evaluated **on every handle acquisition**, not once per tool call, and again after each `await` that returns data (§10). They are evaluated by `AgentGate` (§6.1), which never calls `connect`: `MongoPool.readDb`/`readClient` connect a closed Connection on demand (`getClientInternal`), so a check in the tool followed by a service call would let an Agent wake a Dormant Connection if it dropped in between.

A Connection that is shared but not open is listed by `list_connections` with `state: "unavailable"` and its name only, so the Agent can ask the user to open it instead of concluding there is nothing.

## 3. Turning it on

### 3.1 Agent Access

- Stored in `app_state` under a key that is **not** in `electron/ipc/prefKeys.ts`, so the renderer cannot write it. This follows the `PLAINTEXT_FALLBACK_KEY` pattern in `electron/main.ts`.
- The renderer asks; main shows a native confirmation dialog explaining what Agents can and cannot do; only a confirmed dialog sets the key. Turning it off needs no confirmation.
- `AppStateService.subscribe` starts and stops the socket server live (§4.4).

### 3.2 Shared with Agents

- A new column on `connections` (`share_with_agents INTEGER NOT NULL DEFAULT 0`), added by a new append-only migration. Mapped to `shareWithAgents: boolean` in `shared/types.ts`.
- Set only by a dedicated channel (`agentAccess:set-shared`), and only after a main-process dialog. The general connection create/update schemas (`electron/ipc/schemas/connection.ts`) do **not** declare the field. They are non-strict `z.object`s, so a `shareWithAgents` key in a `conn:create` or `conn:update` payload is stripped and never reaches the repository.
- **Never copied**: not by Duplicate, not by Connection Export (the field is excluded explicitly in `electron/services/connectionExportFormat.ts`, which today serialises `readOnly`), not by Import (imports arrive unshared), not by a Family or Family Export.
- Unsharing needs no confirmation and takes effect immediately (§10).
- **Sharing while Agent Access is off** asks both questions in one main-process dialog: it carries §3.1's explanation and §3.3's privilege result, and its confirm button is **Turn on and share**. Confirming turns Agent Access on and then writes the flag; cancelling changes neither. Without this, a share made while Agent Access is off would succeed and leave nothing visible, since the marker (§12.3) shows only while Agent Access is on.

### 3.3 Privilege check

When the user asks to share a Connection, main runs `connectionStatus` with `showPrivileges: true` on it (the Connection must be open; otherwise the dialog asks the user to open it first) and shows the result in the share dialog:

- **Read-only user**: "This user can only read."
- **User with write or admin actions**: a warning naming the roles, recommending a read-only database user. It warns; it does not block.
- **No authenticated user** (a server with auth off, or an empty result): "Cannot verify: this server does not require authentication, so anything that reaches it can write." Never shown as a pass.
- **The command fails**: "Could not check this user's privileges", with the error code. Not a pass either.

The check runs each time the flag is turned on, and nothing is cached. The shared marker's tooltip repeats the last result.

## 4. Transport

### 4.1 Shape

```
Agent client ──stdio──▶ Agent Bridge (latelier-agent-bridge) ──socket──▶ main: AgentServer ──▶ AgentGate ──▶ agent client per Connection
```

There is no HTTP server and no TCP port. Every Agent client in scope supports stdio servers.

### 4.2 Agent Bridge

- The bridge is **a separate Rust executable**, `latelier-agent-bridge`, in a `bridge/` crate, using the standard library only (no dependencies). It is built for every target the app ships, copied into the bundle as an extra resource, unpacked from the asar, and signed and notarized with the app on macOS and signed on Windows.
- It is not the Electron binary. A spike measured `--agent-stdio` on the Electron binary at about 185 ms median to the first handshake byte, about 214 MB RSS across three processes (the main process plus two Chromium helpers), and a short Foreground activation state before `app.dock.hide()` could run. A Rust spike measured about 2 ms median, 1.9 MB RSS, 296 KB on disk, and no Dock registration at all. See §14.
- The bridge opens no window, database, vault or Mongo client. It reads `LATELIER_AGENT_TOKEN` from its environment (and refuses a token with characters outside `A-Z a-z 0-9 - _`, so it can never build a malformed handshake), connects to the socket (§4.3), sends the handshake (§4.5), then pipes bytes both ways until either side closes, and exits. It never logs the token.
- If the socket is not reachable (the app is not running, or Agent Access is off), the bridge writes one line to stderr, "L'Atelier is not running or Agent Access is off", and exits non-zero (3). A missing or malformed token exits 2. If the app refuses the handshake (unknown or revoked token, or an unsupported protocol) it prints one stderr line ("L'Atelier refused this Agent token", or "L'Atelier does not support this bridge's protocol version") and exits 4. On Windows, if the pipe is not served by a process of the current user (or that cannot be checked), it sends no token, prints one stderr line and exits 5. It never starts the app.
- Because the bridge is separate, `electron/main.ts` needs no early-dispatch change: there is no second mode of the app, no interaction with `requestSingleInstanceLock()`, and the `runAsNode` fuse stays off.

### 4.3 Socket

- **macOS and Linux**: a Unix domain socket `agent.sock` inside a directory `agent/` under `userData`, created with mode `0700`, the socket itself `0600`. If the full path would exceed the platform limit (about 104 bytes on macOS, 108 on Linux; long E2E temp dirs hit this), it falls back to a short per-user directory (`$TMPDIR/latelier-<uid>/`, also `0700`). A stale socket file is removed at start only when nothing answers on it.
- **Windows**: a named pipe `\\.\pipe\latelier-agent-<random suffix>`. The bridge reads the suffix from the file under `userData`, so it needs no user SID. Node's `net` module cannot set a pipe DACL, and the default security descriptor is not owner-only. The Windows threat model therefore relies on the token alone against other users (decided, open question 2). The pipe name carries a random suffix generated at first enable and stored in a file under `userData` that only the owning user can read, so the name is not guessable by another user, but this is not an access control. The suffix is fresh on every start, and the endpoint file is cleared at launch and before listening, so a crash cannot leave a name a later process could squat. Before it sends the token the bridge checks that the pipe server runs as the current user. Settings → Agent Access and the share dialog say so on Windows in plain words. A native ACL helper is a possible follow-up, not part of this spec.
- The bridge derives the socket path from the app's platform-default `userData` location (and tries the short-path fallback above if the first is absent), so the client configuration does not hold it. `LATELIER_AGENT_SOCKET`, if set, overrides it; the E2E tests use that for their throwaway `userData`. Settings shows the path for troubleshooting.

### 4.4 Lifecycle

- **Starts** when Agent Access is on, after the pool and services are built in `app.whenReady()`.
- **Stops** when Agent Access is turned off: the listener closes, every live session closes, and in-flight work is cancelled (§10).
- **At quit**, "stop agent server" is the **first** step of the teardown sequence in `beginShutdown`, before the pool disconnects. Agent work does not count in `runningWork()` and never triggers the quit prompt.
- **Test instances** (`ATELIER_USER_DATA_DIR` set) put the socket under their throwaway `userData`, so parallel or leftover instances never collide.

### 4.5 Handshake and sessions

> Amended by [X29](./X29-agent-access-mcp-2026.md) §2 and §3: each session is served in the protocol era the client opens with, and client info comes from each request in the 2026-07-28 era.

- The bridge's first line on the socket is `{"agentToken":"<token>","protocol":1}\n`. Main hashes the token and compares it in constant time against the stored hashes (§5). A `protocol` value main does not support is refused the same way, so a bridge and an app that drifted apart fail loudly instead of mis-speaking. On failure it writes one JSON-RPC error line and closes. On success the rest of the stream belongs to MCP.
- Main runs one MCP `Server` per socket connection, over the SDK's `StdioServerTransport` constructed on the socket's own streams (the SDK supports this for Unix sockets). `maxBufferSize` is set to 1 MiB, so an oversized message closes that session only.
- `initialize.clientInfo` (name and version) is recorded with the token's name on every Agent Read Log row.
- The session's token is re-checked on every tool call, so a revoked token stops a live session at its next call.

## 5. Agent Tokens

### 5.1 Model

A new table `agent_tokens`: `id` (UUID), `name` (user-chosen, e.g. "Claude Code, laptop"), `token_hash` (SHA-256 of a 32-byte random token), `created_at`, `last_used_at`. The plaintext token is never stored.

### 5.2 Actions

- **Add Agent**: name it. Main generates the token and shows it once, in a main-owned dialog, with a **Copy configuration** button.
- **Copy configuration** is a button of that main-owned dialog, so no IPC channel can trigger it. It puts a ready-to-paste client snippet on the clipboard through main's `clipboard.writeText`. The command is the absolute path of the fixed per-user copy of the bridge executable (§15 question 5), there are no args, and `env.LATELIER_AGENT_TOKEN` holds the token. Snippets are offered for Claude Code, Claude Desktop and Cursor. For Claude Code the dialog offers two: **Copy Claude Code command**, first, puts `claude mcp add latelier --scope user -e LATELIER_AGENT_TOKEN=<token> -- <bridge path>` on the clipboard, and **Copy for Claude Code (JSON)** puts the `.mcp.json` form. The server name comes before `-e`, which takes several values. The bridge path is one shell word: bare when it holds only `A-Z a-z 0-9 _ . / -`, otherwise double-quoted with `\ " $ \`` escaped on macOS and Linux (the macOS path holds a space and an apostrophe), and double-quoted as it is on Windows. After a copy, the dialog's note says what to do next (for the command: run it in a terminal, then `claude mcp list`). The token never crosses IPC to the renderer, and the renderer cannot read it back off the clipboard: `electron/security/permissions.ts` denies it `clipboard-read`, and that denial stays a requirement of this spec.
- **Regenerate**: a new token replaces the hash and the old token stops working at once, live sessions included.
- **Revoke**: the row is deleted; live sessions using it close.
- The list shows name, created and last used. It never shows the token.

### 5.3 Logging

No log line, error or Agent Read Log row ever carries a token. `electron/log.ts` redacts the key `token` by field name only, so the handshake parser must never log the raw line or a header-like structure.

## 6. Agent read path

### 6.1 `AgentGate`

A small main-process module in front of the pool, with the same `readDb`/`readClient` shape the services use:

- It checks the three gates (§2) and the session's token on every acquisition.
- It returns the Connection's **agent client** (§6.2), never the user's pooled client, and never calls `MongoPool.connect`.
- It registers each operation's `AbortController` under its Connection id for revocation (§10).

### 6.2 Agent client per shared Connection

- Each shared Open Connection gets a separate `MongoClient`, opened lazily on the first Agent call, from the same URI, credentials and TLS as the pooled client, with `maxPoolSize: 2`. Agent queries never queue behind, or block, the user's own UI, even when the user set `maxPoolSize: 1`. The cost is up to two extra server connections per shared Connection.
- It is closed when the Connection closes or drops, when its flag is turned off, when Agent Access is turned off, and at quit.
- SSH-tunnelled Connections: the connection schema refuses SSH tunnels today (`SSH_UNSUPPORTED_MESSAGE` in `electron/ipc/schemas/connection.ts`), and `MongoPool.openControlClient` refuses them too. When tunnels land, an SSH-tunnelled Connection stays unshareable with Agents until a follow-up spec makes the agent client reuse the tunnel (decided, open question 3). `agentAccess:set-shared` refuses it with a clear message.

### 6.3 No side effects on the user's workspace

The Agent path does not call `QueryService.find`, `AggregationService.run` or `MetaService.sampleSchema` as they are:

- They record to `recent_queries`. Agent reads never appear in the user's recent queries.
- `AggregationService.run` increments the quit-prompt counter, hard-codes a 30 s `maxTimeMS` and `allowDiskUse: true`, and runs `instrument()` alongside every run. None of that applies to Agents.
- `QueryService.find` loads the whole batch and then throws when it exceeds the byte cap. Agents get a truncated result instead (§9.2).
- `MetaService.sampleSchema` turns every error into an empty sample. Agents get the error.

So the Agent tools use their own small find, count and aggregate functions over `AgentGate`, sharing only the pure helpers (EJSON encoding, write-stage set, error mapping). No agent conditionals are threaded through the UI services.

### 6.4 Load limits

| Limit | Value |
| --- | --- |
| `maxTimeMS` on every operation | 10 000 ms |
| `allowDiskUse` | `false` |
| Concurrent Agent operations per Connection | 2; up to 4 more wait; beyond that the call fails with `BUSY` |
| `skip` | at most 10 000 |
| Pipeline | at most 30 stages, at most 64 KiB as JSON |
| Filter, projection, sort | at most 16 KiB each as JSON |
| `comment` on every command | `"latelier-agent"`, so a DBA can find Agent operations in `currentOp`, the profiler and the slow-query log |

## 7. What an Agent may run

### 7.1 Find options

`find` accepts `filter`, `projection`, `sort`, `limit` and `skip` only, through a strict zod schema. Everything else (`hint`, `let`, `collation`, `readConcern`, `comment`, `allowDiskUse`, `maxTimeMS`, `batchSize`, `tailable`) is rejected, not ignored.

### 7.2 Pipeline stages

An **allowlist**, checked on every stage, and recursively inside `$facet`, `$lookup.pipeline` and `$unionWith.pipeline`:

`$match`, `$project`, `$addFields`, `$set`, `$unset`, `$group`, `$sort`, `$limit`, `$skip`, `$unwind`, `$count`, `$sortByCount`, `$bucket`, `$bucketAuto`, `$facet`, `$replaceRoot`, `$replaceWith`, `$lookup`, `$graphLookup`, `$unionWith`, `$sample`, `$redact`, `$densify`, `$fill`, `$setWindowFields`, `$geoNear`.

Anything else is refused with `STAGE_NOT_ALLOWED`, naming the stage. That includes `$out`, `$merge`, `$collStats`, `$indexStats`, `$planCacheStats`, `$changeStream`, `$currentOp`, `$listSessions`, `$documents`, `$search` and `$vectorSearch`, and any stage a future server version adds. The existing `writeStages.ts` check stays as a second line.

### 7.3 Server-side JavaScript

`$where`, `$function` and `$accumulator` are refused **anywhere**: filter, projection (find projections accept aggregation expressions), sort, and every stage at any depth. The scan is recursive over keys. The error tells the Agent to use `$expr` instead.

This is about load, not deprecation: MongoDB deprecated these operators in 8.0, and 9.0 brought them back on a WASM engine. They run a JavaScript function per document, which is slow and easy to point at a large collection.

### 7.4 Namespaces

Denied in every tool, for every Agent:

- the databases `admin`, `local` and `config`;
- any collection whose name starts with `system.`.

These names are checked on the tool's own target, on `$lookup.from`, `$graphLookup.from` and `$unionWith.coll` (string form). The object form of `from` (`{ db, coll }`, used by Atlas Data Federation) is refused outright. `$lookup` joins only within the same database (MongoDB documents this for `$lookup`; for `$graphLookup` and `$unionWith` it is to verify), so checking the collection names covers the reachable set.

The same rule filters `list_databases` and `list_collections`, so the Agent is never shown what it cannot read.

## 8. Tools

> Amended by [X29](./X29-agent-access-mcp-2026.md) §4: in the 2026-07-28 era, a call on a shared Connection that is closed can pause and ask the user to open it.

Every tool has `annotations: { readOnlyHint: true, openWorldHint: false }`, and a strict input schema. A tool returns no `outputSchema` and no `structuredContent`: some clients show the model only the structured part of a result and drop the text, which hid the documents themselves (found in a real client).

| Tool | Input | Returns |
| --- | --- | --- |
| `list_connections` | none | Shared Connections: `id`, `name`, `state` (`available` or `unavailable`). For available ones, also their visible databases. Never host, URI, user or Read-Only flag. |
| `list_databases` | `connectionId` | Database names after §7.4. |
| `list_collections` | `connectionId`, `database` | Collection and view names, with their type, after §7.4. |
| `list_indexes` | `connectionId`, `database`, `collection` | Index names, keys and options. No `$indexStats`. |
| `collection_schema` | `connectionId`, `database`, `collection`, `sampleSize?` (default 50, max 200) | Field paths, BSON types per path, and how often each appears in the sample. **No values.** Inferred in main. |
| `find` | target + §7.1 | Documents (§9). |
| `count` | target + `filter?` | A count. Without a filter, or with an empty one (`{}`), `estimatedDocumentCount`, labelled as an estimate. |
| `aggregate` | target + `pipeline` | Documents (§9). A `$limit` is appended. |
| `explain_find` | target + §7.1 | The `queryPlanner` plan only. Never `executionStats`, which runs the query. |
| `explain_aggregate` | target + `pipeline` | The same, for a pipeline. |

The server's `instructions` say that results are untrusted data, list the limits in §6.4 and §9.2, and point to `explain_*` to check for a collection scan before a heavy query. Explain is advisory: no tool refuses a query because of its plan.

## 9. Results

### 9.1 Format

Documents are **Relaxed EJSON** (numbers as numbers, dates as `$date` ISO strings, `$oid`, `$numberDecimal` and other type markers kept where JSON cannot carry the type). Relaxed EJSON does not distinguish `Int32`, `Int64` and `Double` for values that fit, which is acceptable for reading. The server instructions say so.

### 9.2 Limits and truncation

- `limit` defaults to 50, at most 200.
- Each response carries at most 1 MiB of serialised Relaxed EJSON. The cursor is iterated with a byte budget: when the next document would exceed it, iteration stops and the cursor is closed. A single document larger than the budget is replaced by a stub naming its `_id` and size.
- Truncation is always explicit: `truncated: true`, `appliedLimits: ["limit" | "bytes"]`, and a sentence in the text content saying how many documents were returned and why it stopped.

### 9.3 Untrusted-data envelope

- **Text content** carries the documents between `<untrusted-data-<nonce>>` and `</untrusted-data-<nonce>>`, with a fresh random nonce per response and one line saying the content is data, not instructions.
- **Metadata line**: one plain line written by the app, after the closing tag and outside the envelope (`Returned N items. truncated: B. limits: none|limit, bytes. D ms.`, plus `estimate: B.` for a count). It carries numbers and fixed words only, never a document value or a name. There is no `structuredContent`, so no client can show unwrapped data in its place or drop the data from the text.
- Database, collection and field names come from the server and can be chosen by whoever controls the data. In text they stay inside the envelope, and each one is cut to 256 characters.

### 9.4 Errors

Errors are mapped to stable codes (`NOT_SHARED`, `NOT_OPEN`, `ACCESS_OFF`, `NAMESPACE_DENIED`, `STAGE_NOT_ALLOWED`, `JS_NOT_ALLOWED`, `INVALID_INPUT`, `BUSY`, `TIMEOUT`, `CANCELLED`, `DB_ERROR`). They come with a short message the app wrote. The driver's own message is never forwarded, because it can echo field values, namespaces and hosts. `DB_ERROR` carries the server's numeric error code only.

## 10. Revocation and in-flight work

Each of these cancels every Agent operation in flight on the affected Connections, through the `AbortController`s `AgentGate` registered (the driver's `signal` option, as `QueryService` already uses):

| Event | Affects |
| --- | --- |
| Agent Access turned off | every Connection; also closes the listener and every session |
| Shared with Agents turned off | that Connection |
| Connection closes, drops or is deleted | that Connection (via the pool's `status` event) |
| Token revoked or regenerated | that token's sessions |
| App quit | everything, first in the teardown |
| MCP `notifications/cancelled` from the client | that one request (the SDK exposes it as the handler's abort signal) |

The driver (7.7) accepts no abort signal on `listIndexes` or `estimatedDocumentCount`. Those two run to their end after a token revoke or an MCP cancel; revoking or closing the Connection, or turning Agent Access off, still stops them because the agent client is closed. Their result is discarded either way. An edit that changes which server or user a Connection points at (the fields the app already treats as identity) clears its Shared with Agents flag and cancels its in-flight work; the user shares it again through the dialog.

After every `await` that returns data, the gates are checked again, **before** serialising. A result that arrives after revocation is discarded, and the call returns `CANCELLED`. No data leaves the app after the user said stop.

## 11. Agent Read Log

### 11.1 Table

> Amended by [X29](./X29-agent-access-mcp-2026.md) §5: `outcome` also takes `INPUT_REQUIRED`, for a call's asking round.

A new table `agent_read_log` with these columns:

- `id`, `ts`
- `token_id` and `token_name`, the name copied at write time
- `client_name`, `client_version` (from `initialize.clientInfo`)
- `connection_id` and `connection_name`, the name copied at write time
- `database`, `collection`, `tool`
- `request_json`: the filter, projection, sort and pipeline as sent
- `doc_count`, `bytes`, `duration_ms`
- `outcome`: `ok`, or the error code
- `truncated`

One row per tool call, including refused ones: a refusal is the most interesting row.

### 11.2 Rules

- `request_json` holds literals from the user's data, so it goes through `ColumnCipher` like the filters X21 encrypts in `recent_queries` and `audit_log`. Database and collection names follow the Audit Log's treatment.
- **No foreign key cascade.** Rows survive the deletion of their Connection or token, because the history is the point, and the copied names keep them readable.
- **Retention: 90 days**, the same as the Audit Log, pruned by `MaintenanceService`.
- It is not the Audit Log: [ADR 0002](../docs/adr/0002-audit-log-scope.md) scopes that to writes with undo, and its `op` CHECK constraint is fixed.
- **Fail closed.** The row is written before any data is returned to the Agent, and a call whose row cannot be written returns `DB_ERROR` with no data. A read the user cannot see afterwards does not happen.
- `request_json` is capped at 16 KiB, with a truncation marker, so oversized requests (which are refused and still logged) cannot grow the table.

### 11.3 Iteration 1 UI

A count: "N Agent reads this session" in the status-bar indicator and in Settings, plus the last-used time on each token. The viewer is out of scope.

## 12. UI

### 12.1 Settings → Agent Access

- The switch, with the confirmation in §3.1.
- When on: "Agents can connect", the socket path, the read count, and the token list with **Add Agent**, **Regenerate**, **Revoke**.
- **Shared Connections**: every Connection that is Shared with Agents, whether it is open, and a **Stop sharing** button on each. While Agent Access is off the list says that no Agent can reach them. With none shared, it says where to share one from.
- **Next step**: when Agent Access is on and a Connection is shared but there is no Agent Token yet, a line says to add an Agent to get its configuration.
- **Set up Claude Code**: numbered steps for the CLI path: turn Agent Access on, add an Agent and choose **Copy Claude Code command** in the token window, run it in a terminal, check with `claude mcp list` (and `/mcp` inside Claude Code), then share a Connection and ask. It shows the command's shape, built by main with the placeholder `YOUR_TOKEN` in place of the token (`AgentAccessState.claudeCodeCommand`, never a token), says what `--scope user` does, and how to remove it (`claude mcp remove latelier`).
- **Hint**: the `agents.share` feature hint (X06 §4) points new users at the status-bar control.
- Short copy on what Agents can do (read shared, open Connections) and cannot do (write, see credentials, open Connections). It recommends a read-only database user.

### 12.2 Status bar

The status bar carries an **Agents** control whenever a Connection is focused or Agent Access is on. Its visible text is "Agents · N" (the session read count) while Agent Access is on and "Agents off" while it is off. It opens a menu that:

- names the focused Connection and says whether it is Shared with Agents, with the last privilege-check result when it is;
- offers **Share "‹name›" with Agents…** or **Stop sharing "‹name›" with Agents**, naming the Connection so it never reads as sharing the collection on screen. Share is disabled with "Open this Connection first" while the Connection is not open;
- offers **Agent Access settings…**, which opens §12.1.

This is the entry point from a collection or data view: the user never has to leave the workspace to share what they are looking at.

### 12.3 Connections

- **Share with Agents** and **Stop sharing with Agents** actions on a Connection: the connection menu (Switcher and Connections table), the navigator root's context menu, the Server Tab and the status bar (§12.2). Share goes through §3.2's dialog. In the navigator, Share is disabled with "Open this Connection first" while the Connection is not open.
- A shared Connection carries a small marker on its navigator root and Tab Group header while Agent Access is on. Its tooltip gives the last privilege-check result.

## 13. IPC (5-file contract)

Renderer-facing channels. None takes or returns a token. All go through `shared/ipc.ts`, `electron/preload.ts`, a zod schema with `router.register`, and a `registerAgentAccessChannels` call in `electron/main.ts`:

- `agentAccess:get-state` → `{ enabled, socketPath, sessionReadCount, sessionCount, tokens: [{ id, name, createdAt, lastUsedAt }], bridgeInstalled, bridgePath, platformCaveat, privilege }`
- `agentAccess:remove-bridge`: removes the per-user bridge copy; refused while Agent Access is on
- `agentAccess:request-enable` (main dialog), `agentAccess:disable`
- `agentAccess:set-shared` `{ connectionId, shared }`: on `true`, main runs §3.3 and its dialog
- `agentAccess:add-token` `{ name }`, `agentAccess:regenerate-token` `{ id }`: the token is shown and copied in main-owned UI only
- `agentAccess:revoke-token` `{ id }`
- `agentAccess:state-event` (push): the same state object

No channel carries a secret from the renderer, so the `SECRET_INPUT` allowlist is unchanged. The `ipc-channel-auditor` agent confirms this.

## 14. Alternatives considered

- **Embed or wrap the official MongoDB MCP server.**
  - **As a child process:** it wants a connection string, which would take credentials out of main (against ADR 0014). It would also open its own clients, and SSH, TLS and auth options would have to be rebuilt.
  - **As a library in main:** possible, since its v3 packages accept an existing `MongoClient`. But it brings a large dependency tree (mongosh service provider, Atlas client, telemetry) into the signed bundle, behind an embedding API reshaped in v3. It would also give their tools the app's raw writable client instead of a read path the app controls. The token, lifecycle and connection-mapping work, which is most of the effort, would still be ours.
  - **Its patterns are copied:** untrusted-data envelope, explicit truncation, server-side-JS refusal, result limits.
- **Streamable HTTP on `127.0.0.1` with a bearer token.**
  - It needs a port, which another local process can squat while the app is closed to collect tokens.
  - It needs Origin/Host checks against DNS rebinding.
  - Claude Desktop's remote connectors are reportedly reached from Anthropic's side and could not reach a loopback address, so a stdio bridge would likely be needed anyway (not verified, and not needed to reject HTTP).
  - The socket plus bridge removes all three problems.
- **`ELECTRON_RUN_AS_NODE` script as the bridge.** Blocked by the `runAsNode` fuse, which stays off.
- **The app's own Electron binary with `--agent-stdio`.** Spiked and measured (§4.2): about 185 ms to first byte, about 214 MB RSS across three processes per Agent client session, and a brief Foreground state at launch, so a Dock flash is likely each time a client starts the bridge. It would also force the main entry to become a dispatcher so the bridge runs before the SQLite and logger imports and before the single-instance lock. Rejected.
- **A helper `.app` with `LSUIElement`.** Would remove the macOS Dock flash but is macOS-only, still boots Electron, and electron-builder has no clean support for it. Not tried.
- **A Node single-executable bridge.** Keeps the repository to one language but embeds a Node runtime, roughly 60 to 100 MB per bridge. Rejected for size.
- **The user's pooled client for Agent queries.** Simpler, but at `maxPoolSize: 1` every Agent query would block the user's UI for up to 10 s.
- **A stage denylist.** Every stage a server version adds would be allowed by default.
- **Following the Focused Tab instead of a share flag.** Switching tabs would change what an Agent can reach in the middle of its task.
- **Logging Agent reads in the Audit Log.** Its scope is writes with undo (ADR 0002), and its `op` CHECK cannot be widened in place.

## 15. Open questions

None block implementation. Each was decided before it started:

1. **Resolved: bridge start-up.** The Electron binary measured too slow and too heavy and flashes in the Dock, so the bridge is a separate Rust executable (§4.2, §14). The Unix spike is done; the Windows named-pipe client, cross-compilation for every shipped target, and signing are still to build.
2. **Resolved: Windows pipe ACL.** Node's `net` cannot set an owner-only DACL, so Windows ships with the token as the only protection against other local users, a random pipe-name suffix kept in a user-only file, and a plain statement of this in the UI (§4.3). A native ACL helper is a later follow-up, and adding one needs its own decision because the repository has one native dependency today.
3. **Resolved: SSH-tunnelled Connections.** They cannot be shared with Agents. A follow-up spec makes the agent client reuse the tunnel when tunnels land (§6.2).
4. **Resolved: stage allowlist review.** Checked against the MongoDB manual:
   - The oldest server the app supports is 4.4: driver 7.6 and later (the app uses `^7.7`) dropped 4.2. Every allowlisted stage except `$setWindowFields` (5.0), `$densify` and `$fill` (5.1) exists on 4.4. On an older server those three fail with the server's own unknown-stage error, which §9.4 maps to an app-written message. No stage needs removing.
   - Every allowlisted stage is read-only. The stages that write or expose server state (`$out`, `$merge`, `$collStats`, `$indexStats`, `$planCacheStats`, `$currentOp`, `$listSessions`) stay refused.
   - `$graphLookup.from` must be in the same database as the other collections the operation uses (documented). `$unionWith.coll` takes a collection or view name with no database part, so the string form resolves in the current database by construction, and the object form stays refused (§7.4). Add a test that an object-form `coll` and `from` are refused.
5. **Resolved: stable bridge path.** The app copies the bridge to a fixed per-user location and the snippet points there: `latelier-agent-bridge` in `~/Library/Application Support/L'Atelier/bin/` on macOS and `~/.local/share/L'Atelier/bin/` on Linux, `%LOCALAPPDATA%\L'Atelier\bin\latelier-agent-bridge.exe` on Windows. Main copies it on enabling Agent Access and on each launch when the bundled file's size or SHA-256 differs from the copy, writes through a temporary file and renames it in place, and keeps the executable bit. On macOS the copy keeps the bundled signature (copying does not invalidate it) and a release-workflow step verifies this. The path never changes across updates, moves of the app, or AppImage mounts. Disabling Agent Access leaves the copy in place; uninstalling the app does not remove it, and Settings offers a "Remove bridge" action.

## Acceptance criteria

- With Agent Access off, nothing listens and the bridge exits 3 with its stderr message.
- The bridge is a std-only Rust executable that is built for every shipped target, present in every package, signed on macOS and unsigned on Windows (where the app itself is unsigned) (on macOS, Developer ID signed with the hardened runtime inside the app bundle so it is covered by the app's notarization, checked by a release-workflow step such as `codesign --verify --strict` on the built bridge before upload, in the style of `scripts/verify-fuses.mjs`), never logs the token, and rejects a token with characters outside `A-Z a-z 0-9 - _`. The handshake carries `protocol: 1` and an unsupported protocol is refused.
- Agent Access can only be turned on through main's dialog. Writing its `app_state` key from the renderer is refused.
- Shared with Agents can only be set through `agentAccess:set-shared` and its dialog. A `shareWithAgents` key sent to `conn:create` or `conn:update` is stripped and leaves the stored flag unchanged. Duplicate, Export, Import and Family Export never carry it.
- The share dialog shows the privilege result in each of the four §3.3 cases. No authenticated user and a failed check never read as a pass.
- An Agent reaches a Connection only when all three gates hold. A shared Dormant or closed Connection is listed as `unavailable` and is never connected by an Agent call.
- Agent calls use the agent client, never the user's pool. They write nothing to `recent_queries` and do not count in `runningWork()`.
- Every stage outside §7.2 is refused at any depth. `$where`, `$function` and `$accumulator` are refused in filter, projection, sort and pipeline. §7.4 namespaces are refused as targets and as `$lookup`/`$graphLookup`/`$unionWith` sources, and are absent from listings.
- Find options outside §7.1 are rejected.
- Results respect the limits and the byte budget, and truncation is always explicit. Documents appear only inside the nonce envelope in the text content; results carry no `structuredContent`, and the metadata line outside the envelope holds no document value or name.
- Driver error messages never reach the Agent.
- Each event in §10 cancels the affected in-flight operations. A result arriving after revocation is discarded.
- Tokens are stored as hashes only, shown once, and never cross IPC to the renderer. Revoke and Regenerate stop live sessions at their next call.
- Every tool call, refused ones included, writes one Agent Read Log row before any data is returned, and a call whose row cannot be written returns no data. `request_json` is encrypted and capped at 16 KiB, and rows survive Connection and token deletion. They are pruned after 90 days.
- The renderer is still denied `clipboard-read`.
- On macOS and Linux the socket's directory is `0700` and the socket `0600`, with the short-path fallback when needed.
- Every operation carries `comment: "latelier-agent"`, `maxTimeMS: 10000` and `allowDiskUse: false`. The per-Connection concurrency cap returns `BUSY` beyond the queue.
- The new pure modules (stage and namespace validation, JS-operator scan, schema inference, byte-budgeted encoding, gate logic) are in `stryker.config.json`'s `mutate` list at 90% or higher.

## Test cases

**Unit**

- `agent-pipeline-guard.spec.ts`:
  - each allowlisted stage passes and each listed refused stage fails;
  - an unknown `$future` stage fails;
  - the same rules apply nested inside `$facet`, `$lookup.pipeline` and `$unionWith.pipeline`, three levels deep.
- `agent-pipeline-guard.property.spec.ts` (fast-check): for any generated pipeline that contains a refused stage or a JS operator at any depth, the guard refuses it; for any pipeline built only from allowlisted stages with operator-free bodies, it accepts it.
- `agent-namespace-guard.spec.ts`:
  - `admin`, `local`, `config` and `system.*` refused as targets and in every cross-collection form;
  - object-form `from` refused;
  - names cut at 256 characters.
- `agent-find-options.spec.ts`: every disallowed option is rejected.
- `agent-schema-infer.spec.ts`: paths, types and frequencies for nested documents and arrays, with no value from any document in the output.
- `agent-result-budget.spec.ts`:
  - stops at the byte budget with `appliedLimits: ["bytes"]`;
  - an oversize single document becomes a stub;
  - the limit path sets `["limit"]`.
- `agent-envelope.spec.ts`: a fresh nonce per response, and a document containing a closing tag with a guessed nonce does not close the envelope.
- `agent-error-map.spec.ts`: driver errors whose message carries a value, namespace or host map to codes with app-written messages only.
- `agent-token.spec.ts`: hash and constant-time compare; the handshake parser never logs its input.

**Integration** (real SQLite, `mongodb-memory-server`)

- `agent-gate.spec.ts`:
  - each gate off refuses;
  - a Dormant shared Connection is never connected;
  - a Connection closed mid-query cancels it and discards the result;
  - turning off sharing, Agent Access or the token mid-query does the same.
- `agent-tools.spec.ts`:
  - each tool end to end through an in-process MCP client over a socket pair;
  - nothing lands in `recent_queries`;
  - the concurrency cap returns `BUSY`;
  - `comment`, `maxTimeMS` and `allowDiskUse: false` appear on every command the driver sends, observed through the driver's command monitoring (the server's `currentOp` is not used: the operations are too short to catch reliably).
- `agent-privilege-check.spec.ts`: read-only user, readWrite user and auth-off server, each giving its §3.3 result.
- `agent-read-log.spec.ts`:
  - one row per call, including refusals;
  - a failing insert makes the call return `DB_ERROR` with no documents;
  - `request_json` is encrypted at rest and capped at 16 KiB;
  - rows survive Connection deletion;
  - retention prunes at 90 days.
- `connection-export.spec.ts`, extended: an exported shared Connection carries no share field, and the imported one is unshared.
- `agent-access-handlers.spec.ts`: each channel's validation, and a `shareWithAgents` key sent to `conn:create` and `conn:update` being stripped, leaving the stored flag unchanged.

**Component** (mocked `window.atelier`)

- `settings-agent-access.spec.tsx`: off and on states, token list, and that no token ever appears in rendered output.
- `share-with-agents.spec.tsx`: the marker shows only while Agent Access is on, and its tooltip shows the last privilege result.
- `agent-status-indicator.spec.tsx`: with no focused Connection, hidden when off; shows the count; click opens Settings.
- `agents-share-hint.spec.tsx`: the hint shows on a collection tab of an open Connection while Agent Access is off and nothing is shared, sits above the status-bar control, opens Settings from Set up, and stays hidden otherwise.
- `agent-snippets.spec.ts`: the Claude Code command's exact text, and that a real `/bin/sh` reads the quoted bridge path back as one word for paths with spaces, apostrophes and shell metacharacters.
- `agent-share-entry-points.spec.tsx`: the Claude Code setup steps, and the status-bar control shows "Agents off" for a focused Connection, shares or stops sharing it by name, disables Share while it is not open, and opens Settings; the navigator root menu offers Share (disabled while not open) and Stop sharing; Settings lists the shared Connections with their open state and a Stop sharing button, and shows the next step only while something is shared and no Agent exists.
- `agent-privilege-check.spec.ts` (sharing while off): one "Turn on and share" dialog does both on confirm and neither on cancel; a closed Connection is asked to be opened first; a Connection changed while the dialog was open is neither shared nor leaves Agent Access on.

**E2E**

- Turn on Agent Access, share a Connection, add an Agent, then start the built bridge executable with the token (and `LATELIER_AGENT_SOCKET` for the throwaway `userData`) as a child process from the test:
  - `list_connections` lists the shared Connection;
  - `find` returns documents;
  - stopping the share makes the next call fail with `NOT_SHARED`.
- Bridge with Agent Access off exits 3 with its stderr message; with no token it exits 2; with a token the app refuses it exits 4.
- A bridge speaking an unsupported `protocol` is refused.

**Manual**

- Configure Claude Code, Claude Desktop and Cursor with the copied snippet against a signed build. Ask each for a count and a find on a shared Connection. Confirm no Dock icon appears on macOS, that the bridge is signed and notarized in the packaged build, and that the configured path still works after an auto-update.

## Definition of done

All eight gates in `CLAUDE.md` § Definition of done apply. This is code, a migration, build config and IPC. The bridge crate adds `cargo test` and `cargo clippy` runs to the build script; they do not replace any gate.
