import { randomUUID } from 'node:crypto';
import type { Envelope } from '@shared/ipc';
import type { AuditEntry, AuditListInput, AuditSummary } from '@shared/types';
import type { AuditRepo, AuditRow } from '../db/repositories/AuditRepo.ts';
import { auditRecordFor } from '../ipc/auditChannels.ts';

const DEFAULT_LIST_LIMIT = 100;

function toEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    connectionId: row.connection_id,
    dbName: row.db_name,
    collection: row.collection,
    op: row.op,
    summary: JSON.parse(row.summary_json) as AuditSummary,
    outcome: row.outcome,
    ...(row.error_code !== null ? { errorCode: row.error_code } : {}),
    ranAt: row.ran_at,
    durationMs: row.duration_ms,
    reversible: row.reversible === 1,
    ...(row.undone_at !== null ? { undoneAt: row.undone_at } : {}),
  };
}

export class AuditService {
  private repo: AuditRepo;
  constructor(repo: AuditRepo) {
    this.repo = repo;
  }

  /**
   * Called by the router after every handler, audited or not. Writes nothing
   * for a channel outside the audit table. Throws when the insert fails; the
   * router is what keeps that from reaching the Operation's envelope.
   */
  record(channel: string, input: unknown, envelope: Envelope<unknown>, startedAt: number, durationMs: number): void {
    const rec = auditRecordFor(channel, input, envelope);
    if (!rec) return;
    this.repo.insert({
      id: randomUUID(),
      connection_id: rec.connectionId,
      db_name: rec.dbName,
      collection: rec.collection,
      op: rec.op,
      summary_json: JSON.stringify(rec.summary),
      outcome: rec.outcome,
      error_code: rec.errorCode,
      ran_at: new Date(startedAt).toISOString(),
      duration_ms: durationMs,
      // No Pre-image is captured yet, so nothing recorded is Reversible.
      reversible: 0,
      undone_at: null,
    });
  }

  list(input: AuditListInput): AuditEntry[] {
    return this.repo.list({ ...input, limit: input.limit ?? DEFAULT_LIST_LIMIT }).map(toEntry);
  }
}
