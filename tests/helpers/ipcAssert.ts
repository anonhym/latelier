import { expect } from 'vitest';
import type { Envelope } from '@shared/ipc';

/**
 * Asserts the router's zod validator rejected the payload with exactly one issue,
 * at `path` (dotted, e.g. `stages.0.id`): pass a single-fault payload, so the whole
 * issue list is compared rather than searched.
 *
 * Only meaningful for a channel whose service never emits `details.issues` itself.
 * Some services do (`credentialPaths` and `connectionExportFormat` throw a
 * `ValidationError` carrying `{ issues }`), and then this cannot tell the router
 * from the service. Where a service could answer VALIDATION too (the agg, index
 * and cancel services here only do it without `issues`), also spy the service
 * method and assert it was not called: that is what proves the rejection happened
 * in the router.
 */
export function expectSchemaReject(env: Envelope<unknown>, path: string): void {
  expect(env.ok).toBe(false);
  if (env.ok) return;
  expect(env.error.code).toBe('VALIDATION');
  const issues = (env.error.details as { issues?: Array<{ path: Array<string | number> }> } | undefined)
    ?.issues;
  expect(issues?.map((i) => i.path.join('.'))).toEqual([path]);
}
