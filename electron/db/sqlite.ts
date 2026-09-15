import path from 'node:path';
import fs from 'node:fs';
import BetterSqlite3 from 'better-sqlite3';
import type { Database } from 'better-sqlite3';
import { loadMigrations, runMigrations, type Migration } from './migrationRunner.ts';

export interface OpenDatabaseOptions {
  /** Absolute path to the userData directory. */
  userDataDir: string;
  /** Override migrations (tests inject their own). */
  migrations?: Migration[];
  /** Override the filename (default 'mongolab.db'). */
  filename?: string;
}

export function openDatabase(opts: OpenDatabaseOptions): Database {
  const filename = opts.filename ?? 'mongolab.db';
  fs.mkdirSync(opts.userDataDir, { recursive: true });
  const dbPath = path.join(opts.userDataDir, filename);

  const db = new BetterSqlite3(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  const migrations = opts.migrations ?? loadMigrations();
  runMigrations(db, migrations);

  return db;
}

export function closeDatabase(db: Database): void {
  try {
    db.close();
  } catch {
    // ignore double-close
  }
}

export function withTransaction<T>(db: Database, fn: () => T): T {
  const tx = db.transaction(fn);
  return tx();
}
