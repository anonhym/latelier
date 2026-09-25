import type { Database, Statement } from 'better-sqlite3';
import type { AuditOp, AuditOutcome } from '@shared/types';

/** Every column except `undo_json`, which never leaves the main process. */
export interface AuditRow {
  id: string;
  connection_id: string;
  db_name: string;
  collection: string | null;
  op: AuditOp;
  summary_json: string;
  outcome: AuditOutcome;
  error_code: string | null;
  ran_at: string;
  duration_ms: number;
  reversible: number;
  undone_at: string | null;
}

export interface AuditListFilter {
  connectionId: string;
  dbName?: string;
  collection?: string;
  before?: string;
  limit: number;
}

const LISTED_COLUMNS = `id, connection_id, db_name, collection, op, summary_json, outcome,
  error_code, ran_at, duration_ms, reversible, undone_at`;

export class AuditRepo {
  private db: Database;
  private insertStmt: Statement;
  private deleteOlderThanStmt: Statement<[number]>;

  constructor(db: Database) {
    this.db = db;
    this.insertStmt = db.prepare(`
      INSERT INTO audit_log
        (id, connection_id, db_name, collection, op, summary_json, outcome,
         error_code, ran_at, duration_ms, reversible, undone_at)
      VALUES
        (@id, @connection_id, @db_name, @collection, @op, @summary_json, @outcome,
         @error_code, @ran_at, @duration_ms, @reversible, @undone_at)
    `);
    // julianday rather than a text comparison: `ran_at` is ISO-8601 with a `T`
    // separator, `datetime('now', ...)` is not (see RecentQueryRepo).
    this.deleteOlderThanStmt = db.prepare(
      "DELETE FROM audit_log WHERE julianday(ran_at) < julianday('now', '-' || ? || ' days')",
    );
  }

  insert(row: AuditRow): void {
    this.insertStmt.run(row);
  }

  /**
   * Newest first. `before` is an exclusive `ran_at` cursor. Operations started
   * in the same millisecond fall back to rowid — the order they were recorded.
   */
  list(filter: AuditListFilter): AuditRow[] {
    const conditions = ['connection_id = ?'];
    const params: unknown[] = [filter.connectionId];
    if (filter.dbName !== undefined) {
      conditions.push('db_name = ?');
      params.push(filter.dbName);
    }
    if (filter.collection !== undefined) {
      conditions.push('collection = ?');
      params.push(filter.collection);
    }
    if (filter.before !== undefined) {
      conditions.push('ran_at < ?');
      params.push(filter.before);
    }
    return this.db
      .prepare(
        `SELECT ${LISTED_COLUMNS} FROM audit_log WHERE ${conditions.join(' AND ')}
         ORDER BY ran_at DESC, rowid DESC LIMIT ?`,
      )
      .all(...params, filter.limit) as AuditRow[];
  }

  /** Delete audit rows older than `days` days. Returns the rows affected. */
  deleteOlderThan(days: number): number {
    return this.deleteOlderThanStmt.run(days).changes;
  }
}
