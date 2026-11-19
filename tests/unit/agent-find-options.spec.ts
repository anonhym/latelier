import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  LIMITS,
  aggregateInputSchema,
  collectionSchemaInputSchema,
  countInputSchema,
  explainAggregateInputSchema,
  explainFindInputSchema,
  findInputSchema,
  listCollectionsInputSchema,
  listDatabasesInputSchema,
  listIndexesInputSchema,
  guardFilterShape,
  guardPipeline,
} from '../../electron/agent/findOptions';
import { z } from 'zod';
import { toAgentError } from '../../electron/agent/errorMap';

const target = () => ({ connectionId: randomUUID(), database: 'app', collection: 'orders' });

const codeOf = (fn: () => void) => {
  try {
    fn();
  } catch (err) {
    return toAgentError(err).code;
  }
  return 'did not throw';
};

const parseCode = (schema: { parse(v: unknown): unknown }, value: unknown) => codeOf(() => schema.parse(value));

describe('find input schema', () => {
  it('accepts the five documented options and fills the defaults', () => {
    const out = findInputSchema.parse({ ...target(), filter: { a: 1 }, projection: { a: 1 }, sort: { a: -1 }, limit: 10, skip: 5 });
    expect(out).toMatchObject({ filter: { a: 1 }, projection: { a: 1 }, sort: { a: -1 }, limit: 10, skip: 5 });
    const bare = findInputSchema.parse(target());
    expect(bare.limit).toBe(50);
    expect(bare.skip).toBe(0);
    expect(bare.filter).toBeUndefined();
  });

  it.each(['hint', 'let', 'collation', 'readConcern', 'comment', 'allowDiskUse', 'maxTimeMS', 'batchSize', 'tailable'])(
    'rejects %s, not ignores it',
    (option) => {
      const input = { ...target(), [option]: option === 'tailable' || option === 'allowDiskUse' ? true : 1 };
      const result = findInputSchema.safeParse(input);
      expect(result.success).toBe(false);
      expect(parseCode(findInputSchema, input)).toBe('INVALID_INPUT');
      expect(toAgentError(result.error).message).toContain(`unknown field ${option}`);
    },
  );

  it('rejects the same options on count and aggregate', () => {
    expect(parseCode(countInputSchema, { ...target(), hint: { a: 1 } })).toBe('INVALID_INPUT');
    expect(parseCode(countInputSchema, { ...target(), limit: 5 })).toBe('INVALID_INPUT');
    expect(parseCode(aggregateInputSchema, { ...target(), pipeline: [], maxTimeMS: 1 })).toBe('INVALID_INPUT');
    expect(parseCode(aggregateInputSchema, { ...target(), pipeline: [], allowDiskUse: true })).toBe('INVALID_INPUT');
  });

  it('bounds limit to 1..200 and skip to 0..10000, integers only', () => {
    for (const ok of [1, 200]) expect(findInputSchema.parse({ ...target(), limit: ok }).limit).toBe(ok);
    for (const bad of [0, 201, -1, 1.5, '5', null]) expect(parseCode(findInputSchema, { ...target(), limit: bad })).toBe('INVALID_INPUT');
    for (const ok of [0, 10_000]) expect(findInputSchema.parse({ ...target(), skip: ok }).skip).toBe(ok);
    for (const bad of [-1, 10_001, 2.5, '1']) expect(parseCode(findInputSchema, { ...target(), skip: bad })).toBe('INVALID_INPUT');
  });

  it('requires a UUID connection id and names of 1..256 characters', () => {
    expect(parseCode(findInputSchema, { ...target(), connectionId: 'c1' })).toBe('INVALID_INPUT');
    expect(parseCode(findInputSchema, { ...target(), database: '' })).toBe('INVALID_INPUT');
    expect(parseCode(findInputSchema, { ...target(), collection: '' })).toBe('INVALID_INPUT');
    expect(parseCode(findInputSchema, { ...target(), database: 'd'.repeat(257) })).toBe('INVALID_INPUT');
    expect(parseCode(findInputSchema, { ...target(), collection: 'c'.repeat(257) })).toBe('INVALID_INPUT');
    expect(findInputSchema.parse({ ...target(), database: 'd'.repeat(256), collection: 'c'.repeat(256) })).toBeTruthy();
    for (const missing of ['connectionId', 'database', 'collection']) {
      const input: Record<string, unknown> = target();
      delete input[missing];
      expect(parseCode(findInputSchema, input)).toBe('INVALID_INPUT');
    }
  });

  it('takes filter, projection and sort as objects only, and keeps them exactly as sent', () => {
    for (const field of ['filter', 'projection', 'sort']) {
      for (const bad of ['{}', [], 1, null, true]) {
        expect(parseCode(findInputSchema, { ...target(), [field]: bad })).toBe('INVALID_INPUT');
      }
    }
    const withProto = JSON.parse('{"__proto__":{"$where":"1"},"a":1}') as Record<string, unknown>;
    const out = findInputSchema.parse({ ...target(), filter: withProto });
    expect(out.filter).toBe(withProto);
    expect(Object.keys(out.filter!)).toEqual(['__proto__', 'a']);
  });

  it('says which field is wrong without quoting what the Agent sent', () => {
    const result = findInputSchema.safeParse({ ...target(), filter: 'SECRET-VALUE-1234' });
    const message = toAgentError(result.error).message;
    expect(message).toContain('filter');
    expect(message).not.toContain('SECRET-VALUE-1234');
  });
});

describe('tools/list schema', () => {
  it('shows filter, projection and sort as objects, and the pipeline as an array of objects', () => {
    const find = z.toJSONSchema(findInputSchema, { target: 'draft-7', io: 'input', unrepresentable: 'any' }) as unknown as {
      properties: Record<string, unknown>;
    };
    for (const field of ['filter', 'projection', 'sort']) {
      expect(find.properties[field]).toEqual({ type: 'object', additionalProperties: true });
    }
    const agg = z.toJSONSchema(aggregateInputSchema, { target: 'draft-7', io: 'input', unrepresentable: 'any' }) as unknown as {
      properties: { pipeline: unknown };
    };
    expect(agg.properties.pipeline).toMatchObject({ type: 'array', maxItems: 30, items: { type: 'object', additionalProperties: true } });
  });
});

describe('count and aggregate input schemas', () => {
  it('count takes an optional filter', () => {
    expect(countInputSchema.parse(target()).filter).toBeUndefined();
    expect(countInputSchema.parse({ ...target(), filter: {} }).filter).toEqual({});
  });

  it('aggregate takes up to 30 stage objects and a limit that defaults to 50', () => {
    const stages = (n: number) => Array.from({ length: n }, () => ({ $match: {} }));
    expect(aggregateInputSchema.parse({ ...target(), pipeline: stages(30) }).limit).toBe(50);
    expect(parseCode(aggregateInputSchema, { ...target(), pipeline: stages(31) })).toBe('INVALID_INPUT');
    expect(parseCode(aggregateInputSchema, { ...target(), pipeline: ['x'] })).toBe('INVALID_INPUT');
    expect(parseCode(aggregateInputSchema, { ...target(), pipeline: {} })).toBe('INVALID_INPUT');
    expect(parseCode(aggregateInputSchema, target())).toBe('INVALID_INPUT');
    expect(aggregateInputSchema.parse({ ...target(), pipeline: [], limit: 200 }).limit).toBe(200);
    expect(parseCode(aggregateInputSchema, { ...target(), pipeline: [], limit: 201 })).toBe('INVALID_INPUT');
  });
});

describe('guardFilterShape', () => {
  const base = { database: 'app', collection: 'orders' };

  it('accepts an ordinary filter, projection and sort, or none', () => {
    expect(() => guardFilterShape({ ...base })).not.toThrow();
    expect(() => guardFilterShape({ ...base, filter: { a: { $gt: 1 } }, projection: { a: 1 }, sort: { a: 1 } })).not.toThrow();
  });

  it.each(['filter', 'projection', 'sort'] as const)('allows up to 16 KiB of JSON in %s and refuses more', (field) => {
    const sized = (bytes: number) => {
      const overhead = JSON.stringify({ k: '' }).length;
      return { k: 'x'.repeat(bytes - overhead) };
    };
    expect(JSON.stringify(sized(LIMITS.filterBytes)).length).toBe(LIMITS.filterBytes);
    expect(() => guardFilterShape({ ...base, [field]: sized(LIMITS.filterBytes) })).not.toThrow();
    expect(codeOf(() => guardFilterShape({ ...base, [field]: sized(LIMITS.filterBytes + 1) }))).toBe('INVALID_INPUT');
    expect(() => guardFilterShape({ ...base, [field]: sized(LIMITS.filterBytes + 1) })).toThrow(`${field} is larger than 16 KiB.`);
  });

  it('measures bytes, not characters', () => {
    const multi = { k: 'é'.repeat(9000) };
    expect(JSON.stringify(multi).length).toBeLessThan(LIMITS.filterBytes);
    expect(codeOf(() => guardFilterShape({ ...base, filter: multi }))).toBe('INVALID_INPUT');
  });

  it.each([
    ['filter', { $where: 'sleep(1)' }],
    ['filter', { $and: [{ a: 1 }, { $expr: { $function: { body: 'x', args: [], lang: 'js' } } }] }],
    ['projection', { f: { $function: { body: 'x', args: [], lang: 'js' } } }],
    ['projection', { f: { $accumulator: {} } }],
    ['sort', { $where: 1 }],
  ] as const)('refuses server-side JavaScript in %s', (field, value) => {
    expect(codeOf(() => guardFilterShape({ ...base, [field]: value }))).toBe('JS_NOT_ALLOWED');
  });

  it('refuses a denied target, and a value nested too deeply', () => {
    expect(codeOf(() => guardFilterShape({ database: 'admin', collection: 'x' }))).toBe('NAMESPACE_DENIED');
    expect(codeOf(() => guardFilterShape({ database: 'app', collection: 'system.views' }))).toBe('NAMESPACE_DENIED');
    let deep: unknown = 1;
    for (let i = 0; i < 150_000; i += 1) deep = [deep];
    expect(codeOf(() => guardFilterShape({ ...base, filter: deep }))).toBe('INVALID_INPUT');
  });
});

describe('guardPipeline', () => {
  const base = { database: 'app', collection: 'orders' };

  it('accepts an ordinary pipeline', () => {
    expect(() => guardPipeline({ ...base, pipeline: [{ $match: { a: 1 } }, { $group: { _id: '$a', n: { $sum: 1 } } }] })).not.toThrow();
    expect(() => guardPipeline({ ...base, pipeline: [] })).not.toThrow();
  });

  it('allows up to 64 KiB of JSON and refuses more', () => {
    const sized = (bytes: number) => {
      const overhead = JSON.stringify([{ $match: { k: '' } }]).length;
      return [{ $match: { k: 'x'.repeat(bytes - overhead) } }];
    };
    expect(JSON.stringify(sized(LIMITS.pipelineBytes)).length).toBe(LIMITS.pipelineBytes);
    expect(() => guardPipeline({ ...base, pipeline: sized(LIMITS.pipelineBytes) })).not.toThrow();
    expect(codeOf(() => guardPipeline({ ...base, pipeline: sized(LIMITS.pipelineBytes + 1) }))).toBe('INVALID_INPUT');
    expect(() => guardPipeline({ ...base, pipeline: sized(LIMITS.pipelineBytes + 1) })).toThrow('pipeline is larger than 64 KiB.');
  });

  it('refuses each failure with its own code', () => {
    expect(codeOf(() => guardPipeline({ ...base, pipeline: [{ $out: 'x' }] }))).toBe('STAGE_NOT_ALLOWED');
    expect(codeOf(() => guardPipeline({ ...base, pipeline: [{ $addFields: { f: { $function: {} } } }] }))).toBe('JS_NOT_ALLOWED');
    expect(codeOf(() => guardPipeline({ ...base, pipeline: [{ $lookup: { from: 'system.users', as: 'x' } }] }))).toBe('NAMESPACE_DENIED');
    expect(codeOf(() => guardPipeline({ database: 'config', collection: 'x', pipeline: [] }))).toBe('NAMESPACE_DENIED');
    expect(codeOf(() => guardPipeline({ ...base, pipeline: [{ $match: {}, $sort: {} }] }))).toBe('INVALID_INPUT');
  });

  it('reports a stage the allowlist refuses before server-side JavaScript elsewhere', () => {
    expect(codeOf(() => guardPipeline({ ...base, pipeline: [{ $out: 'x' }, { $match: { $where: 1 } }] }))).toBe('STAGE_NOT_ALLOWED');
  });
});

describe('metadata tool input schemas', () => {
  it('list_databases takes a connection id and nothing else', () => {
    const { connectionId } = target();
    expect(listDatabasesInputSchema.parse({ connectionId })).toEqual({ connectionId });
    expect(parseCode(listDatabasesInputSchema, { connectionId, database: 'app' })).toBe('INVALID_INPUT');
    expect(parseCode(listDatabasesInputSchema, {})).toBe('INVALID_INPUT');
    expect(parseCode(listDatabasesInputSchema, { connectionId: 'not-a-uuid' })).toBe('INVALID_INPUT');
  });

  it('list_collections takes a connection id and a database of 1..256 characters', () => {
    const { connectionId } = target();
    expect(listCollectionsInputSchema.parse({ connectionId, database: 'app' })).toEqual({ connectionId, database: 'app' });
    expect(listCollectionsInputSchema.parse({ connectionId, database: 'd'.repeat(256) }).database).toHaveLength(256);
    expect(parseCode(listCollectionsInputSchema, { connectionId, database: '' })).toBe('INVALID_INPUT');
    expect(parseCode(listCollectionsInputSchema, { connectionId, database: 'd'.repeat(257) })).toBe('INVALID_INPUT');
    expect(parseCode(listCollectionsInputSchema, { connectionId, database: 'app', collection: 'x' })).toBe('INVALID_INPUT');
  });

  it('list_indexes takes a target and nothing else', () => {
    expect(listIndexesInputSchema.parse(target())).toEqual(expect.objectContaining({ collection: 'orders' }));
    expect(parseCode(listIndexesInputSchema, { ...target(), filter: {} })).toBe('INVALID_INPUT');
    expect(parseCode(listIndexesInputSchema, { ...target(), collection: '' })).toBe('INVALID_INPUT');
  });

  it('collection_schema defaults sampleSize to 50 and bounds it to 1..200 integers', () => {
    expect(collectionSchemaInputSchema.parse(target()).sampleSize).toBe(LIMITS.sampleDefault);
    expect(LIMITS.sampleDefault).toBe(50);
    expect(LIMITS.sampleMax).toBe(200);
    expect(collectionSchemaInputSchema.parse({ ...target(), sampleSize: 1 }).sampleSize).toBe(1);
    expect(collectionSchemaInputSchema.parse({ ...target(), sampleSize: 200 }).sampleSize).toBe(200);
    for (const bad of [0, 201, 1.5, -1, '5']) expect(parseCode(collectionSchemaInputSchema, { ...target(), sampleSize: bad })).toBe('INVALID_INPUT');
    expect(parseCode(collectionSchemaInputSchema, { ...target(), values: true })).toBe('INVALID_INPUT');
  });

  it('explain_find takes exactly what find takes', () => {
    expect(explainFindInputSchema).toBe(findInputSchema);
    expect(parseCode(explainFindInputSchema, { ...target(), executionStats: true })).toBe('INVALID_INPUT');
    expect(parseCode(explainFindInputSchema, { ...target(), verbosity: 'executionStats' })).toBe('INVALID_INPUT');
  });

  it('explain_aggregate takes a pipeline of up to 30 stages and no limit or verbosity', () => {
    const base = { ...target(), pipeline: [{ $match: {} }] };
    expect(explainAggregateInputSchema.parse(base).pipeline).toEqual([{ $match: {} }]);
    expect(explainAggregateInputSchema.parse({ ...target(), pipeline: Array.from({ length: 30 }, () => ({})) }).pipeline).toHaveLength(30);
    expect(parseCode(explainAggregateInputSchema, { ...target(), pipeline: Array.from({ length: 31 }, () => ({})) })).toBe('INVALID_INPUT');
    expect(parseCode(explainAggregateInputSchema, { ...base, limit: 5 })).toBe('INVALID_INPUT');
    expect(parseCode(explainAggregateInputSchema, { ...base, verbosity: 'executionStats' })).toBe('INVALID_INPUT');
    expect(parseCode(explainAggregateInputSchema, target())).toBe('INVALID_INPUT');
    expect(parseCode(explainAggregateInputSchema, { ...target(), pipeline: [1] })).toBe('INVALID_INPUT');
  });
});
