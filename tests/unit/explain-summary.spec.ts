import { describe, it, expect } from 'vitest';
import { summarizeExplain } from '../../src/utils/explainSummary';

describe('summarizeExplain', () => {
  it('(a) find COLLSCAN → collscan:true, usesIndex:false', () => {
    const plan = { queryPlanner: { winningPlan: { stage: 'COLLSCAN' } } };
    const summary = summarizeExplain(plan);
    expect(summary).not.toBeNull();
    expect(summary?.stages).toEqual(['COLLSCAN']);
    expect(summary?.collscan).toBe(true);
    expect(summary?.usesIndex).toBe(false);
    expect(summary?.indexName).toBeUndefined();
  });

  it('(b) find IXSCAN → usesIndex:true + indexName/keyPattern', () => {
    const plan = {
      queryPlanner: {
        winningPlan: {
          stage: 'FETCH',
          inputStage: {
            stage: 'IXSCAN',
            indexName: 'email_1',
            keyPattern: { email: 1 },
          },
        },
      },
    };
    const summary = summarizeExplain(plan);
    expect(summary).not.toBeNull();
    expect(summary?.stages).toEqual(['FETCH', 'IXSCAN']);
    expect(summary?.collscan).toBe(false);
    expect(summary?.usesIndex).toBe(true);
    expect(summary?.indexName).toBe('email_1');
    expect(summary?.keyPattern).toEqual({ email: 1 });
  });

  it('(c) aggregation {stages:[{$cursor:{queryPlanner:…}}]} → normalized stage chain', () => {
    const plan = {
      stages: [
        {
          $cursor: {
            queryPlanner: { winningPlan: { stage: 'COLLSCAN' } },
          },
        },
      ],
    };
    const summary = summarizeExplain(plan);
    expect(summary).not.toBeNull();
    expect(summary?.stages).toEqual(['COLLSCAN']);
    expect(summary?.collscan).toBe(true);
  });

  it('(d) executionStats present → metric fields populated', () => {
    const plan = {
      queryPlanner: { winningPlan: { stage: 'COLLSCAN' } },
      executionStats: {
        nReturned: 5,
        totalDocsExamined: 100,
        totalKeysExamined: 0,
        executionTimeMillis: 12,
      },
    };
    const summary = summarizeExplain(plan);
    expect(summary?.nReturned).toBe(5);
    expect(summary?.docsExamined).toBe(100);
    expect(summary?.keysExamined).toBe(0);
    expect(summary?.executionTimeMillis).toBe(12);
  });

  it('(d2) executionStats nested under aggregation $cursor → metric fields populated', () => {
    const plan = {
      stages: [
        {
          $cursor: {
            queryPlanner: { winningPlan: { stage: 'COLLSCAN' } },
            executionStats: {
              nReturned: 3,
              totalDocsExamined: 3,
              totalKeysExamined: 0,
              executionTimeMillis: 1,
            },
          },
        },
      ],
    };
    const summary = summarizeExplain(plan);
    expect(summary?.nReturned).toBe(3);
    expect(summary?.docsExamined).toBe(3);
  });

  it('(e) queryPlanner-only → metrics undefined', () => {
    const plan = { queryPlanner: { winningPlan: { stage: 'COLLSCAN' } } };
    const summary = summarizeExplain(plan);
    expect(summary?.nReturned).toBeUndefined();
    expect(summary?.docsExamined).toBeUndefined();
    expect(summary?.keysExamined).toBeUndefined();
    expect(summary?.executionTimeMillis).toBeUndefined();
  });

  it('(f) sharded shards[] → does not crash, extracts what it can', () => {
    const plan = {
      queryPlanner: {
        winningPlan: {
          stage: 'SINGLE_SHARD',
          shards: [
            {
              shardName: 'shard01',
              winningPlan: {
                stage: 'FETCH',
                inputStage: {
                  stage: 'IXSCAN',
                  indexName: 'a_1',
                  keyPattern: { a: 1 },
                },
              },
            },
          ],
        },
      },
      executionStats: {
        nReturned: 5,
        totalDocsExamined: 5,
        totalKeysExamined: 5,
        executionTimeMillis: 12,
      },
    };
    const summary = summarizeExplain(plan);
    expect(summary).not.toBeNull();
    expect(summary?.stages).toEqual(['FETCH', 'IXSCAN']);
    expect(summary?.usesIndex).toBe(true);
    expect(summary?.indexName).toBe('a_1');
    expect(summary?.nReturned).toBe(5);
  });

  it('(g) SBE / queryPlan-nested → no crash', () => {
    const plan = {
      queryPlanner: {
        winningPlan: {
          queryPlan: {
            stage: 'FETCH',
            inputStage: {
              stage: 'IXSCAN',
              indexName: 'x_1',
              keyPattern: { x: 1 },
            },
          },
          slotBasedPlan: { stages: 'irrelevant string form' },
        },
      },
      executionStats: {
        nReturned: 1,
        totalDocsExamined: 1,
        totalKeysExamined: 1,
        executionTimeMillis: 0,
      },
    };
    const summary = summarizeExplain(plan);
    expect(summary).not.toBeNull();
    expect(summary?.stages).toEqual(['FETCH', 'IXSCAN']);
    expect(summary?.indexName).toBe('x_1');
  });

  it('(h) unknown/empty {} → null', () => {
    expect(summarizeExplain({})).toBeNull();
  });

  it('(h) unrecognized shape → null', () => {
    expect(summarizeExplain({ weird: 1 })).toBeNull();
  });

  it('(h) non-object → null', () => {
    expect(summarizeExplain(null)).toBeNull();
    expect(summarizeExplain(undefined)).toBeNull();
    expect(summarizeExplain(42)).toBeNull();
    expect(summarizeExplain('foo')).toBeNull();
    expect(summarizeExplain([1, 2, 3])).toBeNull();
  });
});
