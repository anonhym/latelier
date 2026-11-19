# Research: the official MongoDB MCP server (baseline for L'Atelier's MCP server)

**Version read:** npm `mongodb-mcp-server@3.1.0` (dist-tag `latest`, published 2026-10-15, Apache-2.0), git tag `v3.1.0`, commit `f369482783bdef116c35d352fd9d92f6c984242f` ([npm registry](https://registry.npmjs.org/mongodb-mcp-server), [tag](https://github.com/mongodb-js/mongodb-mcp-server/tree/v3.1.0)). `main` is at `3.1.1-pre.1` (324ee0f); the files cited below were re-checked at `v3.1.0`, and line numbers are for that tag.
Source is a pnpm monorepo. Paths below are relative to `packages/` at the tag: `core`, `tools-mongodb`, `tools-atlas`, `tools-atlas-local`, `tools-assistant`, `cli`, `http-runners`.
**Docs read:** MongoDB's [Security Best Practices](https://www.mongodb.com/docs/mcp-server/local-mcp/security-best-practices.md) page, plus the [docs index](https://www.mongodb.com/docs/mcp-server/llms.txt). The repo [README](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/README.md) is cited where it adds something the code doesn't.

Where this says "(code)" the claim was checked in source, not just the README.

## 1. Tool surface

Every tool class declares `static toolName`, `static category` and `static operationType` (`read | metadata | connect | create | update | delete`). Operation type drives the MCP annotations (`readOnlyHint`, `destructiveHint`) in [`core/src/toolBase.ts` L460-488 on main](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/core/src/toolBase.ts) and the read-only gate.

### MongoDB (category `mongodb`, `tools-mongodb/src/tools/*`), 25 tools
Index: [`tools.ts`](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/tools-mongodb/src/tools/tools.ts).

| Tool | Type | What it does |
|---|---|---|
| `connect` | connect | Open a new connection from a connection string (optional `connectionName`); returns a `connectionId`. |
| `disconnect` | connect | Close a connection. |
| `list-connections` | metadata | List active connections and their ids (state, redacted description, `lastError`). |
| `find` | read | `find` with filter, projection, sort, `limit` (default 10), `responseBytesLimit` (default 1 MiB). |
| `aggregate` | read | Collection-level pipeline (incl. `$search`/`$vectorSearch`). |
| `aggregate-db` | read | Database-level pipeline (e.g. `$currentOp`-style stages). |
| `count` | read | `countDocuments`. |
| `export` | read | Stream a `find` or `aggregate` result to an EJSON file under `exportsPath`; returns a resource link. |
| `list-databases` | metadata | |
| `list-collections` | metadata | |
| `collection-indexes` | metadata | Indexes of a collection. |
| `collection-schema` | metadata | Schema inferred from a `$sample` (default 50 docs, hard-capped). |
| `collection-storage-size` | metadata | |
| `db-stats` | metadata | |
| `explain` | metadata | `explain` for find/aggregate/count. |
| `mongodb-logs` | metadata | `getLog` (global or startupWarnings). |
| `insert-many`, `create-index`, `create-collection` | create | |
| `update-many`, `rename-collection` | update | |
| `delete-many`, `drop-collection`, `drop-database`, `drop-index` | delete | |

### Atlas (category `atlas`, `tools-atlas/src/tools/*`), 20 tools; need `apiClientId`/`apiClientSecret`
| Group | Tools |
|---|---|
| read | `atlas-list-orgs`, `atlas-list-projects`, `atlas-list-clusters`, `atlas-inspect-cluster`, `atlas-list-db-users`, `atlas-inspect-access-list`, `atlas-list-alerts`, `atlas-get-performance-advisor`, `atlas-get-regions`, `atlas-streams-discover` |
| connect | `atlas-connect-cluster`: creates a temporary DB user (4 h default, `atlasTemporaryDatabaseUserLifetimeMs`) and connects. Role is `readAnyDatabase` in read-only mode, else `readWriteAnyDatabase` ([`roles.ts` L29-37](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/tools-atlas/src/helpers/roles.ts)). |
| create | `atlas-create-project`, `atlas-create-cluster`, `atlas-create-free-cluster`, `atlas-create-db-user`, `atlas-create-access-list`, `atlas-load-sample-dataset`, `atlas-streams-build` |
| update | `atlas-pause-resume-cluster`, `atlas-upgrade-cluster`, `atlas-streams-manage` |
| delete | `atlas-streams-teardown` |

### Atlas Local (category `atlas-local`, `tools-atlas-local`), 4 tools (Docker)
`atlas-local-list-deployments` (read), `atlas-local-connect-deployment` (connect), `atlas-local-create-deployment` (create), `atlas-local-delete-deployment` (delete).

### Other
Category `assistant` (`tools-assistant`): `search-knowledge`, `list-knowledge-sources` (both read; query MongoDB's hosted docs knowledge base at `assistantBaseUrl`, default `https://knowledge.mongodb.com/api/v1/`). A `mcpUI` preview feature adds web UI resources (README "Opting into Preview Features").

Total: about 51 tools. Categories usable in `disabledTools`: `mongodb`, `atlas`, `atlas-local`, `assistant`.

## 2. Read-only mode and enforcement

**Mechanism = tool registration by operation type, not by inspecting calls.** `ToolBase.verifyAllowed()` ([`core/src/toolBase.ts` L843-870](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/core/src/toolBase.ts)):

```ts
if (this.server.config.readOnly && !["read", "metadata", "connect"].includes(this.operationType)) { ... }
else if (this.server.config.disabledTools.includes(this.category)) ...
else if (this.server.config.disabledTools.includes(this.operationType)) ...
else if (this.server.config.disabledTools.includes(this.name)) ...
```

A tool failing this check is never registered (logged at debug). `disabledTools` accepts a mix of tool names, categories and operation types ([`userConfig.ts` L82-86 area](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/cli/src/config/userConfig.ts)). README: "all tools that have create, update or delete operation types will not be registered" ([README "Read-Only Mode"](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/README.md#read-only-mode)). Default `readOnly: false`.

**Pipeline inspection exists as a second layer.** `MongoDBToolBase.assertMqlIsAllowed` -> `assertSingleMqlValueIsAllowed` ([`mongodbTool.ts` L215-238](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/tools-mongodb/src/mongodbTool.ts)) is called by `find`, `count`, `aggregate`, `aggregate-db`, `export`, `explain`, `update-many`, `delete-many`:

| Question | Answer (code) |
|---|---|
| `aggregate` blocks `$out` / `$merge`? | **Yes in read-only** (also when any of `create`/`update`/`delete` is in `disabledTools`): `"In readOnly mode you can not run pipelines with $out or $merge stages."` via `assertNoWriteStages` ([`mqlGuards.ts` L89-95](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/tools-mongodb/src/helpers/mqlGuards.ts)). Only **top-level** stages are scanned (`"$out" in stage`); the code comment says they are not permitted in sub-pipelines by the server anyway. `export` rejects them unconditionally. |
| `$out` / `$merge` when *not* read-only | Allowed, but `aggregate`/`aggregate-db` ask for elicitation confirmation naming the target namespace ([`aggregate.ts` L249-262](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/tools-mongodb/src/tools/read/aggregate.ts), [`writeStageConfirmation.ts`](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/tools-mongodb/src/helpers/writeStageConfirmation.ts)). `confirmWriteStages` returns `null` (no prompt, runs) when the client does not support elicitation. |
| `$function` / `$accumulator` / `$where` | Blocked by default. `disableServerSideJs` defaults to **true** ([`userConfig.ts` L135-142](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/cli/src/config/userConfig.ts)). `SERVER_SIDE_JS_OPERATORS = ["$where", "$function", "$accumulator"]`, found by a recursive key scan of filter, projection and pipeline, any depth ([`mqlGuards.ts` L7-54](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/tools-mongodb/src/helpers/mqlGuards.ts)). Matching is by key name only. |
| Index-check / collscan guard | Opt-in: `indexCheck` default **false**. When true, `find`, `count`, `aggregate` run `explain("queryPlanner")` first and reject if the winning plan is not an index stage ([`indexCheck.ts`](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/tools-mongodb/src/helpers/indexCheck.ts)). It **fails open**: `// If explain itself fails, log but do not prevent query execution` (L94). Unknown plan shapes count as collscan (conservative). |
| Other limits | `maxTimeMS` (optional, unset by default) is passed to read ops ([`mongodbTool.ts` `getOperationOptions`](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/tools-mongodb/src/mongodbTool.ts)). |

**Caveats worth knowing (code-verified):**
- Read-only mode allows the `connect` operation type. The `connect` tool takes an **arbitrary connection string from the agent**, and `atlas-connect-cluster` / `atlas-local-connect-deployment` also run in read-only. Read-only gates MongoDB-side writes by tool; it does not constrain which deployments the agent can reach.
- The server relies on the DB user for ground truth. MongoDB's docs say to "use a read-only database user" in addition to `--readOnly` ([security best practices](https://www.mongodb.com/docs/mcp-server/local-mcp/security-best-practices.md#read-only-database-access)).
- `readOnly`, `indexCheck`, `disableServerSideJs` are `oneWayOverride(true)`: a per-request config override (`allowRequestOverrides`) may tighten them but never loosen them ([`userConfig.ts` L110-142](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/cli/src/config/userConfig.ts)).
- Confirmation (`confirmationRequiredTools`) defaults to destructive tools only: `drop-database`, `drop-collection`, `delete-many`, `drop-index`, `atlas-create-access-list`, `atlas-create-db-user`, `atlas-streams-manage`, `atlas-streams-teardown`.

## 3. Connection model

| Aspect | Behaviour |
|---|---|
| Sources | (a) `connectionString` config / `MDB_MCP_CONNECTION_STRING` / `--connectionString` (a secret field, [`userConfig.ts` L49-55](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/cli/src/config/userConfig.ts)); (b) `connect` tool at runtime; (c) Atlas API credentials via `atlas-connect-cluster`; (d) Atlas Local via Docker. |
| Handles | In 3.x every data tool takes a **required `connectionId`**; there is "deliberately no implicit current connection" ([`mongodbTool.ts` L100-108 area](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/tools-mongodb/src/mongodbTool.ts)). The preconfigured connection has the reserved id `preconfigured` and is lazily dialed. |
| Runtime switching | Yes, unrestricted: multiple concurrent connections, `connect` / `disconnect` / `list-connections`. Cap `maxActiveConnections` = 10 per scope (LRU eviction); idle reaper `connectionIdleTimeoutMs` = 600 000 ms ([`userConfig.ts` L194-215](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/cli/src/config/userConfig.ts)). |
| Scope | `connectionScope` `session` (default) or `global`; marked deprecated, moving to `global`. |
| Secrets | `Keychain` (immutable, built once from config: connection string, Atlas client id/secret, password, username, TLS passphrases, AWS tokens, Voyage key) redacts via `mongodb-redact` ([`createKeychainFromConfig.ts`](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/cli/src/config/createKeychainFromConfig.ts), [`keychain.ts`](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/core/src/keychain.ts)). All loggers extend `RedactingLoggerBase` and redact by default (per-call `noRedaction` opt-out). Connection errors are redacted before reaching the model ([`mongodbTool.ts` L258-270 area](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/tools-mongodb/src/mongodbTool.ts)). `list-connections` exposes only host type + auth type, never the URI ([`connectionSummary.ts`](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/tools-mongodb/src/common/connectionSummary.ts)). |
| Gap | A connection string passed to the `connect` tool is **not** in the keychain (the keychain is fixed at construction); the code comment says per-request strings are "kept out of emitted strings by construction". The agent itself necessarily sees and sends that string. |
| Docs advice | Prefer env vars over CLI args for secrets ([README](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/README.md), [docs](https://www.mongodb.com/docs/mcp-server/local-mcp/security-best-practices.md#secrets-and-environment-variables)). |

## 4. Transports

| | |
|---|---|
| Options | `transport`: `stdio` (default) or `http` ([`userConfig.ts` L144-152](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/cli/src/config/userConfig.ts)). HTTP is the Streamable HTTP endpoint `POST /mcp` (Express; legacy sessionful and modern sessionless handlers, [`mcpHttpServer.ts`](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/http-runners/src/mcpHttpServer.ts)); `httpResponseType` default `sse`. |
| Default bind | `httpHost` `127.0.0.1`, `httpPort` `3000` (port 0 = random). |
| Non-loopback | **Refused at startup** unless `dangerousHostBinding` / `MDB_MCP_DANGEROUS_HOST_BINDING` is true. Only `127.0.0.1`, `localhost`, `::1` are safe ([`expressBasedHttpServer.ts` L31-65](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/http-runners/src/expressBasedHttpServer.ts)). |
| Auth | **No built-in auth.** README "Deployment Constraints": "ships with no built-in authentication ... not meant to serve multiple users". The only control is `httpHeaders`: a static map of header -> exact value; a mismatch gets `403 Invalid value for header` ([`mcpHttpServer.ts` L207-218](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/http-runners/src/mcpHttpServer.ts)). That is a shared secret, compared with `!==` (not constant-time). No Origin/DNS-rebinding check was found in the files read (negative finding, not exhaustively proven). |
| Body | `httpBodyLimit` (default `TRANSPORT_PAYLOAD_LIMITS.http`, 1 MiB fallback in `express.json`). |
| Sessions | `maxSessions`, `idleTimeoutMs` 600 000, LRU eviction. Separate optional monitoring server (`/health`, `/metrics`), own host/port, same loopback rule. |

## 5. Result handling

| Item | Value |
|---|---|
| `maxDocumentsPerQuery` | default **100**; `0`/negative disables. `find`: effective limit = min(tool `limit` (default 10), config). `aggregate`: appends `{ $limit: maxDocumentsPerQuery }` to the pipeline ([`aggregate.ts` L264-267](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/tools-mongodb/src/tools/read/aggregate.ts)). |
| `maxBytesPerQuery` | default **16 777 216** (16 MiB); upper bound for tool arg `responseBytesLimit` (default **1 MiB**). The cursor is read until the next doc would hit the limit ([`collectCursorUntilMaxBytes.ts`](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/tools-mongodb/src/helpers/collectCursorUntilMaxBytes.ts)). Bytes are BSON `calculateObjectSize`, not the serialized JSON length. |
| Truncation signal | Both in text and structured: `structuredContent.appliedLimits` (enum `config.maxDocumentsPerQuery` / `config.maxBytesPerQuery` / `tool.responseBytesLimit`) plus a message like "The aggregation resulted in N documents. Returning M documents while respecting the applied limits of ...", pointing at `export` for the full set ([`aggregate.ts` L455-482](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/tools-mongodb/src/tools/read/aggregate.ts), [`constants.ts`](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/tools-mongodb/src/helpers/constants.ts)). |
| Total count | A parallel count (`find`: `countDocuments`, cap `queryCountMaxTimeMsCap` 10 s; `aggregate`: pipeline + `$count`, cap `aggregationCountMaxTimeMsCap` 60 s) so the model knows the true size. On timeout `count` is `"indeterminate"` / undefined (`operationWithFallback`). Costs a second scan per call. |
| Format | EJSON via Compass `objectToIdiomaticEJSON` ([`bsonToJson.ts`](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/tools-mongodb/src/helpers/bsonToJson.ts)): `{"$oid":..}`, `{"$numberLong":..}` etc. (idiomatic = Compass's relaxed-ish style, not strict canonical). Returned **twice**: `content` text (`JSON.stringify(documents)`) and `structuredContent` (`documents`, `count`, `appliedLimits`) with an `outputSchema`. `export` uses `promoteValues:false, bsonRegExp:true` (lossless) and writes a file. |
| Untrusted data | `formatUntrustedData` wraps documents in `<untrusted-user-data-{uuid}> ... </...>` with a random UUID per response plus a warning not to act on instructions inside ([`toolBase.ts` L1076-1140](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/core/src/toolBase.ts)). Applies to the **text** content only; `structuredContent.documents` is unwrapped. Opt-out: `disableUntrustedDataWarning` (default false). |
| Write-pipeline path | A pipeline with `$out`/`$merge` skips all limits (`toArray()` uncapped). |

## 6. PII, telemetry, logging

- **PII redaction in data:** none. Documents are returned as stored. Redaction covers config secrets and generic patterns in logs (a logger test asserts `<email>` redaction of log messages, in `RedactingLoggerBase` tests). Atlas Streams has its own `redactSensitiveKeys`.
- **Telemetry:** on by default (`telemetry: "enabled"`), sends usage events to MongoDB (tool name, category, `operation_type`, connection metadata, client info). Disabled by `MDB_MCP_TELEMETRY=disabled`, `--telemetry disabled`, or `DO_NOT_TRACK=1` ([README "Telemetry"](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/README.md#telemetry), [`atlasTelemetry.ts` L269-290](https://github.com/mongodb-js/mongodb-mcp-server/blob/v3.1.0/packages/atlas-telemetry/src/atlasTelemetry.ts)). Events are keychain-redacted before send. I did not enumerate the exact event fields.
- **Logging:** `loggers` default `["disk","mcp"]` (also `stderr`); disk logs at `logPath` (docs warn to lock down that folder); `mcpClientLogLevel` default `debug` forwards logs to the client over MCP logging. All redacting by default.
- Exports land in `exportsPath` and are cleaned up on a timer (`exportCleanupIntervalMs` 120 s); README flags the directory as sensitive.

## 7. Implications for L'Atelier

Facts first, then opinions marked **(opinion)**.

**Match (worth copying):**
- Read-only enforced by *tool registration*, plus a pipeline write-stage check on top, plus tool annotations (`readOnlyHint`). **(opinion)** For L'Atelier read-only should not be a flag at all: ship no write tools.
- Block `$out` / `$merge` and, by default, `$where` / `$function` / `$accumulator` (recursive key scan); keep it one-way (can tighten, never loosen). **(opinion)** Also reject them when nested in `$lookup`/`$facet`/`$unionWith`; the scan already recurses for JS ops but the write-stage check is top-level only.
- Result caps with an explicit truncation signal: `appliedLimits` enum + human message + total count. Defaults of 100 docs / 1 MiB per call are reasonable.
- Wrap returned documents in a random-nonce untrusted-data envelope; return EJSON; provide `outputSchema`.
- Loopback-only HTTP by default with an explicit opt-out; stdio as the default transport.
- Redact secrets from every log and error path by construction.
- `maxTimeMS` on all server ops; `explain` as a separate metadata tool.

**Deliberately differ:**
- **Connection selection.** Official server takes a connection string (env or agent-supplied via `connect`) and lets the agent mint new connections. L'Atelier should expose *only the connections the user has open in the app*, referenced by an opaque id, with no `connect` / `disconnect` tool and no way for an agent to supply a URI, host or credentials. Credentials stay in the main process; the agent never sees them. Include the tab's connection name and host type, like `list-connections` (never the URI).
- **Auth on HTTP.** Official has none beyond a static header. **(opinion)** If L'Atelier offers HTTP, use a per-launch random bearer token, constant-time compare, Origin/Host validation (DNS rebinding), loopback only, and no `dangerousHostBinding` escape hatch. Prefer stdio or a local socket bridge.
- **User consent.** Official trusts whoever starts it. **(opinion)** L'Atelier can gate per connection (user toggles "expose to agents"), show which agent calls what, and let the user revoke live.
- **Untrusted-data envelope on `structuredContent` too.** Official wraps text only; clients that read `structuredContent` get raw documents. **(opinion)** Either skip structured documents or wrap/flag them.
- **Count query.** Official runs a second scan for the total on every call; **(opinion)** make this opt-in or cheaper (`estimatedDocumentCount` when no filter) on large collections.
- **Telemetry:** default-off or absent. Official is on by default.

**Gaps not to copy:**
- `indexCheck` fails open when `explain` errors, and is off by default. **(opinion)** If we add a collscan guard, fail closed or make it advisory in the response.
- Read-only still allows `connect*` tools (agent-controlled targets), the main reason it is not a real sandbox. The docs lean on a read-only DB user for that reason.
- Write pipelines (`$out`/`$merge`) skip result caps and, without elicitation support, run unconfirmed.
- JS-operator guard is key-name matching only; `$expr`-style or future operators are not covered. A server-side privilege boundary (read-only role) is still the real control.
- `aggregate-db` and `mongodb-logs` expose cluster internals (`$currentOp`, logs) beyond "query data". **(opinion)** Leave out of v1 unless a user need appears.
- Tool-description defaults and sampling in `collection-schema` return real document values to the model; no PII redaction layer. **(opinion)** Consider an optional field-level redaction (by field name or pattern) since our users run it on production data.
