import { describe, it, expect } from 'vitest';
import { mergeConsecutive, queryPreview } from '../../src/pages/Workspace/views/recentRuns';
import type { RecentQuery, SavedPayload } from '@shared/types';

let seq = 0;
function run(overrides: Partial<RecentQuery> = {}): RecentQuery {
  seq++;
  return {
    id: `r${seq}`,
    connectionId: 'c1',
    dbName: 'shop',
    collection: 'orders',
    kind: 'find',
    payload: {
      kind: 'find',
      builder: { projection: [], sort: '', limit: '' },
      queryRaw: '{ "status": "open" }',
    },
    ranAt: `2026-10-22T10:00:${String(60 - seq).padStart(2, '0')}Z`,
    durationMs: seq,
    resultCount: seq * 10,
    ...overrides,
  };
}

describe('mergeConsecutive', () => {
  it('returns an empty list for no runs', () => {
    expect(mergeConsecutive([])).toEqual([]);
  });

  it('keeps a lone run as a group of one', () => {
    const a = run();
    expect(mergeConsecutive([a])).toEqual([{ ...a, ids: [a.id] }]);
  });

  it('collapses adjacent identical runs into the newest (first) one', () => {
    const newest = run({ durationMs: 7, resultCount: 3, errorCode: 'X' });
    const middle = run();
    const oldest = run();
    const merged = mergeConsecutive([newest, middle, oldest]);
    expect(merged).toEqual([{ ...newest, ids: [newest.id, middle.id, oldest.id] }]);
  });

  it('does not merge identical runs that are not adjacent', () => {
    const a = run();
    const b = run({ collection: 'users' });
    const c = run();
    const merged = mergeConsecutive([a, b, c]);
    expect(merged.map((m) => m.ids)).toEqual([[a.id], [b.id], [c.id]]);
  });

  it('merges each group separately', () => {
    const a1 = run();
    const a2 = run();
    const b1 = run({ dbName: 'other' });
    const b2 = run({ dbName: 'other' });
    const b3 = run({ dbName: 'other' });
    const merged = mergeConsecutive([a1, a2, b1, b2, b3]);
    expect(merged.map((m) => [m.id, m.ids])).toEqual([
      [a1.id, [a1.id, a2.id]],
      [b1.id, [b1.id, b2.id, b3.id]],
    ]);
  });

  it('does not mutate its input', () => {
    const a = run();
    const b = run();
    mergeConsecutive([a, b]);
    expect(a).not.toHaveProperty('ids');
    expect(b).not.toHaveProperty('ids');
  });

  // One field differs at a time, so each half of the identity check is pinned.
  it.each<[string, Partial<RecentQuery>]>([
    ['connectionId', { connectionId: 'c2' }],
    ['dbName', { dbName: 'other' }],
    ['collection', { collection: 'users' }],
    ['kind', { kind: 'aggregation' }],
    [
      'payload',
      {
        payload: {
          kind: 'find',
          builder: { projection: [], sort: '', limit: '' },
          queryRaw: '{ "status": "closed" }',
        },
      },
    ],
  ])('does not merge adjacent runs whose %s differs', (_field, diff) => {
    const a = run();
    const b = run(diff);
    expect(mergeConsecutive([a, b]).map((m) => m.ids)).toEqual([[a.id], [b.id]]);
  });
});

describe('queryPreview', () => {
  const find = (builder: { sort?: string; limit?: string }, queryRaw = '{"a":1}'): SavedPayload => ({
    kind: 'find',
    builder: { projection: [], sort: '', limit: '', ...builder },
    queryRaw,
  });

  it('is the filter alone when no sort or limit is set', () => {
    expect(queryPreview(find({}))).toBe('{"a":1}');
    expect(queryPreview(find({ sort: '  ', limit: ' ' }))).toBe('{"a":1}');
  });

  it('adds the sort, then the limit, each on its own line and trimmed', () => {
    expect(queryPreview(find({ sort: ' {"a":-1} ' }))).toBe('{"a":1}\nsort {"a":-1}');
    expect(queryPreview(find({ limit: ' 10 ' }))).toBe('{"a":1}\nlimit 10');
    expect(queryPreview(find({ sort: '{"a":-1}', limit: '10' }))).toBe('{"a":1}\nsort {"a":-1}\nlimit 10');
  });

  it('is null for a row stored before the query text was kept', () => {
    expect(queryPreview(find({ sort: '{"a":1}' }, ''))).toBeNull();
  });

  it('reads a legacy row that carries no builder', () => {
    const legacy = JSON.parse('{"kind":"find","queryRaw":"{}"}') as SavedPayload;
    expect(queryPreview(legacy)).toBe('{}');
    const bare = JSON.parse('{"kind":"find","queryRaw":"{}","builder":{}}') as SavedPayload;
    expect(queryPreview(bare)).toBe('{}');
  });

  it('lists a pipeline one stage per line', () => {
    expect(
      queryPreview({
        kind: 'aggregation',
        stages: [
          { id: 1, op: '$match', body: '{"a":1}', enabled: true },
          { id: 2, op: '$limit', body: '5', enabled: true },
        ],
      } as SavedPayload),
    ).toBe('$match {"a":1}\n$limit 5');
  });
});
