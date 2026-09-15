import { z } from 'zod';

// Re-usable validators shared across domain specs. Domain-specific schemas
// live in their own files (e.g., electron/mongo/schemas.ts).

export const Port = z.number().int().min(1).max(65_535);
export const NonEmpty = z.string().min(1);
export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * The (connectionId, dbName, collection) triple identifies a single Mongo
 * collection target. Every channel that operates on a collection (query,
 * doc write, aggregation, index, meta) shares this shape.
 */
export const CollectionTargetSchema = z.object({
  connectionId: NonEmpty,
  dbName: NonEmpty,
  collection: NonEmpty,
});

export const IdInputSchema = z.object({ id: NonEmpty });

/** Convenience: shape a Zod parse result into the router's Validator<I> type. */
export function zodValidator<T>(schema: z.ZodType<T>): (payload: unknown) => T {
  return (payload: unknown) => schema.parse(payload);
}
