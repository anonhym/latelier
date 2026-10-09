import path from 'node:path';
import fs from 'node:fs';
import { ensurePrivateDir, ensurePrivateFile } from '../utils/privateFs.ts';
import BetterSqlite3 from 'better-sqlite3';
import type { Database } from 'better-sqlite3';
import { loadMigrations, runMigrations, type Migration } from './migrationRunner.ts';
import type { Logger } from '../log.ts';

export const DB_FILENAME = 'latelier.db';
/** The name builds before the rename used; older userData folders still hold it. */
export const LEGACY_DB_FILENAME = 'mongolab.db';

export interface OpenDatabaseOptions {
  /** Absolute path to the userData directory. */
  userDataDir: string;
  /** Override migrations (tests inject their own). */
  migrations?: Migration[];
  /** Override the filename (default DB_FILENAME). */
  filename?: string;
  /** Receives a warning when the post-migration WAL checkpoint could not finish. */
  log?: Pick<Logger, 'warn'>;
}

/**
 * Folds the WAL into the main file and truncates it, so pages freed under
 * `secure_delete` (zeroed) are the only copy left on disk. Returns false when
 * SQLite reports the checkpoint was blocked by another connection.
 */
export function truncateWal(db: Database): boolean {
  const [row] = db.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number }>;
  return row?.busy === 0;
}

/**
 * Moves a database left under the pre-rename name to DB_FILENAME and returns
 * the filename to open. Must run before openDatabase: ensurePrivateFile creates
 * an empty DB_FILENAME, after which the legacy file would never be adopted.
 *
 * The rename moves the main file alone, so the WAL is folded in first — a bare
 * open and close does not read the WAL and a rename then drops every row still
 * in it. Leftover side files after close mean another connection holds the
 * database; renaming under it would split its writes from the main file, so the
 * old name is kept for this run and the rename is retried on the next start.
 * An existing DB_FILENAME always wins and the legacy file is left untouched.
 * A WAL is not tied to its database file, so a stray `-wal`/`-shm` under the
 * new name would be replayed onto the legacy data; the rename waits for those
 * to be gone.
 */
export function adoptLegacyDatabase(userDataDir: string, log: Pick<Logger, 'info' | 'warn'>): string {
  const current = path.join(userDataDir, DB_FILENAME);
  const legacy = path.join(userDataDir, LEGACY_DB_FILENAME);
  if (fs.existsSync(current)) {
    if (fs.existsSync(legacy)) log.warn('db', 'legacy database left in place, the current one already exists', { legacy: LEGACY_DB_FILENAME });
    return DB_FILENAME;
  }
  if (!fs.existsSync(legacy)) return DB_FILENAME;
  const strays = ['-wal', '-shm'].filter((s) => fs.existsSync(current + s));
  if (strays.length > 0) {
    log.warn('db', 'side files of a missing current database are present, keeping the legacy name for this run', { strays });
    return LEGACY_DB_FILENAME;
  }
  try {
    // timeout 0: a database held by another process fails fast instead of
    // stalling boot on the busy handler; the rename is retried next start.
    const old = new BetterSqlite3(legacy, { fileMustExist: true, timeout: 0 });
    let folded: boolean;
    try {
      folded = truncateWal(old);
    } finally {
      old.close();
    }
    const leftovers = ['-wal', '-shm'].filter((s) => fs.existsSync(legacy + s));
    if (!folded || leftovers.length > 0) {
      log.warn('db', 'legacy database is in use, keeping its name for this run', { busy: !folded, leftovers });
      return LEGACY_DB_FILENAME;
    }
    fs.renameSync(legacy, current);
  } catch (err) {
    log.warn('db', 'could not rename the legacy database, keeping its name for this run', { message: String(err) });
    return LEGACY_DB_FILENAME;
  }
  log.info('db', 'renamed the legacy database', { from: LEGACY_DB_FILENAME, to: DB_FILENAME });
  return DB_FILENAME;
}

export function openDatabase(opts: OpenDatabaseOptions): Database {
  const filename = opts.filename ?? DB_FILENAME;
  ensurePrivateDir(opts.userDataDir);
  const dbPath = path.join(opts.userDataDir, filename);
  // Before SQLite opens the file, so it creates `-wal`/`-shm` at the same
  // owner-only mode; side files left by an older install are tightened below.
  ensurePrivateFile(dbPath);
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(dbPath + suffix)) ensurePrivateFile(dbPath + suffix);
  }

  const db = new BetterSqlite3(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  // Per-connection, and on before migrations so a migration that scrubs data
  // zeroes the bytes it frees instead of leaving them in a free page.
  db.pragma('secure_delete = ON');

  const migrations = opts.migrations ?? loadMigrations();
  // An upgrade's migrations may scrub data; VACUUM rebuilds the file so bytes
  // freed before secure_delete was on (older installs) don't linger in free pages.
  // It needs free disk about the size of the database, and the migrations have
  // already committed, so a failure is reported rather than failing the boot.
  if (runMigrations(db, migrations) > 0) {
    try {
      db.exec('VACUUM');
    } catch (err) {
      if (!opts.log) throw err;
      opts.log.warn('db', 'vacuum after migrations failed', { message: String(err) });
    }
  }
  if (!truncateWal(db)) opts.log?.warn('db', 'wal checkpoint after migrations was blocked');

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
