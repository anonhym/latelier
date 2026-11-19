import { z } from 'zod';
import { AgentToolError } from './errorMap.ts';
import { assertPipelineNamespaces, assertTargetAllowed } from './namespaceGuard.ts';
import { assertDepth, assertNoServerJs, assertPipeline, isRecord } from './pipelineGuard.ts';

/** X27 §6.4 and §9.2. */
export const LIMITS = {
  filterBytes: 16 * 1024,
  projectionBytes: 16 * 1024,
  sortBytes: 16 * 1024,
  pipelineBytes: 64 * 1024,
  pipelineStages: 30,
  skip: 10_000,
  limitDefault: 50,
  limitMax: 200,
  sampleDefault: 50,
  sampleMax: 200,
} as const;

/**
 * A JSON object, kept exactly as sent. Not `z.record`, which copies into a new
 * object and drops an own `__proto__` key; the guards must see every key.
 */
const jsonObject = z
  .custom<Record<string, unknown>>((value) => isRecord(value))
  .meta({ type: 'object', additionalProperties: true });

const name = z.string().min(1).max(256);

/** The three fields every tool that reads a collection takes. */
export const targetShape = {
  connectionId: z.uuid(),
  database: name,
  collection: name,
};

const limit = z.number().int().min(1).max(LIMITS.limitMax).default(LIMITS.limitDefault);

/** X27 §7.1: `find` takes these and nothing else; `hint`, `let`, `collation`, `readConcern`, `comment`, `allowDiskUse`, `maxTimeMS`, `batchSize` and `tailable` are rejected, not ignored. */
export const findInputSchema = z.strictObject({
  ...targetShape,
  filter: jsonObject.optional(),
  projection: jsonObject.optional(),
  sort: jsonObject.optional(),
  limit,
  skip: z.number().int().min(0).max(LIMITS.skip).default(0),
});

export const countInputSchema = z.strictObject({
  ...targetShape,
  filter: jsonObject.optional(),
});

export const aggregateInputSchema = z.strictObject({
  ...targetShape,
  pipeline: z.array(jsonObject).max(LIMITS.pipelineStages),
  limit,
});

/** `explain_find` takes exactly what `find` does (X27 §8). */
export const explainFindInputSchema = findInputSchema;

/** `explain_aggregate` runs the Agent's pipeline as written: no `$limit` is appended to a plan. */
export const explainAggregateInputSchema = z.strictObject({
  ...targetShape,
  pipeline: z.array(jsonObject).max(LIMITS.pipelineStages),
});

export const listDatabasesInputSchema = z.strictObject({ connectionId: z.uuid() });

export const listCollectionsInputSchema = z.strictObject({ connectionId: z.uuid(), database: name });

export const listIndexesInputSchema = z.strictObject(targetShape);

export const collectionSchemaInputSchema = z.strictObject({
  ...targetShape,
  sampleSize: z.number().int().min(1).max(LIMITS.sampleMax).default(LIMITS.sampleDefault),
});

export type FindInput = z.infer<typeof findInputSchema>;
export type CountInput = z.infer<typeof countInputSchema>;
export type AggregateInput = z.infer<typeof aggregateInputSchema>;
export type ExplainAggregateInput = z.infer<typeof explainAggregateInputSchema>;
export type ListDatabasesInput = z.infer<typeof listDatabasesInputSchema>;
export type ListCollectionsInput = z.infer<typeof listCollectionsInputSchema>;
export type ListIndexesInput = z.infer<typeof listIndexesInputSchema>;
export type CollectionSchemaInput = z.infer<typeof collectionSchemaInputSchema>;

function assertWithin(field: string, value: unknown, maxBytes: number): void {
  if (value === undefined) return;
  if (Buffer.byteLength(JSON.stringify(value)) > maxBytes) {
    throw new AgentToolError('INVALID_INPUT', `${field} is larger than ${maxBytes / 1024} KiB.`);
  }
}

/** Depth first, so the walks and the `JSON.stringify` below never meet a value that could exhaust the stack. */
function assertShape(fields: Array<[string, unknown, number]>): void {
  for (const [, value] of fields) assertDepth(value);
  for (const [field, value, maxBytes] of fields) assertWithin(field, value, maxBytes);
}

/** The refusals for a filter, a projection and a sort (X27 §6.4, §7.3, §7.4). */
export function guardFilterShape(input: {
  database: string;
  collection: string;
  filter?: unknown;
  projection?: unknown;
  sort?: unknown;
}): void {
  assertShape([
    ['filter', input.filter, LIMITS.filterBytes],
    ['projection', input.projection, LIMITS.projectionBytes],
    ['sort', input.sort, LIMITS.sortBytes],
  ]);
  assertNoServerJs([input.filter, input.projection, input.sort]);
  assertTargetAllowed(input.database, input.collection);
}

/** The refusals for a pipeline: size, stages, server-side JavaScript, namespaces. */
export function guardPipeline(input: { database: string; collection: string; pipeline: unknown }): void {
  assertShape([['pipeline', input.pipeline, LIMITS.pipelineBytes]]);
  assertPipeline(input.pipeline);
  assertNoServerJs(input.pipeline);
  assertTargetAllowed(input.database, input.collection);
  assertPipelineNamespaces(input.pipeline);
}
