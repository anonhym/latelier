import { describe, it, expect } from 'vitest';
import { FindInputSchema } from '../../electron/ipc/handlers/query';

// Phase 2B (#2.12) — `skip` is bounded so deep pagination can't trigger an
// unbounded O(n) server-side scan with no time ceiling.
describe('FindInputSchema skip bound (#2.12)', () => {
  const base = {
    connectionId: 'c1',
    dbName: 'db',
    collection: 'coll',
    filter: '{}',
    limit: 50,
  };

  it('accepts a skip within the bound', () => {
    expect(FindInputSchema.safeParse({ ...base, skip: 0 }).success).toBe(true);
    expect(FindInputSchema.safeParse({ ...base, skip: 10_000_000 }).success).toBe(true);
  });

  it('rejects a skip past the 10M bound', () => {
    expect(FindInputSchema.safeParse({ ...base, skip: 10_000_001 }).success).toBe(false);
  });

  it('rejects a negative skip', () => {
    expect(FindInputSchema.safeParse({ ...base, skip: -1 }).success).toBe(false);
  });
});
