import { describe, it, expect } from 'vitest';
import { Long, ObjectId } from 'bson';
import { MAX_EXPLAIN_DEPTH, redactExplain } from '../../electron/agent/explainRedact';

const standalone = () => ({
  explainVersion: '1',
  queryPlanner: {
    namespace: 'app.orders',
    indexFilterSet: false,
    parsedQuery: { n: { $gt: 3 } },
    winningPlan: { stage: 'COLLSCAN', filter: { n: { $gt: 3 } }, direction: 'forward' },
    rejectedPlans: [],
  },
  command: { find: 'orders', filter: { n: { $gt: 3 } }, comment: 'latelier-agent', $db: 'app' },
  serverInfo: { host: 'db1.internal', port: 27017, version: '7.0.0', gitVersion: 'abc' },
  serverParameters: { internalQueryFacetBufferSizeBytes: 104857600 },
  ok: 1,
  $clusterTime: { clusterTime: new Long(1), signature: { hash: 'x', keyId: new Long(2) } },
  operationTime: new Long(3),
});

describe('redactExplain', () => {
  it('keeps the plan and drops the command, the server info and the cluster bookkeeping', () => {
    const out = redactExplain(standalone());
    expect(Object.keys(out)).toEqual(['explainVersion', 'queryPlanner']);
    expect(out.queryPlanner).toEqual(standalone().queryPlanner);
  });

  it('drops a sharded explain\'s connection strings, hosts and shard names at any depth', () => {
    const sharded = {
      queryPlanner: {
        namespace: 'app.orders',
        winningPlan: {
          stage: 'SHARD_MERGE',
          shards: [
            {
              shardName: 'rs0',
              connectionString: 'rs0/secret-a.internal:27018,secret-b.internal:27018',
              serverInfo: { host: 'secret-a.internal', port: 27018, version: '7.0.0' },
              winningPlan: { stage: 'IXSCAN', indexName: 'n_1', hostAndPort: 'secret-a.internal:27018' },
            },
          ],
        },
      },
      serverInfo: { host: 'router.internal', port: 27017 },
    };
    const text = JSON.stringify(redactExplain(sharded));
    for (const secret of ['secret-a', 'secret-b', 'router.internal', 'rs0', '27018', 'connectionString', 'shardName', 'serverInfo']) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('IXSCAN');
    expect(text).toContain('n_1');
  });

  it('keeps an aggregation plan, which lives under stages, and turns a shard-keyed map into a list', () => {
    const agg = {
      stages: [{ $cursor: { queryPlanner: { winningPlan: { stage: 'COLLSCAN' } }, executionStats: { nReturned: 3 } } }, { $group: { _id: '$a' } }],
      serverInfo: { host: 'h' },
      shards: {
        'shard-secret-1': { host: 'h1:27018', stages: [{ $cursor: { queryPlanner: { winningPlan: { stage: 'IXSCAN' } } } }] },
        'shard-secret-2': { host: 'h2:27018', queryPlanner: { winningPlan: { stage: 'COLLSCAN' } } },
      },
      splitPipeline: { shardsPart: [{ $match: {} }], mergerPart: [] },
      mergeType: 'router',
    };
    const out = redactExplain(agg);
    const text = JSON.stringify(out);
    expect(out.stages).toEqual([{ $cursor: { queryPlanner: { winningPlan: { stage: 'COLLSCAN' } } } }, { $group: { _id: '$a' } }]);
    expect(out.shards).toEqual([
      { stages: [{ $cursor: { queryPlanner: { winningPlan: { stage: 'IXSCAN' } } } }] },
      { queryPlanner: { winningPlan: { stage: 'COLLSCAN' } } },
    ]);
    for (const secret of ['shard-secret', 'h1:', 'h2:', 'serverInfo', 'executionStats']) expect(text).not.toContain(secret);
    expect(out.splitPipeline).toEqual(agg.splitPipeline);
    expect(out.mergeType).toBe('router');
  });

  it('leaves an array-valued shards list as it is, and a scalar one', () => {
    expect(redactExplain({ shards: [{ stages: [] }] }).shards).toEqual([{ stages: [] }]);
    expect(redactExplain({ shards: 'x' }).shards).toBe('x');
    expect(redactExplain({ shards: null }).shards).toBeNull();
  });

  it('never keeps executionStats or allPlansExecution, even nested', () => {
    const out = redactExplain({ queryPlanner: { a: { executionStats: { docsExamined: 1 }, allPlansExecution: [1] }, keep: 1 } });
    expect(out).toEqual({ queryPlanner: { a: {}, keep: 1 } });
  });

  it('copies BSON values through untouched', () => {
    const id = new ObjectId();
    const long = Long.fromString('9007199254740993');
    const out = redactExplain({ queryPlanner: { id, long, when: new Date(5) } }) as { queryPlanner: Record<string, unknown> };
    expect(out.queryPlanner.id).toBe(id);
    expect(out.queryPlanner.long).toBe(long);
    expect(out.queryPlanner.when).toEqual(new Date(5));
  });

  it('keeps a __proto__ key an ordinary own key', () => {
    const plan = JSON.parse('{"queryPlanner": {"__proto__": {"x": 1}, "ok": 2}}') as unknown;
    const out = redactExplain(plan) as { queryPlanner: Record<string, unknown> };
    expect(Object.keys(out.queryPlanner)).toEqual(['__proto__', 'ok']);
    expect(Object.getPrototypeOf(out.queryPlanner)).toBe(Object.prototype);
    expect(({} as { x?: number }).x).toBeUndefined();
  });

  it('returns an empty object for anything that is not a document', () => {
    for (const bad of [null, undefined, 5, 'x', [1, 2]]) expect(redactExplain(bad)).toEqual({});
  });

  it('does not mutate its input', () => {
    const input = standalone();
    redactExplain(input);
    expect(input).toEqual(standalone());
  });

  it('cuts a branch deeper than MAX_EXPLAIN_DEPTH instead of walking it', () => {
    let deep: Record<string, unknown> = { host: 'h', leaf: 1 };
    for (let i = 0; i < MAX_EXPLAIN_DEPTH + 5; i += 1) deep = { n: deep };
    const text = JSON.stringify(redactExplain({ queryPlanner: deep }));
    expect(text).not.toContain('leaf');
    let nested: unknown = [{ leaf: 1 }];
    for (let i = 0; i < MAX_EXPLAIN_DEPTH + 5; i += 1) nested = [nested];
    expect(JSON.stringify(redactExplain({ stages: nested }))).not.toContain('leaf');
    // Within the cap nothing is lost.
    let ok: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < MAX_EXPLAIN_DEPTH - 3; i += 1) ok = { n: ok };
    expect(JSON.stringify(redactExplain({ queryPlanner: ok }))).toContain('leaf');
  });
});

describe('redactExplain edge cases', () => {
  it('keeps null, undefined, booleans and numbers as they are', () => {
    const out = redactExplain({ queryPlanner: { a: null, b: undefined, c: true, d: 0, e: 'x', f: [null, undefined, 1] } });
    expect(out).toEqual({ queryPlanner: { a: null, b: undefined, c: true, d: 0, e: 'x', f: [null, undefined, 1] } });
  });

  it('drops command and serverParameters when they are nested, not only at the top', () => {
    const out = redactExplain({ queryPlanner: { winningPlan: { command: { find: 'x' }, serverParameters: { a: 1 }, stage: 'COLLSCAN' } } });
    expect(out).toEqual({ queryPlanner: { winningPlan: { stage: 'COLLSCAN' } } });
  });

  it('walks a null-prototype object like any other', () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { stage: 'IXSCAN', host: 'h', inner: Object.assign(Object.create(null), { host: 'h2', ok: 1 }) });
    expect(redactExplain({ queryPlanner: bare })).toEqual({ queryPlanner: { stage: 'IXSCAN', inner: { ok: 1 } } });
  });

  it('returns ordinary data properties', () => {
    const out = redactExplain({ queryPlanner: { stage: 'X' } }) as { queryPlanner: Record<string, unknown> };
    expect(Object.getOwnPropertyDescriptor(out.queryPlanner, 'stage')).toEqual({ value: 'X', writable: true, enumerable: true, configurable: true });
  });

  // `queryPlanner` is depth 1, and each wrapper below adds one.
  const wrapped = (levels: number, inner: unknown): unknown => {
    let value = inner;
    for (let i = 0; i < levels; i += 1) value = { n: value };
    return value;
  };
  const unwrap = (value: unknown, levels: number): unknown => {
    let v = value;
    for (let i = 0; i < levels; i += 1) v = (v as { n: unknown }).n;
    return v;
  };
  const planAt = (depth: number, inner: unknown) => redactExplain({ queryPlanner: wrapped(depth - 1, inner) }).queryPlanner;

  it('stops at exactly MAX_EXPLAIN_DEPTH: an object there is emptied, one level up it is kept', () => {
    expect(unwrap(planAt(MAX_EXPLAIN_DEPTH, { leaf: 1 }), MAX_EXPLAIN_DEPTH - 1)).toEqual({});
    expect(unwrap(planAt(MAX_EXPLAIN_DEPTH - 1, { leaf: 1 }), MAX_EXPLAIN_DEPTH - 2)).toEqual({ leaf: 1 });
  });

  it('stops at exactly MAX_EXPLAIN_DEPTH for an array too', () => {
    expect(unwrap(planAt(MAX_EXPLAIN_DEPTH, [{ leaf: 1 }]), MAX_EXPLAIN_DEPTH - 1)).toEqual([]);
    expect(unwrap(planAt(MAX_EXPLAIN_DEPTH - 1, [{ leaf: 1 }]), MAX_EXPLAIN_DEPTH - 2)).toEqual([{}]);
  });
});
