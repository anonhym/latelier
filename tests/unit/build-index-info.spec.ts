import { describe, it, expect } from 'vitest';
import { buildIndexInfo } from '../../electron/mongo/IndexService';

describe('buildIndexInfo', () => {
  const since = new Date('2026-04-01T00:00:00Z');

  it('flags the implicit _id index', () => {
    const info = buildIndexInfo({ name: '_id_', key: { _id: 1 }, v: 2 }, null, null);
    expect(info.isIdIndex).toBe(true);
    expect(info.name).toBe('_id_');
    expect(info.unique).toBe(false);
    expect(info.version).toBe(2);
  });

  it('does not throw on a malformed keyless spec (#2.16)', () => {
    // The driver types `key` as required, but `spec` is an `as unknown as` cast
    // of the live wire response; a malformed server reply could omit it. Guard
    // so Object.entries doesn't throw a raw TypeError that escapes as INTERNAL.
    const info = buildIndexInfo(
      { name: 'malformed' } as unknown as Parameters<typeof buildIndexInfo>[0],
      null,
      null,
    );
    expect(info.key).toEqual([]);
    expect(info.name).toBe('malformed');
  });

  it('preserves compound key field order', () => {
    const info = buildIndexInfo(
      { name: 'a_1_b_-1', key: { a: 1, b: -1 }, v: 2 },
      null,
      null,
    );
    expect(info.isIdIndex).toBe(false);
    expect(info.key).toEqual([
      { field: 'a', direction: 1 },
      { field: 'b', direction: -1 },
    ]);
  });

  it('populates expireAfterSeconds for TTL indexes only', () => {
    const ttl = buildIndexInfo(
      { name: 'created_-1_ttl', key: { created: -1 }, v: 2, expireAfterSeconds: 3600 },
      null,
      null,
    );
    expect(ttl.expireAfterSeconds).toBe(3600);

    const plain = buildIndexInfo({ name: 'created_-1', key: { created: -1 }, v: 2 }, null, null);
    expect(plain.expireAfterSeconds).toBeUndefined();
  });

  it('serialises partialFilterExpression and collation as canonical EJSON', () => {
    const info = buildIndexInfo(
      {
        name: 'partial_idx',
        key: { status: 1 },
        v: 2,
        partialFilterExpression: { status: { $eq: 'active' } },
        collation: { locale: 'en', strength: 2 },
      },
      null,
      null,
    );
    expect(info.partialFilterExpression).toBe('{"status":{"$eq":"active"}}');
    expect(info.collation).toBe('{"locale":"en","strength":{"$numberInt":"2"}}');
  });

  it('omits usage when $indexStats is unavailable', () => {
    const info = buildIndexInfo({ name: 'a_1', key: { a: 1 }, v: 2 }, null, null);
    expect(info.usage).toBeUndefined();
  });

  it('omits sizeBytes when $collStats is unavailable', () => {
    const info = buildIndexInfo({ name: 'a_1', key: { a: 1 }, v: 2 }, [], null);
    expect(info.sizeBytes).toBeUndefined();
  });

  it('populates sizeBytes from indexSizes when present', () => {
    const info = buildIndexInfo(
      { name: 'a_1', key: { a: 1 }, v: 2 },
      null,
      { a_1: 4096, b_1: 8192 },
    );
    expect(info.sizeBytes).toBe(4096);
  });

  it('populates usage from $indexStats and converts the since field', () => {
    const info = buildIndexInfo(
      { name: 'a_1', key: { a: 1 }, v: 2 },
      [{ name: 'a_1', accesses: { ops: 42, since } }],
      null,
    );
    expect(info.usage).toEqual({ ops: 42, since: since.toISOString() });
  });

  it('coerces bigint ops counts to numbers', () => {
    const info = buildIndexInfo(
      { name: 'a_1', key: { a: 1 }, v: 2 },
      [{ name: 'a_1', accesses: { ops: 9000000000n, since } }],
      null,
    );
    expect(info.usage?.ops).toBe(9000000000);
  });

  it('reflects unique / sparse / hidden booleans', () => {
    const info = buildIndexInfo(
      {
        name: 'email_unique',
        key: { email: 1 },
        v: 2,
        unique: true,
        sparse: true,
        hidden: true,
      },
      null,
      null,
    );
    expect(info.unique).toBe(true);
    expect(info.sparse).toBe(true);
    expect(info.hidden).toBe(true);
  });

  it('defaults version to 2 when the driver omits v', () => {
    const info = buildIndexInfo({ name: 'a_1', key: { a: 1 } }, null, null);
    expect(info.version).toBe(2);
  });
});
