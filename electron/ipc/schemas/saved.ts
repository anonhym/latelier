import { z } from 'zod';
import type { SavedKind } from '@shared/types';

/**
 * Runtime shape of a saved query's `payload`, one schema per variant of
 * `SavedPayload`. The renderer reads `payload.kind` and the variant's own
 * fields as if they were there, so `saved:create` holds the payload to the
 * schema of the row's `kind`, and `saved:update` to the stored row's.
 *
 * Objects are loose on purpose: this checks the payload, it does not rewrite
 * it. A find saved from a tab persisted before `queryRaw` existed carries
 * `builder.conditions` / `logic` (the legacy filter shim compiles the filter
 * from them) and no `queryRaw`, so `queryRaw` is optional and `builder` keeps
 * keys it does not name.
 */
const StageSchema = z.looseObject({
  id: z.number().int(),
  op: z.string(),
  body: z.string(),
  enabled: z.boolean(),
  note: z.string().optional(),
});

export const SavedFindPayloadSchema = z.looseObject({
  kind: z.literal('find'),
  builder: z.looseObject({
    projection: z.array(z.string()),
    projectionRaw: z.string().optional(),
    sort: z.string(),
    limit: z.string(),
  }),
  queryRaw: z.string().optional(),
  description: z.string().optional(),
});

export const SavedAggregationPayloadSchema = z.looseObject({
  kind: z.literal('aggregation'),
  stages: z.array(StageSchema),
  description: z.string().optional(),
});

/**
 * The schema for a kind's payload. `script` has no `SavedPayload` variant and
 * nothing produces one, so it has no entry: callers leave a script payload
 * unchecked rather than invent a shape for it.
 */
export const SAVED_PAYLOAD_SCHEMAS: Partial<Record<SavedKind, z.ZodType>> = {
  find: SavedFindPayloadSchema,
  aggregation: SavedAggregationPayloadSchema,
};
