import type { Database } from 'better-sqlite3';
import type { PreviewFields } from '@shared/types';

interface PreviewFieldsRow {
  connection_id: string;
  db_name: string;
  collection: string;
  fields_json: string;
  updated_at: string;
}

export class PreviewFieldsRepo {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  get(connectionId: string, dbName: string, collection: string): PreviewFields | null {
    const row = this.db.prepare(`
      SELECT * FROM preview_fields
      WHERE connection_id = ? AND db_name = ? AND collection = ?
    `).get(connectionId, dbName, collection) as PreviewFieldsRow | undefined;

    if (!row) return null;
    return {
      connectionId: row.connection_id,
      dbName: row.db_name,
      collection: row.collection,
      fields: JSON.parse(row.fields_json) as string[],
      updatedAt: row.updated_at,
    };
  }

  set(connectionId: string, dbName: string, collection: string, fields: string[]): PreviewFields {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO preview_fields (connection_id, db_name, collection, fields_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (connection_id, db_name, collection) DO UPDATE SET
        fields_json = excluded.fields_json,
        updated_at = excluded.updated_at
    `).run(connectionId, dbName, collection, JSON.stringify(fields), now);

    return { connectionId, dbName, collection, fields, updatedAt: now };
  }
}
