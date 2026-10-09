import { expect } from 'vitest';
import type { Envelope } from '@shared/ipc';

/**
 * Asserts the router's zod validator rejected the payload at `path` (dotted, e.g.
 * `stages.0.id`). A bare `code === 'VALIDATION'` check cannot tell that apart from
 * a service or mongod that also answers VALIDATION once a loosened schema lets the
 * payload through; only a ZodError carries `details.issues`.
 */
export function expectSchemaReject(env: Envelope<unknown>, path: string): void {
  expect(env.ok).toBe(false);
  if (env.ok) return;
  expect(env.error.code).toBe('VALIDATION');
  const issues = (env.error.details as { issues?: Array<{ path: Array<string | number> }> } | undefined)
    ?.issues;
  expect(issues?.map((i) => i.path.join('.'))).toContain(path);
}
