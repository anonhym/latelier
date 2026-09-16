import { describe, it, expect } from 'vitest';
import { queryRunKey, type QueryRunKeyInput } from '../../src/utils/queryRunKey';

const base: QueryRunKeyInput = {
  connectionId: 'c1',
  dbName: 'shop',
  collection: 'orders',
  projectionRaw: undefined,
};

describe('queryRunKey projection ordering', () => {
  it('gives the same key however the modelled projection is ordered', () => {
    const a = queryRunKey({ ...base, projection: ['Name', 'age', 'Zip'] });
    const b = queryRunKey({ ...base, projection: ['Zip', 'Name', 'age'] });
    expect(a).toBe(b);
  });

  // The comparator here is deliberately NOT `localeCompare`: collation is
  // locale-dependent, so `['Name', 'age']` sorts one way under `en-US` and the
  // other under a locale that orders case differently. This is a cache key —
  // two machines running the identical query have to land in the same bucket,
  // and a `localeCompare` comparator would silently make that host-dependent.
  it('orders by code unit, not by host collation', () => {
    const key = queryRunKey({ ...base, projection: ['age', 'Name'] });
    const nameFirst = queryRunKey({ ...base, projection: ['Name', 'age'] });
    expect(key).toBe(nameFirst);
    // `Name` precedes `age` by code unit (N=0x4E, a=0x61); a locale-aware
    // comparator would interleave them and put `age` first.
    expect(key.indexOf('Name')).toBeLessThan(key.indexOf('age'));
  });

  it('keeps a raw projection verbatim and disjoint from a modelled one', () => {
    const raw = queryRunKey({ ...base, projectionRaw: 'age Name' });
    const modelled = queryRunKey({ ...base, projection: ['age', 'Name'] });
    expect(raw).not.toBe(modelled);
  });
});
