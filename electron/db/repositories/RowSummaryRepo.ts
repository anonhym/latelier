import type { Database } from 'better-sqlite3';
import type { RowSummary, SettingOwner } from '@shared/types';
import { NotFoundError } from '../../errors.ts';
import { isForeignKeyConstraintError } from '../sqliteErrors.ts';
import { columnsOwner, ownerColumns } from './settingOwner.ts';

interface RowSummaryRow {
  id: string;
  connection_id: string | null;
  family_id: string | null;
  db_name: string;
  collection: string;
  fields_json: string;
  updated_at: string;
}

export interface RowSummaryUpsert {
  /** Used only when no row exists yet for the owner and Collection. */
  id: string;
  owner: SettingOwner;
  dbName: string;
  collection: string;
  fields: string[];
  updatedAt: string;
}

function rowToSummary(row: RowSummaryRow): RowSummary {
  return {
    id: row.id,
    owner: columnsOwner(row, `row summary ${row.id}`),
    dbName: row.db_name,
    collection: row.collection,
    fields: JSON.parse(row.fields_json) as string[],
    updatedAt: row.updated_at,
  };
}

/** Row Summaries: the fields a collapsed Tree row shows, one per owner and Collection. */
export class RowSummaryRepo {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /** Insert, or replace the fields of the owner's row for this Collection. */
  upsert(input: RowSummaryUpsert): RowSummary {
    const cols = ownerColumns(input.owner);
    const params = {
      id: input.id,
      ...cols,
      db_name: input.dbName,
      collection: input.collection,
      fields_json: JSON.stringify(input.fields),
      updated_at: input.updatedAt,
    };
    try {
      const info = this.db
        .prepare(`
          UPDATE row_summaries SET fields_json = @fields_json, updated_at = @updated_at
          WHERE connection_id IS @connection_id AND family_id IS @family_id
            AND db_name = @db_name AND collection = @collection
        `)
        .run(params);
      if (info.changes === 0) {
        this.db
          .prepare(`
            INSERT INTO row_summaries
              (id, connection_id, family_id, db_name, collection, fields_json, updated_at)
            VALUES
              (@id, @connection_id, @family_id, @db_name, @collection, @fields_json, @updated_at)
          `)
          .run(params);
      }
    } catch (err) {
      if (isForeignKeyConstraintError(err)) {
        throw new NotFoundError(
          'connectionId' in input.owner
            ? `connection ${input.owner.connectionId} not found`
            : `family ${input.owner.familyId} not found`,
        );
      }
      throw err;
    }
    return this.findOrThrow(input.owner, input.dbName, input.collection);
  }

  find(owner: SettingOwner, dbName: string, collection: string): RowSummary | null {
    const row = this.db
      .prepare(`
        SELECT * FROM row_summaries
        WHERE connection_id IS @connection_id AND family_id IS @family_id
          AND db_name = @db_name AND collection = @collection
      `)
      .get({ ...ownerColumns(owner), db_name: dbName, collection }) as RowSummaryRow | undefined;
    return row ? rowToSummary(row) : null;
  }

  findOrThrow(owner: SettingOwner, dbName: string, collection: string): RowSummary {
    const found = this.find(owner, dbName, collection);
    if (!found) throw new NotFoundError(`row summary for ${dbName}.${collection} not found`);
    return found;
  }

  listByOwner(owner: SettingOwner): RowSummary[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM row_summaries
        WHERE connection_id IS @connection_id AND family_id IS @family_id
        ORDER BY db_name, collection
      `)
      .all(ownerColumns(owner)) as RowSummaryRow[];
    return rows.map(rowToSummary);
  }

  /** Number of rows removed (0 when there was nothing to clear). */
  delete(owner: SettingOwner, dbName: string, collection: string): number {
    return this.db
      .prepare(`
        DELETE FROM row_summaries
        WHERE connection_id IS @connection_id AND family_id IS @family_id
          AND db_name = @db_name AND collection = @collection
      `)
      .run({ ...ownerColumns(owner), db_name: dbName, collection }).changes;
  }
}
