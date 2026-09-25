import type { FieldSource, ValueSource } from '../types';
import { lastRunSource } from './lastRunSource';
import { fieldOperatorSource, operatorSource } from './operatorSource';
import { sampleSchemaSource } from './sampleSchemaSource';

export { fieldOperatorSource, lastRunSource, operatorSource, sampleSchemaSource };
export {
  invalidateSampleSchemaCache,
  setSampleSchemaCacheTtl,
} from './sampleSchemaSource';

/**
 * Default field-name composition. Used by the `useSuggestions` hook when a
 * caller doesn't specify sources, and as the building block for surfaces
 * that want `[...DEFAULT_FIELD_SOURCES, operatorSource]`.
 *
 * Order isn't significant for correctness (the hook merges by path), but
 * earlier sources resolve first, so keep sync ahead of async.
 */
export const DEFAULT_FIELD_SOURCES: readonly FieldSource[] = [
  lastRunSource,
  sampleSchemaSource,
];

/** Reserved for value sources; empty until the first consumer lands. */
export const DEFAULT_VALUE_SOURCES: readonly ValueSource[] = [];
