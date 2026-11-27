# X29 — Agent Access on MCP 2026-07-28: protocol negotiation and a pause for a closed Connection

> **Status: Draft.**

## Purpose

[X27](./X27-agent-access.md) shipped Agent Access on the MCP SDK's plain `Server.connect(transport)` path, which speaks only the 2025-era protocol (`initialize` handshake, `2025-11-25` and older). The MCP specification revision **2026-07-28** removes the `initialize` handshake and protocol-level sessions, makes every request carry its own protocol version, client info and client capabilities in `_meta`, and replaces server-to-client requests with **multi round-trip requests** (MRTR): a `tools/call` may answer `resultType: "input_required"` with embedded requests (an elicitation, for example), and the client retries the call with the answers.

Current Agent clients (Claude Code, Claude Desktop) already ship 2026-07-28 client code, and the pinned SDK (`@modelcontextprotocol/server` 2.4.0) can serve it. X29 does two things:

1. **Serve both eras.** A 2026-07-28 client gets the 2026-07-28 protocol; a 2025-era client is served exactly as today.
2. **Pause instead of failing when a shared Connection is closed.** Today a call on a shared but closed Connection ends with `NOT_OPEN`, and the user has to open the Connection and then ask the Agent again. With MRTR the call asks the user to open it in L'Atelier and continues when they confirm.

It also records why the two other 2026-07-28 features, Skills over MCP and Tasks, are not adopted yet.

## Scope

### In

- Serving each Agent session through the SDK's era-negotiating stdio entry, `serveStdio`, on the existing per-socket transport (§2).
- Reading client info per request in the 2026-07-28 era, so the Agent Read Log keeps its `client_name` and `client_version` (§3).
- One MRTR elicitation: a call on a shared, closed Connection asks the user to open it and retries the gate on the answer (§4).
- A new Agent Read Log outcome for the asking round (§5).
- A bridge comment and test update; no bridge behaviour change (§6).

### Out — deliberately

- **Anything that grants access through an elicitation.** Turning on Agent Access, sharing a Connection, opening a Connection on the Agent's behalf, and every future write approval stay in L'Atelier's own main-process dialogs. An elicitation answer comes from the Agent client, which can produce one without asking anyone (§4.4).
- **A full-collection-scan confirmation.** X27 §8 makes explain advisory, and a confirmation would need an explain before every `find` and `aggregate`, one more round-trip on the user's server per call. Revisit only with evidence that Agents run harmful scans.
- **Skills over MCP** (`io.modelcontextprotocol/skills`). The SDK ships a server API for it (`@modelcontextprotocol/server/ext/skills`), and the server instructions could move into a `skill://latelier/SKILL.md`. The extension is still beta and host support is still being built, and the instructions already reach every client today. Revisit when a supported host loads skills from a server.
- **Tasks** (`io.modelcontextprotocol/tasks`). SDK 2.4.0 has no server API for the extension, only the method names it uses for HTTP headers. Long aggregations stay bounded by X27 §6.4.
- **Sampling and roots.** Both are deprecated in 2026-07-28, and Agent Access has no use for either.
- **Structured results.** Tools stay text-only (X27 §8).

## Dependencies

- [X27](./X27-agent-access.md): everything here amends its §4.5 (handshake and sessions), §8 (tools), §9.4 (errors) and §11.1 (Agent Read Log columns). Every X27 rule not named here is unchanged.
- MCP specification [2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog), in particular [multi round-trip requests](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr).
- `@modelcontextprotocol/server` 2.4.0, already pinned: `serveStdio` and `StdioServerTransport` from `@modelcontextprotocol/server/stdio`; `inputRequired` and `inputRequired.elicit` from the package root.

## 1. Terms

- **Era**: the protocol family a connection speaks. **Modern** is 2026-07-28; **legacy** is 2025-11-25 and older. The SDK picks the era from the connection's opening message and keeps it for the connection's lifetime.
- **Envelope**: the per-request `_meta` keys of the modern era: `io.modelcontextprotocol/protocolVersion`, `io.modelcontextprotocol/clientInfo` and `io.modelcontextprotocol/clientCapabilities`. The SDK exposes them to a handler as `ctx.mcpReq.envelope`.
- **Asking round**: a `tools/call` that answers `resultType: "input_required"` instead of a result.

## 2. Era negotiation

- `AgentSession` keeps one MCP `Server` per authenticated socket, and keeps the low-level `Server`, for X27's reason: it hands the raw `arguments` to the runner, so a call that fails schema validation still writes its Agent Read Log row.
- Instead of `server.connect(transport)`, the session calls `serveStdio(factory, { transport, legacy: 'serve', onerror })`. The transport is the same `StdioServerTransport` on the socket's streams with the same 1 MiB `maxBufferSize`. `serveStdio` then owns the transport: it starts it, reads every message and closes it. `AgentSession` stops calling `connect` and closes the session through the handle that `serveStdio` returns.
- **Keeping "an oversized message closes that session only."** `serveStdio` installs its own `onclose` and `onerror` on the transport, which replaces the two handlers `AgentSession.start()` sets today. Without the `onclose` one, an oversized message would close the SDK transport but leave the socket open, and the bridge would wait on a socket nothing reads. Two changes keep the behaviour:
  - The warn log moves to `serveStdio`'s `onerror` option, still logging the error's class only.
  - Right after `serveStdio` returns (it assigns its handlers synchronously, before the transport starts), `AgentSession` wraps the transport's `onclose`: it calls the SDK's handler first, then ends the socket. The pinned `Server`'s own `onclose` is not enough: it fires only once an era is pinned, and an oversized *first* message arrives before that.
- The factory builds the `Server` with the same tools, the same `instructions` and the same `capabilities: { tools: {} }` in both eras. In the modern era the SDK answers `server/discover` from it, so the instructions still reach the client.
- **A probe session is normal.** An SDK client in automatic negotiation mode over the base stdio client transport sends its `server/discover` probe from a short-lived sibling process, started from the same command. For L'Atelier that means one extra bridge spawn and one extra socket session per connect: token handshake, `server/discover`, close. That session calls no tool and writes no Read Log row. It must log nothing above debug level. Today `AgentServer.sessionCount`, which feeds presence (the status bar's "Connected now"), counts every authenticated socket, so a probe would show up as a second client for a moment. X29 counts a session only once it has received a request other than `server/discover`. Which clients probe this way depends on their own MCP client, so the app must not assume either way.
- `legacy: 'serve'` keeps every 2025-era client working unchanged: it opens with `initialize` and is served the way a hand-wired stdio server is served today.
- The token handshake (X27 §4.5) is unchanged and still comes first: the handshake reader holds the socket paused and pushes back any bytes after the token line, and `serveStdio` starts reading only once the session is attached.
- The token is still re-checked on every tool call. Losing protocol-level sessions changes nothing here: the socket stays the unit of identity, and the token was never a protocol session.
- `ttlMs` and `cacheScope` on `server/discover` and `tools/list` keep the SDK defaults (`0`, `"private"`). The tool list never changes during a session, so caching saves nothing.

## 3. Client info

- **Legacy era:** unchanged. `initialize.clientInfo`, read through `server.getClientVersion()`.
- **Modern era:** `getClientVersion()` returns nothing, because there is no `initialize`. Each call reads `io.modelcontextprotocol/clientInfo` from `ctx.mcpReq.envelope` instead. Spec rules: clients SHOULD send it, not MUST, so a call without it records `null`, as a legacy client without `clientInfo` does today.
- Both values are cut to 128 characters, as today, because the client chooses them.
- The value is read per call, not per session: in the modern era nothing ties one request's client info to the next.

## 4. Pausing for a closed Connection

### 4.1 When it applies

All of these hold:

- The connection is in the modern era.
- The request's client capabilities (from the envelope) declare form-mode elicitation: `elicitation.form`, or a bare `elicitation: {}` that names neither `form` nor `url`. That is the SDK's own rule (a bare declaration keeps its pre-mode meaning of form support), so the app reuses the SDK's capability check rather than writing its own.
- The tool takes a `connectionId`: every tool except `list_connections`.
- The call would end in `NOT_OPEN` from the gate (X27 §6.1): Agent Access is on, the Connection is shared, and it is not connected. That covers both the admission check and a Connection that closed while the call waited for a slot; either way, the lease is released before the asking round answers.
- The request carries no answer to this question yet.

Otherwise the call fails with `NOT_OPEN`, as today. `ACCESS_OFF` and `NOT_SHARED` never ask: granting access is the user's decision inside L'Atelier, not an answer in the Agent's host (§4.4).

### 4.2 The asking round

The call answers `input_required` with one embedded request, keyed `openConnection`:

- `method: "elicitation/create"`, `mode: "form"`.
- `message`, written by the app: `The Connection "<name>" is closed. Open it in L'Atelier, then accept to continue.` `<name>` is the Connection name the user chose, cut to 256 characters. Nothing from the database goes into the message.
- `requestedSchema: { type: "object", properties: {} }`. The question has no fields: accepting is the answer. (Probed against SDK 2.4.0: a client accepts this schema, and both `accept` and `decline` reach the handler.)
- No `requestState`. The retry runs the gate again from scratch, so there is nothing to carry between rounds and nothing to forge.

The asking round holds no concurrency slot (X27 §6.4), opens no agent client and returns no data.

### 4.3 The retry

The client retries the same `tools/call` with `inputResponses.openConnection`:

- **`accept`:** the gate runs again. If the Connection is now connected, the call proceeds as any other call does, with the same token check, limits and Read Log row. If it is still not connected, the call fails with `NOT_OPEN` and asks no second time, so one call never asks more than once.
- **`decline` or `cancel`:** the call fails with `NOT_OPEN` immediately.
- An answer under any other key is ignored.

The SDK client's default is to fulfil and retry automatically, so to the Agent the whole exchange is one tool call.

### 4.4 An answer is not consent

`inputResponses` comes from the Agent client. A client, or a process talking to the socket with a stolen token, can send `accept` without showing the user anything. That is harmless here by construction: `accept` only makes the app run the gate again, and the gate reads the Connection's real state in main. It never opens a Connection, shares one or widens access. Any later use of MRTR must keep this property: an answer may change what the app asks or re-checks, never what an Agent is allowed to reach.

## 5. Agent Read Log

- The asking round writes its own row, before the `input_required` answer goes out (fail closed, X27 §11.2). Its `outcome` is a new code, `INPUT_REQUIRED`, with `doc_count` 0 and `bytes` 0. The retry writes its own row with its own outcome. A paused call therefore shows as two rows: `INPUT_REQUIRED`, then `ok` or `NOT_OPEN`.
- `outcome` has no `CHECK` constraint (migration 020 left it open on purpose), so no migration is needed. The repository's list of valid outcomes gains `INPUT_REQUIRED`.
- The session read count (X27 §11.3, "N Agent reads this session") counts every row it is told about today, refused ones included. It skips `INPUT_REQUIRED` rows, so a paused call counts as one read, not two.
- `INPUT_REQUIRED` is a Read Log outcome only. It is not an error code in X27 §9.4's sense, and no Agent ever receives it as an error.

## 6. Agent Bridge

- No behaviour change. The bridge relays bytes and reads only the app's first line, to spot the token refusal (X27 §4.2).
- In the modern era the app's first line is the reply to `server/discover`, or to whichever request the client sends first, instead of the reply to `initialize`. A result line carries no `"error"`, so it is never mistaken for a refusal. A database value inside a result is JSON-escaped (`\"code\":-32001`), so it cannot match the refusal pattern either.
- The refusal codes `-32001` and `-32002` sit in the range 2026-07-28 leaves to implementations (`-32000` to `-32019`), so they stay as they are.
- `relay.rs`'s comment on `classify_first_line`, which names only `initialize`, is updated to say "the reply to the client's first request", and a unit test adds a `server/discover` reply as a non-refusal first line.

## 7. Alternatives considered

- **Stay on the legacy path only.** Works today, since both eras are negotiable and current clients still fall back to `initialize`. But the legacy path is the one the specification is moving away from (roots, sampling and logging are already deprecated, with a 12-month window), and the pause in §4 needs the modern era.
- **Hand-roll era detection in `AgentSession`.** `serveStdio` already implements the opening rules, the envelope checks and the `subscriptions/listen` routing, and it is tested upstream. Re-implementing them would only add drift.
- **Use the legacy era's server-to-client `elicitation/create` for the pause.** The specification removed that pattern in 2026-07-28. It would also hold a request open on the socket for as long as the user takes.
- **Ask in L'Atelier instead of in the Agent's host** (a main-process dialog: "An Agent wants to read *X*, which is closed. Open it?"). It would put the question where the Connection is, but it opens a Connection on the Agent's request, which X27 excludes. It also pops a window in front of whatever the user is doing. The elicitation leaves the decision and the action with the user.

## 8. Open questions

None block implementation.

## Acceptance criteria

- A client pinned to 2026-07-28 can discover the server, list the ten tools with their annotations, and call each one through the bridge, with results identical to the legacy era's.
- A 2025-era client (opening with `initialize`) is served exactly as before X29.
- The server instructions reach a modern client through `server/discover`.
- Agent Read Log rows carry the client's name and version in both eras, cut to 128 characters, and `null` when the client sends none.
- In the modern era, a call on a shared, closed Connection from a client that declares form elicitation answers `input_required` with one `openConnection` elicitation, no `requestState`, and a message naming only the Connection.
- After `accept`, the retried call succeeds if the Connection is now open and fails with `NOT_OPEN` otherwise, without asking again. After `decline` or `cancel` it fails with `NOT_OPEN`.
- A client without form elicitation, a legacy-era client, `ACCESS_OFF`, `NOT_SHARED` and `list_connections` never get an asking round.
- The asking round writes an `INPUT_REQUIRED` Read Log row before it answers, holds no concurrency slot and opens no agent client.
- A revoked token is refused on the retry, as on any call.
- The bridge relays a modern session unchanged and exits 0 at its end.
- An oversized message, first or mid-session, in either era, ends that socket and no other.
- A discovery-only probe session writes no Read Log row, logs nothing above debug level and never shows in presence.
- A paused call adds one to the session read count, not two.

## Test cases

- `agent-server.spec.ts` (integration): an SDK client pinned to `2026-07-28` over the real socket: `server/discover` returns the instructions and `supportedVersions` containing `2026-07-28`; `tools/list` matches the legacy list. An SDK client with default negotiation still gets a working session. A 2025-era opening (`initialize` with no envelope) still works. An oversized first message, and an oversized message after a pinned era, each end the socket (the client sees EOF) while a second session on another socket keeps working. A session that sends only `server/discover` and closes writes no Read Log row and no warn line.
- `agent-read-log.spec.ts`: `client_name` and `client_version` from the envelope in the modern era, from `initialize` in the legacy era, `null` when absent, cut to 128 characters.
- `agent-gate.spec.ts` / `agent-tools.spec.ts`: the pause matrix: modern + form elicitation + `NOT_OPEN` asks; each of legacy era, no elicitation capability, `ACCESS_OFF`, `NOT_SHARED`, `list_connections` does not. `accept` with the Connection opened between rounds returns data; `accept` while still closed returns `NOT_OPEN` with no second ask; `decline` and `cancel` return `NOT_OPEN`. Two Read Log rows per paused call. After an asking round the Connection's concurrency limiter is idle and no agent client was opened for it. A token revoked between rounds is refused on the retry.
- A test that the elicitation message contains the Connection name and nothing from the database, and that a 300-character name is cut to 256.
- `bridge/src/relay.rs` unit test: a `server/discover` reply as the first line is not a refusal.
- `tests/e2e/x27-agent-access.e2e.ts`: the existing flows pass unchanged. One new flow: an SDK client pinned to 2026-07-28, through the packaged bridge, on a shared Connection that is closed, opens it from the app between rounds and gets documents.

## Definition of done

The project's Definition of done in `CLAUDE.md`, with no gate skipped. On landing, this spec's status line moves to `Implemented` and X27 §4.5, §8 and §11.1 gain a one-line pointer to the X29 sections that amend them.
