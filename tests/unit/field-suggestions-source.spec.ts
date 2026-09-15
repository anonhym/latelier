import { describe, it, expect } from 'vitest';
import { lastRunSource } from '../../src/features/fieldSuggestions/sources/lastRunSource';
import type {
  FieldSource,
  FieldSuggestion,
  OperatorSuggestion,
  SuggestionContext,
} from '../../src/features/fieldSuggestions/types';

// `FieldSource` permits a Promise, but `lastRunSource` is synchronous by
// design — narrow once here instead of at every call site.
function sync(out: ReturnType<FieldSource>): Array<FieldSuggestion | OperatorSuggestion> {
  if (!Array.isArray(out)) throw new Error('lastRunSource must stay synchronous');
  return out;
}

// Only `FieldSuggestion` carries `path`. Throwing rather than filtering keeps
// an unexpected operator suggestion visible instead of silently dropped.
function fieldsOf(out: ReturnType<FieldSource>): FieldSuggestion[] {
  return sync(out).map((s) => {
    if (s.kind !== 'field') throw new Error(`expected a field suggestion, got ${s.kind}`);
    return s;
  });
}

function ctx(overrides: Partial<SuggestionContext> = {}): SuggestionContext {
  return {
    connectionId: 'c1',
    dbName: 'db',
    collection: 'coll',
    ...overrides,
  };
}

describe('lastRunSource', () => {
  it('returns [] when no docs are supplied', () => {
    expect(lastRunSource(ctx())).toEqual([]);
    expect(lastRunSource(ctx({ recentDocs: [] }))).toEqual([]);
  });

  it('extracts top-level field names with inferred types', () => {
    const out = lastRunSource(
      ctx({
        recentDocs: [
          { _id: { $oid: 'a' }, name: 'ana', age: 30 },
          { _id: { $oid: 'b' }, name: 'bob', active: true },
        ],
      }),
    );
    const byPath = Object.fromEntries(fieldsOf(out).map((s) => [s.path, s]));
    expect(Object.keys(byPath).sort()).toEqual(['_id', 'active', 'age', 'name'].sort());
    expect(byPath.name?.type).toBe('string');
    expect(byPath.age?.type).toBe('number');
    expect(byPath.active?.type).toBe('boolean');
    expect(byPath._id?.type).toBe('objectid');
  });

  it('aggregates frequencies across docs', () => {
    const out = lastRunSource(
      ctx({
        recentDocs: [{ a: 1 }, { a: 2 }, { a: 3, b: 'x' }, { b: 'y' }],
      }),
    );
    const byPath = Object.fromEntries(fieldsOf(out).map((s) => [s.path, s]));
    expect(byPath.a?.frequency).toBe(3);
    expect(byPath.b?.frequency).toBe(2);
  });

  it('descends into nested objects and prunes at the configured depth', () => {
    const out = lastRunSource(
      ctx({
        recentDocs: [
          { user: { name: 'x', address: { city: { street: 'y' } } } },
        ],
      }),
    );
    const paths = fieldsOf(out).map((s) => s.path).sort();
    expect(paths).toContain('user');
    expect(paths).toContain('user.name');
    expect(paths).toContain('user.address');
    expect(paths).toContain('user.address.city');
    // 4 levels deep is past the cutoff.
    expect(paths).not.toContain('user.address.city.street');
  });

  it('tags each suggestion with source = "lastRun"', () => {
    const out = lastRunSource(ctx({ recentDocs: [{ a: 1 }] }));
    expect(sync(out).every((s) => s.source === 'lastRun')).toBe(true);
    expect(sync(out).every((s) => s.kind === 'field')).toBe(true);
  });

  it('caps at 50 docs to keep extraction cheap on big result sets', () => {
    // 200 docs, half have "only_first_half", half have "only_second_half".
    const docs: unknown[] = [];
    for (let i = 0; i < 50; i++) docs.push({ common: 1, only_first_half: i });
    for (let i = 50; i < 200; i++) docs.push({ common: 1, only_second_half: i });
    const out = lastRunSource(ctx({ recentDocs: docs }));
    const paths = fieldsOf(out).map((s) => s.path);
    expect(paths).toContain('only_first_half');
    expect(paths).not.toContain('only_second_half');
  });
});
