# C04 — Test connection action

## Purpose

A short-lived, non-persisting probe that validates a user-supplied connection configuration before they hit Save. Must handle every auth mechanism, map driver errors to user-actionable categories, and finish (success or fail) within a small, predictable time budget so the UI stays responsive.

## Scope

- **In**: `conn:test` IPC channel handler, reuse of `MongoPool.probe` (F05), timeout/cancellation behavior, mapping to form UX (C03 §10).
- **Out**: Saving anything (C02), building the form (C03).

## Dependencies

- C01 (input), C03 (form flow), F05 (`probe`).

## 1. IPC channel

| Channel      | Input             | Output       | SECRET? |
| ------------ | ----------------- | ------------ | ------- |
| `conn:test`  | `ConnectionInput` | `ProbeResult` | yes (plaintext secrets in payload) |

Validation: same `ConnectionInputSchema` used by `conn:create`, except `password`, `sshPassword`, `sshPassphrase` are allowed to be missing even for mechanisms that would require them at save time — the probe simply fails with `AUTH`.

## 2. Handler

```ts
// electron/mongo/ConnectionService.ts (addendum)
test(input: ConnectionInput): Promise<ProbeResult> {
  // 1. Strip ssh block (iteration 1: SSH deferred; if ssh.enabled is true, short-circuit)
  if (input.ssh?.enabled) {
    return {
      ok: false,
      errorCode: 'UNKNOWN',
      errorMessage: 'SSH tunnels are not supported in this iteration.',
    };
  }
  // 2. Delegate to pool.probe with an absolute 10-second cap
  return withTimeout(this.pool.probe(input), 10_000, {
    ok: false,
    errorCode: 'TIMEOUT',
    errorMessage: 'Test timed out after 10 seconds.',
  });
}
```

`withTimeout` races the probe with a timer; on timeout it signals the MongoClient's `AbortController` so the TCP socket is torn down rather than leaked.

## 3. Probe internals (refers F05)

`MongoPool.probe(input)` is deliberately independent of the persisted pool:
1. Build URI + options using the provided input (plaintext password direct from form).
2. Set probe-specific overrides: `serverSelectionTimeoutMS: 5000`, `connectTimeoutMS: 5000`, `maxPoolSize: 1`.
3. `client = new MongoClient(uri, options)`; `await client.connect()`.
4. `t0 = Date.now(); await client.db('admin').command({ ping: 1 }); roundTripMs = Date.now() - t0;`
5. `const info = await client.db('admin').command({ buildInfo: 1 });`
6. Determine topology by inspecting `client.topology?.description.type` if available; fallback to `Unknown`.
7. `await client.close();`
8. Return `{ ok: true, serverVersion: info.version, topology, roundTripMs }`.

Any throw → classify via `electron/mongo/errors.ts`:

```ts
function classify(err: unknown): { code: ProbeResult['errorCode']; message: string };
```

## 4. UX sequencing (renderer)

C03 owns the state machine:
- Clicking **Test** disables the button (not the form).
- A small spinner replaces the icon.
- Envelope failure (`ok: false`) is rendered identically to a probe failure: the UI reads `envelope.error.details` if present, else `envelope.error.message`.
- Successful probe auto-clears after 6 seconds unless the user opens the Advanced tab, which might reveal different fields.
- A second Test click while the first is pending cancels the prior call via `AbortController.abort()` on the renderer side (our wrapper supports this) and the handler responds with `code: 'INTERNAL'` and a message about cancellation. UI ignores the cancelled response.

## 5. Cancellation

- `ipcRenderer.invoke` itself is not cancellable. We wrap it in a helper that attaches an abort channel:
  - `conn:test` actually has two channels: `conn:test:start` → returns a token, `conn:test:cancel` → takes the token.
  - The handler stores its `AbortController` keyed by token; cancel calls `abort()`.
  - Simpler alternative kept for this spec: `conn:test` blocks up to 10 seconds and the UI just disables the button. This is what we ship. (Cancellation is a stretch goal; the spec lists the token design for future reference.)

## 6. Acceptance criteria

- [ ] A valid config against a reachable Mongo returns `{ ok: true }` within 2s on a local server.
- [ ] An unreachable host returns `errorCode: 'NETWORK'` and does not leak an open MongoClient (verify via tests spying on `.close()`).
- [ ] A valid host with wrong password returns `errorCode: 'AUTH'`.
- [ ] A timeout returns `errorCode: 'TIMEOUT'` within ≤ 10 seconds total.
- [ ] Calling `conn:test` with `ssh.enabled: true` returns a friendly "not supported" message (no attempt to connect).
- [ ] Running Test does not insert any row into `connections`, `connection_secrets`, or touch `last_used_at`.

## 7. Test cases

### Unit
- **error-classifier.spec.ts**: see F05 test list — fixture errors for AUTH / NETWORK / TIMEOUT / TLS / UNKNOWN.
- **ssh-short-circuit.spec.ts**: `test(input with ssh.enabled=true)` resolves without touching `pool.probe`.

### Integration (Vitest + `mongodb-memory-server` + safeStorage mock)
- **happy-path.spec.ts**: valid input → `{ ok: true, serverVersion, roundTripMs }`.
- **no-persistence.spec.ts**: call `test`; then assert `connections` table is empty and `connection_secrets` is empty.
- **wrong-password.spec.ts**: AUTH error code.
- **unreachable.spec.ts**: point to `127.0.0.1:1` → NETWORK or TIMEOUT (accept either).
- **timeout-budget.spec.ts**: stub `pool.probe` to hang → handler resolves within 10.5s with TIMEOUT.
- **tls-missing-ca.spec.ts**: enable TLS with invalid CA path → TLS error code.

### Component
- **c03-test-ok.spec.tsx**: mock resolves ok → success pill appears and auto-hides.
- **c03-test-auth.spec.tsx**: mock returns AUTH → error pill shows mapped text.

### E2E
Covered as part of C03 create-test-save flow.
