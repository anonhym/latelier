import type { Database } from 'better-sqlite3';
import type { SavedKind } from '@shared/types';
import { ConflictError, NotFoundError } from '../../errors.ts';
import { isUniqueConstraintError } from '../sqliteErrors.ts';

export interface SavedQueryRow {
  id: string;
  connection_id: string;
  db_name: string;
  collection: string;
  kind: SavedKind;
  name: string;
  payload_json: string;
  created_at: string;
  updated_at: string;
}

export interface SavedQueryFilter {
  connectionId?: string;
  dbName?: string;
  collection?: string;
  kind?: SavedKind;
}

export interface SavedQueryPatch {
  name?: string;
  payload_json?: string;
  updated_at: string;
}

export class SavedQueryRepo {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  insert(row: SavedQueryRow): void {
    try {
      this.db.prepare(`
        INSERT INTO saved_queries
          (id, connection_id, db_name, collection, kind, name, payload_json, created_at, updated_at)
        VALUES
          (@id, @connection_id, @db_name, @collection, @kind, @name, @payload_json, @created_at, @updated_at)
      `).run(row);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictError(`saved query name '${row.name}' already exists`, { field: 'name' });
      }
      throw err;
    }
  }

  update(id: string, patch: SavedQueryPatch): void {
    const sets: string[] = [];
    const params: Record<string, unknown> = { id };

    if (patch.name !== undefined) {
      sets.push('name = @name');
      params.name = patch.name;
    }
    if (patch.payload_json !== undefined) {
      sets.push('payload_json = @payload_json');
      params.payload_json = patch.payload_json;
    }
    sets.push('updated_at = @updated_at');
    params.updated_at = patch.updated_at;

    try {
      const info = this.db.prepare(`UPDATE saved_queries SET ${sets.join(', ')} WHERE id = @id`).run(params);
      if (info.changes === 0) throw new NotFoundError(`saved query ${id} not found`);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictError(`saved query name '${String(patch.name)}' already exists`, { field: 'name' });
      }
      throw err;
    }
  }

  findById(id: string): SavedQueryRow | null {
    const row = this.db.prepare('SELECT * FROM saved_queries WHERE id = ?').get(id) as SavedQueryRow | undefined;
    return row ?? null;
  }

  list(filter: SavedQueryFilter = {}): SavedQueryRow[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.connectionId !== undefined) {
      conditions.push('connection_id = ?');
      params.push(filter.connectionId);
    }
    if (filter.dbName !== undefined) {
      conditions.push('db_name = ?');
      params.push(filter.dbName);
    }
    if (filter.collection !== undefined) {
      conditions.push('collection = ?');
      params.push(filter.collection);
    }
    if (filter.kind !== undefined) {
      conditions.push('kind = ?');
      params.push(filter.kind);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return this.db.prepare(`SELECT * FROM saved_queries ${where} ORDER BY updated_at DESC`).all(...params) as SavedQueryRow[];
  }

  deleteById(id: string): number {
    const info = this.db.prepare('DELETE FROM saved_queries WHERE id = ?').run(id);
    return info.changes;
  }
}
