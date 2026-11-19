import type { AbstractCursor, Document, Filter } from 'mongodb';
import { reviveEjsonDocument } from '../mongo/ejson.ts';
import type { AgentLease } from './AgentGate.ts';
import { wrap } from './envelope.ts';
import { AgentToolError } from './errorMap.ts';
import {
  guardFilterShape,
  guardPipeline,
  type AggregateInput,
  type CountInput,
  type FindInput,
} from './findOptions.ts';
import { describeResult, takeWithinBudget } from './resultBudget.ts';
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
async function withLease(
  input: { connectionId: string },
  ctx: ToolContext,
  fn: (lease: AgentLease) => Promise<ToolOutcome>,
): Promise<ToolOutcome> {
  const lease = await ctx.gate.acquire(input.connectionId, ctx.session, ctx.signal);
  try {
    return await fn(lease);
  } catch (err) {
    if (lease.signal.aborted && !(err instanceof AgentToolError)) {
      throw new AgentToolError('CANCELLED', undefined, undefined, { cause: err });
    }
    throw err;
  } finally {
    lease.release();
  }
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
    await cursor.close().catch((err: unknown) => {
      ctx.log.warn('agent', 'closing an Agent cursor failed', { errName: err instanceof Error ? err.name : typeof err });
    });
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
  const filter = input.filter === undefined ? undefined : (revive(input.filter, 'filter') as Filter<Document>);
  return withLease(input, ctx, async (lease) => {
    const collection = lease.client.db(input.database).collection(input.collection);
    const options = { ...readOptions, signal: lease.signal };
    // No filter: the collection's own metadata, which costs nothing and says so.
    const estimate = filter === undefined;
    const total = estimate
      ? await collection.estimatedDocumentCount(options)
      : await collection.countDocuments(filter, options);
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
