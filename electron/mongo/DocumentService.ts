import { randomUUID } from 'node:crypto';
import { DEFAULT_MAX_EJSON_BYTES, ejsonEncode, parseEjsonDocument, parseEjsonField } from './ejson.ts';
import { classifyMongoOpError } from './errors.ts';
import { ValidationError } from '../errors.ts';
import type { MongoPool } from './MongoPool.ts';
import { ADMIN_LONG_TIMEOUT_MS, PROBE_TIMEOUT_MS, QUERY_TIMEOUT_MS } from './timeouts.ts';

const DEFAULT_TOKEN_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 60 * 1000;

interface TokenEntry {
  connectionId: string;
  dbName: string;
  collection: string;
  filterJson: string;
  expiresAt: number;
}

export interface DocumentServiceOpts {
  tokenTtlMs?: number;
  sweepIntervalMs?: number;
}

/**
 * Defense-in-depth guard (N0.1): rejects an empty `{}` filter before it can
 * reach the driver. `deleteOne`/`updateOne` are single-document writes — an
 * empty filter silently touches the first document Mongo happens to return,
 * which is exactly the "wrong document deleted" bug this guards against.
 * Deliberately NOT applied to `deleteMany`/`confirmDeleteMany`, where an
 * empty filter is a legitimate delete-all, gated by the confirmToken flow.
 */
function assertNonEmptyFilter(filter: Record<string, unknown>, fieldName: string): void {
  if (Object.keys(filter).length === 0) {
    throw new ValidationError(`${fieldName} must not be empty`, { field: fieldName });
  }
}

/*
 * Two parsers, on purpose.
 *
 * Every `filterJson` goes through `parseEjsonDocument`, the same guard
 * `QueryService` uses — so one filter string gets one verdict whichever channel
 * it arrives on. Before this, `doc:*` took a bare BSON sentinel that `query:*`
 * refused, and the user got a raw `MongoServerError` after a pointless round
 * trip instead of a `VALIDATION` naming the field.
 *
 * `docJson` (a single-document write field, on `insert`/`replace`) is on
 * `parseEjsonDocument` too, for the same reason as `filterJson` — a bug fuzz
 * pass found `docJson: 'null'` and `docJson: '"abc"'` both parsed as valid
 * EJSON and reached the driver, which then threw an internal TypeError
 * (`Cannot read properties of null (reading '_id')`) that surfaced as an
 * unclassified `MONGO_ERROR` instead of a clean `VALIDATION`.
 *
 * `docsJson` and `updateJson` stay on `parseEjsonField`, which does not check
 * document-ness: `insertMany` legitimately parses an array, and `updateJson`
 * legitimately parses either an update document OR an aggregation-pipeline
 * array — a blanket document check would break both.
 *
 * `assertNonEmptyFilter` is not redundant with either. It answers a different
 * question — "does this filter match everything" — and `{}` is a perfectly good
 * document, so the document guard cannot catch it. It only looked like a
 * non-document guard by accident, and only for one BSON type:
 * `Object.keys(new Date())` is `[]` so a bare `$date` tripped it, while
 * `Object.keys(new ObjectId())` is `['buffer']` so a bare `$oid` walked past.
 */

export class DocumentService {
  private pool: MongoPool;
  private tokens = new Map<string, TokenEntry>();
  private tokenTtlMs: number;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(pool: MongoPool, opts: DocumentServiceOpts = {}) {
    this.pool = pool;
    this.tokenTtlMs = opts.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS;
    const sweepMs = opts.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    this.sweepTimer = setInterval(() => this.sweep(), sweepMs);
    // Don't keep the event loop alive solely for the sweeper.
    this.sweepTimer.unref?.();
  }

  /**
   * Stop the background sweeper so the process can exit cleanly. Safe to call
   * multiple times.
   */
  dispose(): void {
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [token, entry] of this.tokens) {
      if (entry.expiresAt <= now) {
        this.tokens.delete(token);
      }
    }
  }

  async insert(input: {
    connectionId: string;
    dbName: string;
    collection: string;
    docJson: string;
  }): Promise<{ insertedId: unknown }> {
    const w = this.pool.write(input.connectionId);
    const doc = parseEjsonDocument<Record<string, unknown>>(input.docJson, 'docJson');
    const db = await w.db(input.dbName);
    try {
      const result = await db
        .collection(input.collection)
        .insertOne(doc, { maxTimeMS: QUERY_TIMEOUT_MS });
      return { insertedId: ejsonEncode(result.insertedId) };
    } catch (err) {
      throw classifyMongoOpError(err);
    }
  }

  async insertMany(input: {
    connectionId: string;
    dbName: string;
    collection: string;
    docsJson: string;
  }): Promise<{ insertedCount: number; insertedIds: unknown[] }> {
    const w = this.pool.write(input.connectionId);
    // Same maxBytes cap QueryService.find/AggregationService apply to a read
    // result — checked on the raw string, before parsing, so one fat payload
    // can't freeze the main process either walking JSON.parse or the EJSON walk.
    const byteLength = Buffer.byteLength(input.docsJson, 'utf8');
    if (byteLength > DEFAULT_MAX_EJSON_BYTES) {
      throw new ValidationError(
        `docsJson exceeds ${DEFAULT_MAX_EJSON_BYTES} byte cap — insert fewer documents at once`,
        { field: 'docsJson', byteLength, maxBytes: DEFAULT_MAX_EJSON_BYTES },
      );
    }
    const docs = parseEjsonField<unknown[]>(input.docsJson, 'docsJson');
    if (!Array.isArray(docs) || docs.length === 0) {
      throw new ValidationError('docsJson must be a non-empty array', { field: 'docsJson' });
    }
    if (!docs.every((d) => d !== null && typeof d === 'object' && !Array.isArray(d))) {
      throw new ValidationError('docsJson must be an array of documents', { field: 'docsJson' });
    }
    const db = await w.db(input.dbName);
    try {
      const result = await db
        .collection(input.collection)
        .insertMany(docs as Record<string, unknown>[], { ordered: true, maxTimeMS: QUERY_TIMEOUT_MS });
      return {
        insertedCount: result.insertedCount,
        insertedIds: Object.values(result.insertedIds).map((id) => ejsonEncode(id)),
      };
    } catch (err) {
      // `ordered:true` stops at the first write error, so a bulk-write
      // failure can still carry a nonzero prefix of documents that landed —
      // fold that into the classified error's details so the renderer can
      // surface an honest partial-insert message instead of implying the
      // whole batch failed.
      const insertedCount = (err as { result?: { insertedCount?: number } })?.result
        ?.insertedCount;
      throw classifyMongoOpError(
        err,
        insertedCount !== undefined ? { insertedCount } : undefined,
      );
    }
  }

  async replace(input: {
    connectionId: string;
    dbName: string;
    collection: string;
    filterJson: string;
    docJson: string;
  }): Promise<{ matchedCount: number; modifiedCount: number }> {
    const w = this.pool.write(input.connectionId);
    const filter = parseEjsonDocument<Record<string, unknown>>(input.filterJson, 'filterJson');
    assertNonEmptyFilter(filter, 'filterJson');
    const doc = parseEjsonDocument<Record<string, unknown>>(input.docJson, 'docJson');
    const db = await w.db(input.dbName);
    try {
      const result = await db
        .collection(input.collection)
        .replaceOne(filter, doc, { maxTimeMS: QUERY_TIMEOUT_MS });
      return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount };
    } catch (err) {
      throw classifyMongoOpError(err);
    }
  }

  async updateOne(input: {
    connectionId: string;
    dbName: string;
    collection: string;
    filterJson: string;
    updateJson: string;
  }): Promise<{ matchedCount: number; modifiedCount: number }> {
    const w = this.pool.write(input.connectionId);
    const filter = parseEjsonDocument<Record<string, unknown>>(input.filterJson, 'filterJson');
    const update = parseEjsonField<Record<string, unknown>>(input.updateJson, 'updateJson');
    assertNonEmptyFilter(filter, 'filterJson');
    const db = await w.db(input.dbName);
    try {
      const result = await db
        .collection(input.collection)
        .updateOne(filter, update, { maxTimeMS: QUERY_TIMEOUT_MS });
      return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount };
    } catch (err) {
      throw classifyMongoOpError(err);
    }
  }

  async deleteOne(input: {
    connectionId: string;
    dbName: string;
    collection: string;
    filterJson: string;
  }): Promise<{ deletedCount: number }> {
    const w = this.pool.write(input.connectionId);
    const filter = parseEjsonDocument<Record<string, unknown>>(input.filterJson, 'filterJson');
    assertNonEmptyFilter(filter, 'filterJson');
    const db = await w.db(input.dbName);
    try {
      const result = await db
        .collection(input.collection)
        .deleteOne(filter, { maxTimeMS: QUERY_TIMEOUT_MS });
      return { deletedCount: result.deletedCount };
    } catch (err) {
      throw classifyMongoOpError(err);
    }
  }

  async confirmDeleteMany(input: {
    connectionId: string;
    dbName: string;
    collection: string;
    filterJson: string;
  }): Promise<{ count: number; confirmToken: string }> {
    const filter = parseEjsonDocument<Record<string, unknown>>(input.filterJson, 'filterJson');
    const db = await this.pool.readDb(input.connectionId, input.dbName);
    let count: number;
    try {
      count = await db
        .collection(input.collection)
        .countDocuments(filter, { maxTimeMS: PROBE_TIMEOUT_MS });
    } catch (err) {
      throw classifyMongoOpError(err);
    }

    const confirmToken = randomUUID();
    this.tokens.set(confirmToken, {
      connectionId: input.connectionId,
      dbName: input.dbName,
      collection: input.collection,
      filterJson: input.filterJson,
      expiresAt: Date.now() + this.tokenTtlMs,
    });

    return { count, confirmToken };
  }

  async deleteMany(input: {
    connectionId: string;
    dbName: string;
    collection: string;
    filterJson: string;
    confirmToken: string;
  }): Promise<{ deletedCount: number }> {
    const entry = this.tokens.get(input.confirmToken);
    if (!entry || Date.now() > entry.expiresAt) {
      this.tokens.delete(input.confirmToken);
      throw new ValidationError('confirmToken is invalid or expired', { field: 'confirmToken' });
    }

    // Verify the filter matches what was confirmed
    if (
      entry.connectionId !== input.connectionId ||
      entry.dbName !== input.dbName ||
      entry.collection !== input.collection ||
      entry.filterJson !== input.filterJson
    ) {
      throw new ValidationError('confirmToken does not match the provided filter/collection', {
        field: 'confirmToken',
      });
    }

    this.tokens.delete(input.confirmToken);
    const w = this.pool.write(input.connectionId);

    const filter = parseEjsonDocument<Record<string, unknown>>(input.filterJson, 'filterJson');
    const db = await w.db(input.dbName);
    try {
      // The admin budget, not the interactive one: this is the confirm-gated
      // bulk delete, the same class of structural operation as dropping a
      // collection. It is also not atomic, so a bound that fires mid-run
      // leaves documents already deleted and reports only a timeout.
      const result = await db
        .collection(input.collection)
        .deleteMany(filter, { maxTimeMS: ADMIN_LONG_TIMEOUT_MS });
      return { deletedCount: result.deletedCount };
    } catch (err) {
      throw classifyMongoOpError(err);
    }
  }
}
