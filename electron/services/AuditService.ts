import { randomUUID } from 'node:crypto';
import type { Envelope } from '@shared/ipc';
import type { AuditEntry, AuditListInput, AuditSummary, UndoResult } from '@shared/types';
import type { AuditRepo, AuditRow } from '../db/repositories/AuditRepo.ts';
import { auditRecordFor } from '../ipc/auditChannels.ts';
import { NotFoundError, SystemError } from '../errors.ts';
import type { MongoPool } from '../mongo/MongoPool.ts';
import { ejsonParse, ejsonStringify } from '../mongo/ejson.ts';
import { classifyMongoOpError } from '../mongo/errors.ts';
import { QUERY_TIMEOUT_MS } from '../mongo/timeouts.ts';
import { assertUndoable, undoCaptureOf, type UndoCapture } from '../mongo/undo.ts';

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
  private pool: MongoPool;
  constructor(repo: AuditRepo, pool: MongoPool) {
    this.repo = repo;
    this.pool = pool;
  }

  /**
   * Called by the router after every handler, audited or not. Writes nothing
   * for a channel outside the audit table. Returns the new entry's id when it
   * is Reversible, so the caller can be offered Undo. Throws when the insert
   * fails; the router is what keeps that from reaching the Operation's
   * envelope.
   */
  record(
    channel: string,
    input: unknown,
    envelope: Envelope<unknown>,
    startedAt: number,
    durationMs: number,
  ): string | null {
    const rec = auditRecordFor(channel, input, envelope);
    if (!rec) return null;
    const undo = envelope.ok ? undoCaptureOf(envelope.data) : undefined;
    const id = randomUUID();
    this.repo.insert({
      id,
      connection_id: rec.connectionId,
      db_name: rec.dbName,
      collection: rec.collection,
      op: rec.op,
      summary_json: JSON.stringify(rec.summary),
      outcome: rec.outcome,
      error_code: rec.errorCode,
      ran_at: new Date(startedAt).toISOString(),
      duration_ms: durationMs,
      reversible: undo ? 1 : 0,
      undone_at: null,
    }, undo ? ejsonStringify(undo) : null);
    return undo ? id : null;
  }

  /**
   * Puts back what a Reversible entry changed. Refuses before writing
   * anything; records no entry of its own, so there is no undo-of-undo.
   */
  async undo(input: { entryId: string }): Promise<UndoResult> {
    const row = this.repo.findForUndo(input.entryId);
    if (!row) throw new NotFoundError(`audit entry ${input.entryId} not found`);
    assertUndoable(row);
    // Refuses a Connection made read-only since the Operation ran.
    const w = this.pool.write(row.connection_id);
    const { preImage, postImage } = ejsonParse<UndoCapture>(row.undo_json);
    const coll = (await w.db(row.db_name)).collection(row.collection!);
    let matched: number;
    try {
      if (row.op === 'deleteOne') {
        // A reused `_id` fails on the unique index and surfaces as CONFLICT.
        await coll.insertOne(preImage, { maxTimeMS: QUERY_TIMEOUT_MS });
        matched = 1;
      } else if (row.op === 'updateOne' && postImage) {
        // The compare-and-set is the write's own filter, so nothing can land
        // between the check and the replace. `$$ROOT` equality is field-order
        // and type-bracket exact; only a numerically equal type change
        // (1 → 1.0) slips past it.
        const result = await coll.replaceOne(
          { _id: postImage._id, $expr: { $eq: ['$$ROOT', { $literal: postImage }] } },
          preImage,
          { maxTimeMS: QUERY_TIMEOUT_MS },
        );
        matched = result.matchedCount;
      } else {
        throw new SystemError('INTERNAL', `undo of ${row.op} is not supported`);
      }
    } catch (err) {
      throw classifyMongoOpError(err);
    }
    if (matched === 0) {
      throw new SystemError(
        'AUDIT_TARGET_CHANGED',
        'The document has changed since this Operation, so undoing it would overwrite the newer change.',
      );
    }
    this.repo.markUndone(input.entryId, new Date().toISOString());
    return { restored: 1, skipped: 0 };
  }

  list(input: AuditListInput): AuditEntry[] {
    return this.repo.list({ ...input, limit: input.limit ?? DEFAULT_LIST_LIMIT }).map(toEntry);
  }
}
