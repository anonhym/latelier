import { randomUUID } from 'node:crypto';
import type { SavedQuery, SavedQuerySummary, SavedKind, SavedPayload } from '@shared/types';
import type { SavedQueryRepo, SavedQueryRow, SavedQueryFilter } from '../db/repositories/SavedQueryRepo.ts';
import { NotFoundError } from '../errors.ts';

// Note: `description` on CreateInput (inherited from SavedQuerySummary) is not read
// directly — it's payload-canonical. `create`/`update` derive it from `input.payload.description`.
export type CreateInput = Omit<SavedQuery, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdatePatch = Partial<Pick<SavedQuery, 'name' | 'payload'>>;

export class SavedQueryService {
  private repo: SavedQueryRepo;
  constructor(repo: SavedQueryRepo) {
    this.repo = repo;
  }

  list(filter: SavedQueryFilter = {}): SavedQuerySummary[] {
    return this.repo.list(filter).map(rowToSummary);
  }

  get(id: string): SavedQuery {
    const row = this.repo.findById(id);
    if (!row) throw new NotFoundError(`saved query ${id} not found`);
    return rowToSavedQuery(row);
  }

  create(input: CreateInput): SavedQuery {
    const now = new Date().toISOString();
    const row: SavedQueryRow = {
      id: randomUUID(),
      connection_id: input.connectionId,
      db_name: input.dbName,
      collection: input.collection,
      kind: input.kind,
      name: input.name,
      payload_json: JSON.stringify(input.payload),
      created_at: now,
      updated_at: now,
    };
    this.repo.insert(row);
    return rowToSavedQuery(row);
  }

  update(id: string, patch: UpdatePatch): SavedQuery {
    const existing = this.repo.findById(id);
    if (!existing) throw new NotFoundError(`saved query ${id} not found`);

    const now = new Date().toISOString();
    this.repo.update(id, {
      name: patch.name,
      payload_json: patch.payload !== undefined ? JSON.stringify(patch.payload) : undefined,
      updated_at: now,
    });

    const updated = this.repo.findById(id)!;
    return rowToSavedQuery(updated);
  }

  delete(id: string): void {
    const changes = this.repo.deleteById(id);
    if (changes === 0) throw new NotFoundError(`saved query ${id} not found`);
  }

  duplicate(id: string, newName: string): SavedQuery {
    const existing = this.repo.findById(id);
    if (!existing) throw new NotFoundError(`saved query ${id} not found`);

    const now = new Date().toISOString();
    const row: SavedQueryRow = {
      id: randomUUID(),
      connection_id: existing.connection_id,
      db_name: existing.db_name,
      collection: existing.collection,
      kind: existing.kind,
      name: newName,
      payload_json: existing.payload_json,
      created_at: now,
      updated_at: now,
    };
    this.repo.insert(row);
    return rowToSavedQuery(row);
  }
}

// A corrupted `payload_json` on one row must never take down `list()` for every other
// row (or a single `get()`) — parse defensively and treat failure as "no payload".
function parsePayload(json: string): SavedPayload | null {
  try {
    return JSON.parse(json) as SavedPayload;
  } catch {
    return null;
  }
}

function rowToSummary(row: SavedQueryRow): SavedQuerySummary {
  const payload = parsePayload(row.payload_json);
  return {
    id: row.id,
    connectionId: row.connection_id,
    dbName: row.db_name,
    collection: row.collection,
    kind: row.kind as SavedKind,
    name: row.name,
    updatedAt: row.updated_at,
    description: payload?.description,
  };
}

function rowToSavedQuery(row: SavedQueryRow): SavedQuery {
  const payload = parsePayload(row.payload_json);
  return {
    id: row.id,
    connectionId: row.connection_id,
    dbName: row.db_name,
    collection: row.collection,
    kind: row.kind as SavedKind,
    name: row.name,
    payload: payload as SavedPayload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    description: payload?.description,
  };
}
