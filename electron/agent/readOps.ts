import { calculateObjectSize } from 'bson';
import type { AbstractCursor, Document, Filter } from 'mongodb';
import { reviveEjsonDocument } from '../mongo/ejson.ts';
import { EXACT_BSON } from '../mongo/undo.ts';
import type { AgentLease } from './AgentGate.ts';
import { wrap } from './envelope.ts';
import { AgentToolError } from './errorMap.ts';
import { redactExplain } from './explainRedact.ts';
import {
  guardFilterShape,
  guardPipeline,
  type AggregateInput,
  type CollectionSchemaInput,
  type CountInput,
  type ExplainAggregateInput,
  type FindInput,
  type ListCollectionsInput,
  type ListDatabasesInput,
  type ListIndexesInput,
} from './findOptions.ts';
import { assertTargetAllowed, cutName, visibleCollections, visibleDatabaseNames } from './namespaceGuard.ts';
import { describeResult, MAX_RESPONSE_BYTES, takeWithinBudget, type AppliedLimit } from './resultBudget.ts';
import { SchemaAccumulator } from './schemaInfer.ts';
import type { ToolContext, ToolOutcome } from './tools.ts';

/** X27 §6.4: on every command an Agent runs. */
export const AGENT_COMMENT = 'latelier-agent';
export const AGENT_MAX_TIME_MS = 10_000;

const readOptions = { maxTimeMS: AGENT_MAX_TIME_MS, comment: AGENT_COMMENT } as const;

/** Revives the Extended JSON an Agent sent, once the guards have read it as plain JSON. */
function revive(value: unknown, field: string): Document {
  try {
    return reviveEjsonDocument<Document>(value, field);
  } catch (err) {
    // The parser's message can quote the value; the Agent gets a fixed one.
    throw new AgentToolError('INVALID_INPUT', `${field} is not valid Extended JSON.`, undefined, { cause: err });
  }
}

/** Every document the cursor yields is checked against the gates before anything serialises it (X27 §10). */
async function* checked(cursor: AsyncIterable<Document>, assertStill: () => void): AsyncGenerator<Document> {
  for await (const doc of cursor) {
    assertStill();
    yield doc;
  }
}

/**
 * Runs `fn` on an admitted operation and always frees its slot. Whatever the
 * driver throws once the operation was aborted (revoked, cancelled by the
 * client, transport closed) is CANCELLED: a closed client or an aborted
 * cursor says nothing the Agent should read as a database fault.
 */
export async function withLease<T>(
  input: { connectionId: string },
  ctx: ToolContext,
  fn: (lease: AgentLease) => Promise<T>,
): Promise<T> {
  const lease = await ctx.gate.acquire(input.connectionId, ctx.session, ctx.signal);
  try {
    const result = await fn(lease);
    // `fn` may await cleanup (closing a cursor) after its own last check: a revocation in that window must not let the buffered result out.
    lease.assertStill();
    return result;
  } catch (err) {
    if (lease.signal.aborted && !(err instanceof AgentToolError)) {
      throw new AgentToolError('CANCELLED', undefined, undefined, { cause: err });
    }
    throw err;
  } finally {
    lease.release();
  }
}

/** Closing is cleanup: a failure is logged by class and never replaces the result or the error that is already on its way. */
async function closeQuietly(cursor: AbstractCursor<Document>, ctx: ToolContext): Promise<void> {
  await cursor.close().catch((err: unknown) => {
    ctx.log.warn('agent', 'closing an Agent cursor failed', { errName: err instanceof Error ? err.name : typeof err });
  });
}

async function collect(
  cursor: AbstractCursor<Document>,
  lease: AgentLease,
  limit: number,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  try {
    const result = await takeWithinBudget(checked(cursor, lease.assertStill), { limit });
    lease.assertStill();
    return {
      text: wrap(result.json, { truncationNote: describeResult(result, limit) }),
      count: result.count,
      truncated: result.truncated,
      appliedLimits: result.appliedLimits,
    };
  } finally {
    await closeQuietly(cursor, ctx);
  }
}

export async function runFind(input: FindInput, ctx: ToolContext): Promise<ToolOutcome> {
  guardFilterShape(input);
  const filter = input.filter === undefined ? {} : revive(input.filter, 'filter');
  const projection = input.projection === undefined ? undefined : revive(input.projection, 'projection');
  const sort = input.sort === undefined ? undefined : revive(input.sort, 'sort');
  return withLease(input, ctx, (lease) => {
    // One past the limit, so a full page can say whether more exist.
    const cursor = lease.client
      .db(input.database)
      .collection(input.collection)
      .find(filter, {
        ...readOptions,
        ...(projection === undefined ? {} : { projection }),
        ...(sort === undefined ? {} : { sort }),
        skip: input.skip,
        limit: input.limit + 1,
        allowDiskUse: false,
        signal: lease.signal,
      });
    return collect(cursor, lease, input.limit, ctx);
  });
}

export async function runCount(input: CountInput, ctx: ToolContext): Promise<ToolOutcome> {
  guardFilterShape(input);
  // `{}` matches everything, exactly as no filter does, so it gets the same free answer from the collection's metadata.
  const filter =
    input.filter === undefined || Object.keys(input.filter).length === 0
      ? undefined
      : (revive(input.filter, 'filter') as Filter<Document>);
  return withLease(input, ctx, async (lease) => {
    const collection = lease.client.db(input.database).collection(input.collection);
    const options = { ...readOptions, signal: lease.signal };
    // No filter: the collection's own metadata, which costs nothing and says so.
    const estimate = filter === undefined;
    // `countDocuments` is an aggregation underneath: it takes the same no-spill rule as every other.
    const total = estimate
      ? await collection.estimatedDocumentCount(options)
      : await collection.countDocuments(filter, { ...options, allowDiskUse: false });
    lease.assertStill();
    return { text: wrap(JSON.stringify({ count: total, estimate })), count: total, estimate };
  });
}

export async function runAggregate(input: AggregateInput, ctx: ToolContext): Promise<ToolOutcome> {
  guardPipeline(input);
  const stages = input.pipeline.map((stage) => revive(stage, 'pipeline'));
  return withLease(input, ctx, (lease) => {
    // The cap is the server's job, not ours to apply after the fact: the extra $limit stops the cursor at one past the limit.
    const cursor = lease.client
      .db(input.database)
      .collection(input.collection)
      .aggregate([...stages, { $limit: input.limit + 1 }], {
        ...readOptions,
        allowDiskUse: false,
        signal: lease.signal,
      });
    return collect(cursor, lease, input.limit, ctx);
  });
}

/** Listings are bounded like documents are: by count, then by bytes. */
export const LISTING_LIMIT = 5_000;
/** `collection_schema` reads at most this many bytes of sampled documents, whatever `sampleSize` says. */
export const MAX_SAMPLE_BYTES = 32 * 1024 * 1024;

export function listingNote(count: number, applied: readonly AppliedLimit[], noun: { one: string; many: string }): string {
  const reasons: string[] = [];
  if (applied.includes('limit')) reasons.push(`stopped at ${LISTING_LIMIT} entries, so more exist`);
  if (applied.includes('bytes')) reasons.push(`stopped at the ${MAX_RESPONSE_BYTES / 1024 / 1024} MiB size limit`);
  const head = `Returned ${count} ${count === 1 ? noun.one : noun.many}`;
  return reasons.length === 0 ? `${head}.` : `${head}; ${reasons.join(' and ')}.`;
}

async function listingOutcome(
  items: readonly unknown[],
  noun: { one: string; many: string },
): Promise<ToolOutcome> {
  const result = await takeWithinBudget(items, { limit: LISTING_LIMIT });
  return {
    text: wrap(result.json, { truncationNote: listingNote(result.count, result.appliedLimits, noun) }),
    count: result.count,
    truncated: result.truncated,
    appliedLimits: result.appliedLimits,
  };
}

/** The databases an Agent may read on an admitted Connection. */
export async function visibleDatabases(lease: AgentLease): Promise<string[]> {
  // The command, not `Admin.listDatabases`, which takes no abort signal.
  const reply = await lease.client
    .db('admin')
    .command(
      { listDatabases: 1, nameOnly: true, authorizedDatabases: true, maxTimeMS: AGENT_MAX_TIME_MS, comment: AGENT_COMMENT },
      { signal: lease.signal },
    );
  lease.assertStill();
  const databases = (reply as { databases?: Array<{ name: string }> }).databases ?? [];
  return visibleDatabaseNames(databases.map((d) => d.name));
}

export function runListDatabases(input: ListDatabasesInput, ctx: ToolContext): Promise<ToolOutcome> {
  return withLease(input, ctx, async (lease) =>
    listingOutcome(await visibleDatabases(lease), { one: 'database', many: 'databases' }),
  );
}

export function runListCollections(input: ListCollectionsInput, ctx: ToolContext): Promise<ToolOutcome> {
  assertTargetAllowed(input.database);
  return withLease(input, ctx, async (lease) => {
    const rows = await lease.client
      .db(input.database)
      .listCollections({}, { ...readOptions, nameOnly: true, authorizedCollections: true, signal: lease.signal })
      .toArray();
    lease.assertStill();
    return listingOutcome(visibleCollections(rows), { one: 'collection', many: 'collections' });
  });
}

export function runListIndexes(input: ListIndexesInput, ctx: ToolContext): Promise<ToolOutcome> {
  assertTargetAllowed(input.database, input.collection);
  return withLease(input, ctx, async (lease) => {
    // `listIndexes` reads the index catalogue: it never runs `$indexStats`, which is refused as a stage.
    // It cannot be handed `lease.signal`: `ListIndexesOptions` (driver 7.7) has no `signal`, and the type
    // refuses it. A revocation still ends the call, by closing the agent client under it (the gate does that
    // on every revocation), and `assertStill` below discards whatever arrived late. `maxTimeMS` bounds it.
    const rows = await lease.client
      .db(input.database)
      .collection(input.collection)
      .listIndexes(readOptions)
      .toArray();
    lease.assertStill();
    const indexes = rows.map((row) => ({ ...row, name: typeof row.name === 'string' ? cutName(row.name) : row.name }));
    return listingOutcome(indexes, { one: 'index', many: 'indexes' });
  });
}

export function runCollectionSchema(input: CollectionSchemaInput, ctx: ToolContext): Promise<ToolOutcome> {
  assertTargetAllowed(input.database, input.collection);
  return withLease(input, ctx, async (lease) => {
    // A failed read is thrown, never an empty sample: an empty schema would read as an empty collection.
    const cursor = lease.client
      .db(input.database)
      .collection(input.collection)
      .aggregate([{ $sample: { size: input.sampleSize } }], {
        ...readOptions,
        allowDiskUse: false,
        signal: lease.signal,
        ...EXACT_BSON,
      });
    const schema = new SchemaAccumulator();
    let bytes = 0;
    let cutByBytes = false;
    try {
      for await (const doc of checked(cursor, lease.assertStill)) {
        bytes += calculateObjectSize(doc);
        if (bytes > MAX_SAMPLE_BYTES) {
          cutByBytes = true;
          break;
        }
        schema.add(doc);
      }
    } finally {
      await closeQuietly(cursor, ctx);
    }
    lease.assertStill();
    const result = schema.result();
    const applied: AppliedLimit[] = [];
    if (result.pathsTruncated) applied.push('limit');
    if (cutByBytes) applied.push('bytes');
    const body = await takeWithinBudget([{ sampled: result.sampled, fields: result.fields }], { limit: 1 });
    if (body.appliedLimits.includes('bytes') && !applied.includes('bytes')) applied.push('bytes');
    const noun = result.sampled === 1 ? 'document' : 'documents';
    const cuts: string[] = [];
    if (result.pathsTruncated) cuts.push('more field paths exist than are shown');
    if (cutByBytes) cuts.push('the sample hit its size limit');
    if (body.appliedLimits.includes('bytes')) cuts.push('the answer hit the 1 MiB size limit');
    const note =
      `Inferred from a random sample of ${result.sampled} ${noun} (up to ${input.sampleSize} requested): ` +
      `${result.fields.length} field paths. Types and frequencies only, no values.` +
      (cuts.length === 0 ? '' : ` Incomplete: ${cuts.join(' and ')}.`);
    return {
      text: wrap(body.json.slice(1, -1), { truncationNote: note }),
      // What was read from the database, which is what the Agent Read Log counts.
      count: result.sampled,
      truncated: applied.length > 0,
      appliedLimits: applied,
    };
  });
}

/** One explain, at `queryPlanner` verbosity only: `executionStats` would run the query. */
async function explainOutcome(plan: unknown): Promise<ToolOutcome> {
  const result = await takeWithinBudget([redactExplain(plan)], { limit: 1 });
  return {
    text: wrap(result.json.slice(1, -1), {
      truncationNote: 'Query plan only: the query was not executed. A plan is advisory, and nothing is refused because of it.',
    }),
    count: 1,
    truncated: result.truncated,
    appliedLimits: result.appliedLimits,
  };
}

export async function runExplainFind(input: FindInput, ctx: ToolContext): Promise<ToolOutcome> {
  guardFilterShape(input);
  const filter = input.filter === undefined ? {} : revive(input.filter, 'filter');
  const projection = input.projection === undefined ? undefined : revive(input.projection, 'projection');
  const sort = input.sort === undefined ? undefined : revive(input.sort, 'sort');
  return withLease(input, ctx, async (lease) => {
    const cursor = lease.client
      .db(input.database)
      .collection(input.collection)
      .find(filter, {
        ...readOptions,
        ...(projection === undefined ? {} : { projection }),
        ...(sort === undefined ? {} : { sort }),
        skip: input.skip,
        limit: input.limit,
        allowDiskUse: false,
        signal: lease.signal,
      });
    try {
      const plan = await cursor.explain('queryPlanner');
      lease.assertStill();
      return await explainOutcome(plan);
    } finally {
      await closeQuietly(cursor, ctx);
    }
  });
}

export async function runExplainAggregate(input: ExplainAggregateInput, ctx: ToolContext): Promise<ToolOutcome> {
  guardPipeline(input);
  const stages = input.pipeline.map((stage) => revive(stage, 'pipeline'));
  return withLease(input, ctx, async (lease) => {
    const cursor = lease.client
      .db(input.database)
      .collection(input.collection)
      .aggregate(stages, { ...readOptions, allowDiskUse: false, signal: lease.signal });
    try {
      const plan = await cursor.explain('queryPlanner');
      lease.assertStill();
      return await explainOutcome(plan);
    } finally {
      await closeQuietly(cursor, ctx);
    }
  });
}
