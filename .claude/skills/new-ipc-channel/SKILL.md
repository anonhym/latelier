---
name: new-ipc-channel
description: Scaffold a new IPC channel across all 5 files (shared types, preload binding, zod schema + handler, main.ts wiring). Use when adding a new channel like `doc:archive`, `saved:rename`, or extending an existing domain. Invoke with `/new-ipc-channel domain verb` — e.g., `/new-ipc-channel saved rename`.
disable-model-invocation: true
---

You are scaffolding a new IPC channel for the mongo-lab project. The user will invoke this skill with a domain and verb (e.g., `saved rename`). Your job is to produce the diff that wires the channel end-to-end.

## The 5-file pattern

Every IPC channel must touch:

1. `shared/ipc.ts`
   - Add `<camelCased>: '<domain>:<verb>'` to `IPC_CHANNELS`.
   - Add `<verb>: (input: ...) => Promise<...>` to `IpcApi.<domain>`.
   - Import any new types from `shared/types.ts`.
2. `electron/preload.ts`
   - Add `<verb>: (input) => call(IPC_CHANNELS.<camelCased>, input)` inside the appropriate domain block.
3. `electron/ipc/handlers/<domain>.ts`
   - Add a Zod schema for the input.
   - Register the channel with `router.register(IPC_CHANNELS.<camelCased>, zodValidator(schema), (input) => svc.<method>(input))`.
4. `electron/services/<Domain>Service.ts` or `electron/mongo/<Domain>Service.ts`
   - Add the service method. Throw `AppError` subclasses for known failure modes.
5. If the input contains plaintext secrets (password, token, passphrase, sshPassword):
   - Add a `// SECRET_INPUT` comment on the handler registration line.
   - Add the channel to `scripts/ipc-secret-allowlist.txt`.

Also: at least one new test in `tests/integration/` that drives the channel through the router. Use `tests/integration/saved-query-service.spec.ts` or `query-service.spec.ts` as a template.

## Workflow

1. **Ask clarifying questions** if the user gave just a name:
   - What does the channel do?
   - What's the input shape?
   - What does it return?
   - Does it touch secrets?
   - Does the service method already exist, or do we need to add it?

2. **Read the existing handler file** (`electron/ipc/handlers/<domain>.ts`) and the service file to match the code style (Zod schema naming, error classes, etc.).

3. **Produce the diff as a single edit plan**. Show the user each file that needs editing. Don't actually edit until confirmed — the user may refine the schema or naming.

4. **Run the verifications after editing**:
   - `npx tsc -b --noEmit` — types still align.
   - `npm run audit:ipc` — secret allowlist check.
   - `npm run lint`.
   - If integration test added: `npx vitest run --project integration <new-test-file>`.

## Reference: existing channel as a template

Read `electron/ipc/handlers/saved.ts` — it shows the full pattern (Zod schemas, multiple verbs, typed router.register calls). Mirror that style, not the oldest file in the tree.

## Things to get right

- **Channel names are `domain:verb`**, kebab-case for multi-word verbs (`saved:delete-many` not `saved:deleteMany`). The constant name in `IPC_CHANNELS` is camelCase: `savedDeleteMany`.
- **Zod schemas** use `z.string().min(1)` for non-empty, `z.number().int().min(0)` for counts, `z.enum([...])` for unions. Look at `FindInputSchema` in `electron/ipc/handlers/query.ts` for the canonical style.
- **Envelope handling is automatic** — the router wraps success/error. Your service method just returns the raw value or throws an `AppError`.
- **Never leak a raw `Error`** across the boundary. Classify Mongo errors via `classifyQueryError` or `classifyDocError` patterns in their respective services.
- **Renderer never imports `electron/*`** — the IPC call from the UI goes through `src/api/mongolab.ts` (`api.<domain>.<verb>(input)`), which is auto-typed from `IpcApi`.

## Output

End with a checklist:

```
## New channel: <domain>:<verb>

Files edited:
- [ ] shared/ipc.ts — constant + IpcApi method
- [ ] electron/preload.ts — bridge binding
- [ ] electron/ipc/handlers/<domain>.ts — Zod schema + register
- [ ] electron/services/<Domain>Service.ts — method
- [ ] tests/integration/<domain>-<verb>.spec.ts — integration test
- [ ] scripts/ipc-secret-allowlist.txt — (only if secret)

Verified:
- [ ] npx tsc -b --noEmit
- [ ] npm run audit:ipc
- [ ] npm run lint
- [ ] npx vitest run --project integration <spec>
```
