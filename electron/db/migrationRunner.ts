import type { Database } from 'better-sqlite3';

export interface Migration {
  /** Version number extracted from the filename (e.g., 001 -> 1). */
  version: number;
  /** Filename for logging. */
  name: string;
  /** Full SQL body. */
  sql: string;
}

/**
 * Load migration files at build time via Vite's import.meta.glob.
 * In non-Vite test environments this function's consumers inject migrations
 * directly (via `runMigrations(db, migrations)`).
 */
export function loadMigrations(): Migration[] {
  type RawModule = { default: string };
  const modules = (import.meta as unknown as {
    glob: (pattern: string, opts: { query: string; import: string; eager: true }) => Record<string, RawModule | string>;
  }).glob('./migrations/*.sql', { query: '?raw', import: 'default', eager: true });

  const out: Migration[] = [];
  for (const [pathname, mod] of Object.entries(modules)) {
    const match = pathname.match(/(\d+)-[^/]+\.sql$/);
    if (!match) continue;
    const version = Number(match[1]);
    const sql = typeof mod === 'string' ? mod : (mod as RawModule).default;
    const name = pathname.slice(pathname.lastIndexOf('/') + 1);
    out.push({ version, name, sql });
  }
  out.sort((a, b) => a.version - b.version);
  return out;
}

/**
 * Apply any migrations newer than the DB's current schema_version.
 * Each migration runs in its own transaction — failures roll back.
 */
export function runMigrations(db: Database, migrations: Migration[]): void {
  // Ensure schema_version exists. The first migration may create it; to handle
  // fresh DBs safely we read conditionally.
  const hasTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
    .get();

  let current = 0;
  if (hasTable) {
    const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as
      | { version: number }
      | undefined;
    current = row?.version ?? 0;
  }

  const pending = migrations.filter((m) => m.version > current);
  if (pending.length === 0) return;

  // Disable foreign-key enforcement for the duration of the migration loop.
  // Some migrations rebuild tables (DROP + CREATE + RENAME) to work around
  // SQLite's inability to alter a CHECK constraint in place; with FKs on,
  // DROP TABLE would cascade-delete dependent rows. PRAGMA foreign_keys is a
  // no-op inside a transaction, so it must be set before each migration tx.
  const fkWasOn = db.pragma('foreign_keys', { simple: true }) === 1;
  if (fkWasOn) db.pragma('foreign_keys = OFF');
  try {
    for (const m of pending) {
      const tx = db.transaction(() => {
        db.exec(m.sql);
      });
      tx();
      const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as
        | { version: number }
        | undefined;
      if (!row || row.version < m.version) {
        throw new Error(
          `migration ${m.name} did not advance schema_version to ${m.version}`,
        );
      }
    }
  } finally {
    if (fkWasOn) db.pragma('foreign_keys = ON');
  }
}
