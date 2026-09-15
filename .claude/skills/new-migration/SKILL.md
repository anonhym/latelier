---
name: new-migration
description: Scaffold a new SQLite migration file in `electron/db/migrations/` with the correct sequence number and schema_version footer. Use when adding tables, columns, or indexes. Invoke with `/new-migration <short-name>` — e.g., `/new-migration add-user-color`.
disable-model-invocation: true
---

You are scaffolding a new SQLite migration for mongo-lab. Migrations are **append-only** — never edit an existing migration, always add a new one.

## The contract

Filename: `electron/db/migrations/NNN-<kebab-short-name>.sql`

- `NNN` is the next three-digit sequence number (`001` → `002` → `003` → `004`).
- Body contains the DDL (CREATE TABLE, CREATE INDEX, ALTER TABLE, etc.).
- Footer is `UPDATE schema_version SET version = <N>;` — where `<N>` is the integer form of `NNN`.
- Header comment: purpose of the migration and a reminder that it's append-only.

`electron/db/migrationRunner.ts` discovers `.sql` files in this directory, sorts by the leading numeric prefix, and applies any whose version is above the current `schema_version`. Each file runs inside a transaction.

## Workflow

1. **List existing migrations** to find the next version:
   ```bash
   ls electron/db/migrations/*.sql | sort
   ```
2. **Ask what the migration does** if not given — table name, columns, constraints.
3. **Write the file**:
   - Match the style of `003-saved-unique-name.sql` (comment header, SQL body, `UPDATE schema_version` footer).
   - Prefer `IF NOT EXISTS` on CREATE INDEX for safety in test temp DBs.
   - Use TEXT CHECK(...) for enum columns.
   - Foreign keys: `FOREIGN KEY (<col>) REFERENCES <parent>(id) ON DELETE CASCADE` — SQLite enforces when `PRAGMA foreign_keys = ON`, which `openDatabase` sets.
   - String IDs (`TEXT PRIMARY KEY`) and ISO-8601 timestamps (`TEXT NOT NULL`) — never INTEGER autoincrement for user-visible rows.
4. **Run the migration runner** locally via a test that creates a temp DB:
   ```bash
   npx vitest run --project integration tests/integration/migration-runner.spec.ts
   ```
   Or just `npm test` — any integration test that calls `createTempDb()` exercises the full chain.
5. **If adding a column to an existing table**: SQLite's `ALTER TABLE <t> ADD COLUMN <c> <type>` is supported, but changing or dropping a column requires the rename-dance (create new table, copy, drop, rename). If you hit that, break it into multiple statements in one file.

## Reference template

```sql
-- NNN-<short-name>.sql
-- <one-sentence purpose>.
-- Append-only; never edit after merge. Fixes go in a new migration.

<DDL statements>

UPDATE schema_version SET version = <N>;
```

## Things to watch out for

- **Never edit a migration past 001**. If you need to fix a shipped schema, add a new migration that alters or repairs.
- **Don't drop `schema_version`** — `runMigrations` reads it to know where to start.
- **Test DBs share the same migrations** — `tests/helpers/db.ts` reads the same directory. A broken migration fails 100+ tests at once.
- **Renderer cannot touch SQLite directly**. If the new table needs UI, also plan the repository, service, and IPC channels (consider using `/new-ipc-channel`).

## Output

End with:

```
## New migration: <NNN>-<name>.sql

- [ ] File written: electron/db/migrations/<NNN>-<name>.sql
- [ ] schema_version updated to <N> in the footer
- [ ] Integration tests pass: npm run test:integration
- [ ] If a new table: repo + service + IPC planned (see /new-ipc-channel)
```
