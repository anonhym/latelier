import type { Database, Statement } from 'better-sqlite3';

interface Row {
  key: string;
  value_json: string;
  updated_at: string;
}

/**
 * Tiny key/value store over the `app_state` table.
 * Values are JSON-encoded on write and decoded on read.
 */
export class AppStateRepo {
  private getStmt: Statement<[string]>;
  private upsertStmt: Statement<[string, string, string]>;
  private deleteStmt: Statement<[string]>;

  constructor(db: Database) {
    this.getStmt = db.prepare('SELECT key, value_json, updated_at FROM app_state WHERE key = ?');
    this.upsertStmt = db.prepare(
      `INSERT INTO app_state (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
    );
    this.deleteStmt = db.prepare('DELETE FROM app_state WHERE key = ?');
  }

  get<T>(key: string): T | null {
    const row = this.getStmt.get(key) as Row | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.value_json) as T;
    } catch {
      return null;
    }
  }

  set<T>(key: string, value: T): void {
    const body = JSON.stringify(value);
    this.upsertStmt.run(key, body, new Date().toISOString());
  }

  delete(key: string): void {
    this.deleteStmt.run(key);
  }
}
