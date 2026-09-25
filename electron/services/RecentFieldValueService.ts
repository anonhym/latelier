import { randomUUID } from 'node:crypto';
import type { ValType } from '@shared/types';
import type { RecentFieldValueRepo } from '../db/repositories/RecentFieldValueRepo.ts';

/** Roadmap decision (X02 "Value suggestions" §Eviction cap): 50 rows per field. */
const EVICTION_CAP = 50;

export interface RecordFieldValueEntry {
  field: string;
  value: string;
  valType: ValType;
}

export interface RecentFieldValueSummary {
  value: string;
  valType: ValType;
  frequency: number;
  lastUsedAt: string;
}

export class RecentFieldValueService {
  constructor(private repo: RecentFieldValueRepo) {}

  /** Upserts every entry, then trims each touched field to the eviction cap. */
  recordMany(
    connectionId: string,
    dbName: string,
    collection: string,
    entries: RecordFieldValueEntry[],
  ): { recorded: number } {
    const now = new Date().toISOString();
    const touchedFields = new Set<string>();
    for (const entry of entries) {
      this.repo.upsert({
        id: randomUUID(),
        connectionId,
        dbName,
        collection,
        field: entry.field,
        value: entry.value,
        valType: entry.valType,
        lastUsedAt: now,
      });
      touchedFields.add(entry.field);
    }
    for (const field of touchedFields) {
      this.repo.evictOldest({ connectionId, dbName, collection, field, keep: EVICTION_CAP });
    }
    return { recorded: entries.length };
  }

  listForField(
    connectionId: string,
    dbName: string,
    collection: string,
    field: string,
    limit?: number,
  ): RecentFieldValueSummary[] {
    return this.repo.list({ connectionId, dbName, collection, field, limit }).map((row) => ({
      value: row.value,
      valType: row.val_type,
      frequency: row.use_count,
      lastUsedAt: row.last_used_at,
    }));
  }

  clearAll(): { deleted: number } {
    return { deleted: this.repo.clearAll() };
  }
}
