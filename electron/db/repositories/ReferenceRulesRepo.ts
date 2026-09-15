import type { Database } from 'better-sqlite3';
import type { ReferenceRule } from '@shared/types';
import { ConflictError, NotFoundError } from '../../errors.ts';
import { isUniqueConstraintError } from '../sqliteErrors.ts';

interface ReferenceRuleRow {
  id: string;
  connection_id: string;
  source_db: string;
  source_collection: string;
  source_field: string;
  target_db: string;
  target_collection: string;
  target_field: string;
  projection_json: string;
  display_template: string | null;
  enabled: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface ReferenceRuleInsert {
  id: string;
  connection_id: string;
  source_db: string;
  source_collection: string;
  source_field: string;
  target_db: string;
  target_collection: string;
  target_field: string;
  projection_json: string;
  display_template: string | null;
  enabled: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface ReferenceRulePatch {
  target_db?: string;
  target_collection?: string;
  target_field?: string;
  projection_json?: string;
  display_template?: string | null;
  enabled?: 0 | 1;
  updated_at: string;
}

function rowToRule(row: ReferenceRuleRow): ReferenceRule {
  return {
    id: row.id,
    connectionId: row.connection_id,
    sourceDb: row.source_db,
    sourceCollection: row.source_collection,
    sourceField: row.source_field,
    targetDb: row.target_db,
    targetCollection: row.target_collection,
    targetField: row.target_field,
    projection: JSON.parse(row.projection_json) as string[],
    displayTemplate: row.display_template ?? undefined,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ReferenceRulesRepo {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  insert(row: ReferenceRuleInsert): ReferenceRule {
    try {
      this.db.prepare(`
        INSERT INTO reference_rules
          (id, connection_id, source_db, source_collection, source_field,
           target_db, target_collection, target_field, projection_json,
           display_template, enabled, created_at, updated_at)
        VALUES
          (@id, @connection_id, @source_db, @source_collection, @source_field,
           @target_db, @target_collection, @target_field, @projection_json,
           @display_template, @enabled, @created_at, @updated_at)
      `).run(row);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictError(
          `reference rule for ${row.source_db}.${row.source_collection}.${row.source_field} already exists`,
          { field: 'sourceField' },
        );
      }
      throw err;
    }
    return this.findByIdOrThrow(row.id);
  }

  update(id: string, patch: ReferenceRulePatch): ReferenceRule {
    const sets: string[] = [];
    const params: Record<string, unknown> = { id };

    for (const key of [
      'target_db',
      'target_collection',
      'target_field',
      'projection_json',
      'display_template',
      'enabled',
    ] as const) {
      if (patch[key] !== undefined) {
        sets.push(`${key} = @${key}`);
        params[key] = patch[key];
      }
    }
    sets.push('updated_at = @updated_at');
    params.updated_at = patch.updated_at;

    const info = this.db
      .prepare(`UPDATE reference_rules SET ${sets.join(', ')} WHERE id = @id`)
      .run(params);
    if (info.changes === 0) throw new NotFoundError(`reference rule ${id} not found`);
    return this.findByIdOrThrow(id);
  }

  findById(id: string): ReferenceRule | null {
    const row = this.db
      .prepare('SELECT * FROM reference_rules WHERE id = ?')
      .get(id) as ReferenceRuleRow | undefined;
    return row ? rowToRule(row) : null;
  }

  findByIdOrThrow(id: string): ReferenceRule {
    const rule = this.findById(id);
    if (!rule) throw new NotFoundError(`reference rule ${id} not found`);
    return rule;
  }

  listByConnection(connectionId: string): ReferenceRule[] {
    const rows = this.db
      .prepare('SELECT * FROM reference_rules WHERE connection_id = ? ORDER BY source_db, source_collection, source_field')
      .all(connectionId) as ReferenceRuleRow[];
    return rows.map(rowToRule);
  }

  listForCollection(
    connectionId: string,
    sourceDb: string,
    sourceCollection: string,
  ): ReferenceRule[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM reference_rules
        WHERE connection_id = ? AND source_db = ? AND source_collection = ?
        ORDER BY source_field
      `)
      .all(connectionId, sourceDb, sourceCollection) as ReferenceRuleRow[];
    return rows.map(rowToRule);
  }

  deleteById(id: string): number {
    return this.db.prepare('DELETE FROM reference_rules WHERE id = ?').run(id).changes;
  }
}
