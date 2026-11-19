import type { Database } from 'better-sqlite3';
import type { ConnectionFamily } from '@shared/types';
import { ConflictError, NotFoundError } from '../../errors.ts';
import { isUniqueConstraintError } from '../sqliteErrors.ts';
import { withTransaction } from '../sqlite.ts';

interface FamilyRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface MemberRow {
  id: string;
  name: string;
  family_id: string;
}

export interface FamilyInsert {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

/** Connection Families and the `connections.family_id` membership column. */
export class FamilyRepo {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /** Run `fn` in one SQLite transaction; it must stay synchronous. */
  transaction<T>(fn: () => T): T {
    return withTransaction(this.db, fn);
  }

  insert(row: FamilyInsert): ConnectionFamily {
    try {
      this.db
        .prepare(
          'INSERT INTO connection_families (id, name, created_at, updated_at) VALUES (@id, @name, @created_at, @updated_at)',
        )
        .run(row);
    } catch (err) {
      throw this.mapNameConflict(err, row.name);
    }
    return this.findByIdOrThrow(row.id);
  }

  rename(id: string, name: string, updatedAt: string): ConnectionFamily {
    let changes: number;
    try {
      changes = this.db
        .prepare('UPDATE connection_families SET name = ?, updated_at = ? WHERE id = ?')
        .run(name, updatedAt, id).changes;
    } catch (err) {
      throw this.mapNameConflict(err, name);
    }
    if (changes === 0) throw new NotFoundError(`family ${id} not found`);
    return this.findByIdOrThrow(id);
  }

  deleteById(id: string): number {
    return this.db.prepare('DELETE FROM connection_families WHERE id = ?').run(id).changes;
  }

  findById(id: string): ConnectionFamily | null {
    const row = this.db
      .prepare('SELECT * FROM connection_families WHERE id = ?')
      .get(id) as FamilyRow | undefined;
    if (!row) return null;
    return this.toFamily(row, this.membersOf([id]));
  }

  findByIdOrThrow(id: string): ConnectionFamily {
    const family = this.findById(id);
    if (!family) throw new NotFoundError(`family ${id} not found`);
    return family;
  }

  /** Every Family, ordered by name via `localeCompare`. */
  list(): ConnectionFamily[] {
    const rows = this.db.prepare('SELECT * FROM connection_families').all() as FamilyRow[];
    const members = this.membersOf(rows.map((r) => r.id));
    return rows
      .map((r) => this.toFamily(r, members))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The Family a Connection belongs to, or `null`. A missing Connection is a `NotFoundError`. */
  familyIdOfConnection(connectionId: string): string | null {
    const row = this.db
      .prepare('SELECT family_id FROM connections WHERE id = ?')
      .get(connectionId) as { family_id: string | null } | undefined;
    if (!row) throw new NotFoundError(`connection ${connectionId} not found`);
    return row.family_id;
  }

  /** Member Connection ids of one Family, sorted by Connection name via `localeCompare`. */
  memberIdsOf(familyId: string): string[] {
    return this.membersOf([familyId]).get(familyId) ?? [];
  }

  /** Point a Connection at a Family, or at none. */
  setFamily(connectionId: string, familyId: string | null): void {
    const info = this.db
      .prepare('UPDATE connections SET family_id = ? WHERE id = ?')
      .run(familyId, connectionId);
    if (info.changes === 0) throw new NotFoundError(`connection ${connectionId} not found`);
  }

  private membersOf(familyIds: string[]): Map<string, string[]> {
    const wanted = new Set(familyIds);
    const rows = this.db
      .prepare('SELECT id, name, family_id FROM connections WHERE family_id IS NOT NULL')
      .all() as MemberRow[];
    const byFamily = new Map<string, MemberRow[]>();
    for (const row of rows) {
      if (!wanted.has(row.family_id)) continue;
      const list = byFamily.get(row.family_id) ?? [];
      list.push(row);
      byFamily.set(row.family_id, list);
    }
    const out = new Map<string, string[]>();
    for (const [id, list] of byFamily) {
      out.set(
        id,
        list.sort((a, b) => a.name.localeCompare(b.name)).map((m) => m.id),
      );
    }
    return out;
  }

  private toFamily(row: FamilyRow, members: Map<string, string[]>): ConnectionFamily {
    return {
      id: row.id,
      name: row.name,
      memberIds: members.get(row.id) ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapNameConflict(err: unknown, name: string): unknown {
    if (isUniqueConstraintError(err)) {
      return new ConflictError(`a family named '${name}' already exists`, { field: 'name' });
    }
    return err;
  }
}
