import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Database } from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../electron/db/sqlite';
import type { Migration } from '../../electron/db/migrationRunner';

/**
 * Read migrations directly from disk so tests don't depend on Vite's glob.
 */
export function loadMigrationsFromDisk(): Migration[] {
  const dir = path.resolve(__dirname, '..', '..', 'electron', 'db', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
  return files
    .map((name) => {
      const match = name.match(/^(\d+)-/);
      if (!match) throw new Error(`migration filename must start with digits: ${name}`);
      return {
        version: Number(match[1]),
        name,
        sql: fs.readFileSync(path.join(dir, name), 'utf8'),
      };
    })
    .sort((a, b) => a.version - b.version);
}

export interface TempDb {
  db: Database;
  dir: string;
  cleanup: () => void;
}

export function createTempDb(): TempDb {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mongolab-db-'));
  const db = openDatabase({
    userDataDir: dir,
    migrations: loadMigrationsFromDisk(),
  });
  return {
    db,
    dir,
    cleanup: () => {
      closeDatabase(db);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Insert a minimal `connections` row (name derived from `id`, names are unique) so FK-bound tables accept rows for `id`. */
export function insertConnectionRow(db: Database, id: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO connections (
       id, name, color, connection_type, host, port,
       auth_mech, tls_enabled, tls_verify, ssh_enabled,
       connect_timeout_ms, socket_timeout_ms, server_selection_timeout_ms,
       read_preference, max_pool_size, direct_connection,
       created_at, updated_at
     ) VALUES (?, ?, '#1A6835', 'standard', 'localhost', 27017,
               'none', 1, 1, 0, 10000, 30000, 30000,
               'primary', 100, 0, ?, ?)`,
  ).run(id, `Test ${id}`, now, now);
}
