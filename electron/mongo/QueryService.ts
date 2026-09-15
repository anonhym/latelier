import type { Sort } from 'mongodb';
import type { FindInput, FindResultWire, ExplainInput } from '@shared/types';
import { DEFAULT_MAX_EJSON_BYTES, ejsonEncode, ejsonEncodeArrayJson, parseEjsonDocument } from './ejson.ts';
import { classifyMongoOpError } from './errors.ts';
import type { MongoPool } from './MongoPool.ts';
import type { RecentQueryService } from '../services/RecentQueryService.ts';
import { PROBE_TIMEOUT_MS, QUERY_TIMEOUT_MS } from './timeouts.ts';

export class QueryService {
  private pool: MongoPool;
  private recent: RecentQueryService;
  private active = new Map<string, AbortController>();

  constructor(pool: MongoPool, recent: RecentQueryService) {
    this.pool = pool;
    this.recent = recent;
  }

  // every EJSON string off the wire is parsed with `parseEjsonDocument`,
  // never `parseEjsonField`: the renderer's own gates (`sortProblem`,
  // `isRawProjection`) are a convenience, not the trust boundary, and a `sort`
  // or `projection` that parses to `null` or an array is silently *ignored* by
  // the driver — the query runs unsorted and full-width with no error.
  // `sort` must be a document here even though the driver's `Sort` type also
  // admits strings and tuple arrays: the renderer only ever produces a
  // document and `parseSortString` only models documents, so accepting more
  // would reopen the same gap on a different shape.

  async find(input: FindInput): Promise<FindResultWire> {
    const filter = parseEjsonDocument<Record<string, unknown>>(input.filter, 'filter');
    const sort = input.sort ? parseEjsonDocument<Sort>(input.sort, 'sort') : undefined;
    const projection = input.projection
      ? parseEjsonDocument<Record<string, unknown>>(input.projection, 'projection')
      : undefined;
    const limit = Math.min(input.limit, 1000);

    const ctrl = new AbortController();
    if (input.cancelToken) this.active.set(input.cancelToken, ctrl);

    const db = await this.pool.readDb(input.connectionId, input.dbName);
    const coll = db.collection(input.collection);
    const t0 = Date.now();

    try {
      const docs = await coll
        .find(filter, {
          sort,
          projection,
          limit,
          skip: input.skip,
          signal: ctrl.signal,
          maxTimeMS: QUERY_TIMEOUT_MS,
        })
        .toArray();
      const durationMs = Date.now() - t0;
      const documentsJson = ejsonEncodeArrayJson(docs, {
        relaxed: input.ejsonRelaxed ?? false,
        maxBytes: DEFAULT_MAX_EJSON_BYTES,
      });
      // Fire-and-forget: writing recent-query history must not block the
      // result returning to the renderer. Errors are non-actionable here;
      // the next refresh of the recent list reconciles.
      void this.recent.recordFind(input, durationMs, docs.length).catch(() => {});
      return { documentsJson, durationMs, hasMore: docs.length === limit };
    } catch (err) {
      const durationMs = Date.now() - t0;
      const classified = classifyMongoOpError(err);
      void this.recent
        .recordFind(input, durationMs, 0, classified.code)
        .catch(() => {});
      throw classified;
    } finally {
      if (input.cancelToken) this.active.delete(input.cancelToken);
    }
  }

  async count(
    input: Omit<FindInput, 'limit' | 'skip' | 'projection' | 'sort' | 'cancelToken'>,
  ): Promise<{ count: number }> {
    const filter = parseEjsonDocument<Record<string, unknown>>(input.filter, 'filter');
    const db = await this.pool.readDb(input.connectionId, input.dbName);
    try {
      const count = await db
        .collection(input.collection)
        .countDocuments(filter, { maxTimeMS: PROBE_TIMEOUT_MS });
      return { count };
    } catch (err) {
      throw classifyMongoOpError(err);
    }
  }

  async findOne(
    input: Pick<FindInput, 'connectionId' | 'dbName' | 'collection' | 'filter' | 'projection' | 'sort'>,
  ): Promise<{ document: unknown | null; durationMs: number }> {
    const filter = parseEjsonDocument<Record<string, unknown>>(input.filter, 'filter');
    const projection = input.projection
      ? parseEjsonDocument<Record<string, unknown>>(input.projection, 'projection')
      : undefined;
    const sort = input.sort ? parseEjsonDocument<Sort>(input.sort, 'sort') : undefined;
    const db = await this.pool.readDb(input.connectionId, input.dbName);
    const t0 = Date.now();
    try {
      const doc = await db
        .collection(input.collection)
        .findOne(filter, { projection, sort, maxTimeMS: QUERY_TIMEOUT_MS });
      return {
        document: doc ? ejsonEncode(doc, false) : null,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      throw classifyMongoOpError(err);
    }
  }

  async explain(input: ExplainInput): Promise<{ plan: unknown; verbosity: string }> {
    const filter = parseEjsonDocument<Record<string, unknown>>(input.filter, 'filter');
    // Sort/projection materially change the plan (index pick, in-memory
    // sort) — must be passed through so explain reflects the user's
    // actual query, not a stripped-down filter-only version.
    const sort = input.sort ? parseEjsonDocument<Sort>(input.sort, 'sort') : undefined;
    const projection = input.projection
      ? parseEjsonDocument<Record<string, unknown>>(input.projection, 'projection')
      : undefined;
    const db = await this.pool.readDb(input.connectionId, input.dbName);
    const cursor = db
      .collection(input.collection)
      .find(filter, { sort, projection, maxTimeMS: QUERY_TIMEOUT_MS });
    try {
      const plan = await cursor.explain(input.verbosity);
      return { plan, verbosity: input.verbosity };
    } catch (err) {
      throw classifyMongoOpError(err);
    } finally {
      // explain() leaves the underlying cursor open server-side until the
      // driver session times out; close eagerly so an explain spike can't
      // leak cursors across long-running sessions.
      await cursor.close().catch(() => {});
    }
  }

  cancel(token: string): void {
    this.active.get(token)?.abort();
    this.active.delete(token);
  }
}
