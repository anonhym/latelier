# C02 — Connection repository (CRUD)

## Purpose

Own all SQL for the `connections` and `connection_secrets` tables. Provide a typed surface for creating, reading, updating, deleting, and listing connections, and expose those operations over IPC.

## Scope

- **In**: `ConnectionRepo` (SQL), `ConnectionService` (orchestrates repo + vault + pool), `conn:*` IPC channels.
- **Out**: URI parsing (C01), test-connection semantics (C04).

## Dependencies

- F02 (tables), F03 (vault), F04 (IPC), F05 (pool — for `touchUsed` and cascaded disconnect on delete), C01 (types + validation).

## 1. ConnectionRepo

```ts
// electron/db/repositories/ConnectionRepo.ts

export class ConnectionRepo {
  constructor(private db: Database);

  insert(row: ConnectionRow): void;
  update(id: string, patch: Partial<ConnectionRow>): void;
  deleteById(id: string): void;      // cascades via FK
  findById(id: string): ConnectionRow | null;
  findByName(name: string): ConnectionRow | null;
  list(): ConnectionRow[];           // ordered by last_used_at DESC NULLS LAST, then name ASC
  touchLastUsed(id: string): void;   // sets last_used_at = now
}

type ConnectionRow = {
  /* exact column names from F02 §3 */
};
```

- All mutators wrapped in transactions (`better-sqlite3` prepared statements + `.transaction`).
- `insert` throws on `SQLITE_CONSTRAINT` (name uniqueness); caller maps to `CONFLICT`.
- Mapping row ↔ `Connection`: a pair of pure functions `rowToConnection(row, hasSecrets)` and `inputToRow(input)`.

### Name uniqueness

Enforced via `UNIQUE(name)` added in migration 002:

```sql
-- 002-connections-unique-name.sql
CREATE UNIQUE INDEX uq_connections_name ON connections(name);
UPDATE schema_version SET version = 2;
```

(Not in migration 001 because migrations are append-only; this spec introduces 002.)

## 2. ConnectionService

```ts
// electron/mongo/ConnectionService.ts
export class ConnectionService {
  constructor(
    private repo: ConnectionRepo,
    private vault: SecretsVault,
    private pool: MongoPool,
  );

  list(): ConnectionSummary[];
  get(id: string): Connection;                    // throws NOT_FOUND
  create(input: ConnectionInput): Connection;
  update(id: string, patch: ConnectionUpdate): Connection;
  delete(id: string): void;
  touchUsed(id: string): void;
  status(id: string): ConnectionRuntime;          // delegates to pool
}
```

### list
1. `repo.list()`.
2. For each row, build a `ConnectionSummary` with:
   - `status` from `pool.status(id).status`.
   - `serverVersion` from `pool.status(id).serverVersion` (undefined if never connected).
3. Return array.

### get
1. `row = repo.findById(id)`; throw `NotFoundError` if null.
2. Build `Connection` with `hasPasswordStored = vault.has(id, 'password')`, same for ssh fields.
3. Return.

### create
1. Run `ConnectionInputSchema.parse(input)` (already done at IPC layer; redundant safety).
2. Check name uniqueness via `repo.findByName` (lets us emit a friendlier error than the DB constraint).
3. `repo.insert(inputToRow(input, newId))` in a transaction.
4. Inside the same transaction: if `input.password` present and non-empty → `vault.set(newId, 'password', input.password)`; same for SSH fields.
5. Return `get(newId)`.
6. If step 4 throws `SECRETS_UNAVAILABLE`, roll back and rethrow — the connection is not saved.

### update
1. Validate `ConnectionUpdateSchema`.
2. Confirm connection exists; throw NOT_FOUND otherwise.
3. In transaction:
   - If any persisted field changes, `repo.update(id, rowPatch)`.
   - For each clear flag (`clearPassword`, etc.), call `vault.delete(...)`.
   - For each plaintext field set, call `vault.set(...)`.
4. If any Mongo-relevant field changed (host, port, auth, TLS, timeouts, pool), call `pool.disconnect(id)` so the next use reconnects with the new config.
5. Return `get(id)`.

### delete
1. Confirm exists → NOT_FOUND otherwise.
2. `await pool.disconnect(id)`.
3. `repo.deleteById(id)` — FK cascade wipes secrets, saved queries, recent, tabs, preview fields.

### touchUsed
Called by the UI when the user opens a workspace for this connection (C05 "Open workspace" button, W01 on first load). Simply `repo.touchLastUsed(id)`.

## 3. IPC contract (F04-compliant)

| Channel           | Input              | Output                 | SECRET? |
| ----------------- | ------------------ | ---------------------- | ------- |
| `conn:list`       | —                  | `ConnectionSummary[]`  | no  |
| `conn:get`        | `{ id }`           | `Connection`           | no  |
| `conn:create`     | `ConnectionInput`  | `Connection`           | yes |
| `conn:update`     | `{id, patch: ConnectionUpdate}` | `Connection` | yes |
| `conn:delete`     | `{ id }`           | `void`                 | no  |
| `conn:touchUsed`  | `{ id }`           | `void`                 | no  |
| `conn:parseUri`   | `{ uri: string }`  | `Partial<ConnectionInput>` | no (URI may contain plaintext but this is opt-in paste) |

`conn:parseUri` lives here rather than in C01 because it's an IPC-exposed operation; the renderer calls it instead of importing `mongodb-connection-string-url` itself.

## 4. Error responses

| Situation                                  | code              |
| ------------------------------------------ | ----------------- |
| `id` not found                             | `NOT_FOUND`       |
| Duplicate `name`                           | `CONFLICT`        |
| Invalid input shape                        | `VALIDATION`      |
| Secrets vault unavailable                  | `SECRETS_UNAVAILABLE` |
| Any other SQL failure                      | `DB_ERROR`        |

## 5. Concurrency

- All repo mutators are synchronous (`better-sqlite3`).
- `ConnectionService.create/update/delete` hold a JS-level mutex keyed on `id` during the pool disconnect step so two rapid updates don't race. Simple `Map<string, Promise<void>>` + chaining.

## 6. Acceptance criteria

- [ ] Create returns a `Connection` whose `hasPasswordStored` reflects whether plaintext was supplied.
- [ ] Creating with a duplicate `name` returns `CONFLICT`.
- [ ] Updating with `clearPassword: true` leaves the row intact and removes the vault entry; subsequent `get` has `hasPasswordStored: false`.
- [ ] Deleting a connection removes all dependent rows (verified via F02 cascade test).
- [ ] Changing `host` triggers a `pool.disconnect(id)` call.
- [ ] `list` returns summaries in the documented order.

## 7. Test cases

### Integration (Vitest + temp SQLite + safeStorage mock + spy on MongoPool)
- **create.spec.ts**: happy path; validation failure; SCRAM without password produces VALIDATION; duplicate name produces CONFLICT.
- **get.spec.ts**: round-trip — input shape → create → get → same canonical shape, minus secrets.
- **update-secret-lifecycle.spec.ts**:
  - Create with password.
  - Update without touching password → vault unchanged.
  - Update with new password → vault ciphertext changes.
  - Update with `clearPassword: true` → vault entry removed.
- **update-triggers-disconnect.spec.ts**: update `host` → spied `pool.disconnect(id)` called once. Update only `color` → not called.
- **delete-cascade.spec.ts**: delete removes secrets + any saved queries/tabs seeded for the id.
- **list-order.spec.ts**: seed rows with different `last_used_at` → order matches spec.
- **parseUri.spec.ts**: exercised via C01 tests; this spec verifies the IPC channel is registered and validates input is a string.
