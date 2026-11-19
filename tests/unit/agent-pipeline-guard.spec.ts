import { describe, it, expect } from 'vitest';
import {
  ALLOWED_STAGES,
  MAX_JSON_DEPTH,
  MAX_PIPELINE_NESTING,
  SERVER_JS_KEYS,
  assertDepth,
  assertNoServerJs,
  assertPipeline,
  isRecord,
  walkStages,
} from '../../electron/agent/pipelineGuard';

const SPEC_ALLOWED = [
  '$match', '$project', '$addFields', '$set', '$unset', '$group', '$sort', '$limit', '$skip', '$unwind', '$count',
  '$sortByCount', '$bucket', '$bucketAuto', '$facet', '$replaceRoot', '$replaceWith', '$lookup', '$graphLookup',
  '$unionWith', '$sample', '$redact', '$densify', '$fill', '$setWindowFields', '$geoNear',
];

const SPEC_REFUSED = [
  '$out', '$merge', '$collStats', '$indexStats', '$planCacheStats', '$changeStream', '$currentOp', '$listSessions',
  '$documents', '$search', '$vectorSearch', '$future', '$listLocalSessions', 'match', '$', '',
];

const stage = (op: string, body: unknown = {}) => ({ [op]: body });

/** `n` levels of pipeline inside pipeline, the innermost holding `inner`. */
function nested(n: number, inner: Record<string, unknown>, via: 'facet' | 'lookup' | 'union' = 'facet'): unknown[] {
  let pipeline: unknown[] = [inner];
  for (let i = 0; i < n; i += 1) {
    const wrapper =
      via === 'facet'
        ? { $facet: { branch: pipeline } }
        : via === 'lookup'
          ? { $lookup: { from: 'other', as: 'x', pipeline } }
          : { $unionWith: { coll: 'other', pipeline } };
    pipeline = [wrapper];
  }
  return pipeline;
}

const codeOf = (fn: () => void) => {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return 'did not throw';
};

describe('ALLOWED_STAGES', () => {
  it('is exactly the 26 stages of X27 §7.2', () => {
    expect([...ALLOWED_STAGES].sort((a, b) => a.localeCompare(b))).toEqual(
      [...SPEC_ALLOWED].sort((a, b) => a.localeCompare(b)),
    );
  });

  it('never lists a writing or server-introspecting stage', () => {
    for (const op of ['$out', '$merge', '$collStats', '$indexStats', '$currentOp', '$search', '$documents']) {
      expect(ALLOWED_STAGES.has(op)).toBe(false);
    }
  });
});

describe('assertPipeline', () => {
  it.each(SPEC_ALLOWED)('accepts %s', (op) => {
    expect(() => assertPipeline([stage(op)])).not.toThrow();
  });

  it.each(SPEC_REFUSED)('refuses %j with STAGE_NOT_ALLOWED, naming it', (op) => {
    const run = () => assertPipeline([stage('$match'), stage(op)]);
    expect(codeOf(run)).toBe('STAGE_NOT_ALLOWED');
    expect(() => run()).toThrow(`The pipeline stage ${op} is not allowed.`);
  });

  it('accepts an empty pipeline', () => {
    expect(() => assertPipeline([])).not.toThrow();
  });

  it('refuses a stage in any position, not only the last', () => {
    expect(codeOf(() => assertPipeline([stage('$out', 'x'), stage('$match')]))).toBe('STAGE_NOT_ALLOWED');
  });

  it('cuts a very long stage name in the message', () => {
    const long = `$${'a'.repeat(100)}`;
    expect(() => assertPipeline([stage(long)])).toThrow(`The pipeline stage ${long.slice(0, 64)}... is not allowed.`);
    const exact = `$${'b'.repeat(63)}`;
    expect(() => assertPipeline([stage(exact)])).toThrow(`The pipeline stage ${exact} is not allowed.`);
  });

  it('keeps isWriteStage as a second line: a writing stage in the allowed set is still refused', () => {
    const allowedWithOut = new Set([...ALLOWED_STAGES, '$out', '$merge']);
    expect(codeOf(() => assertPipeline([stage('$out', 'x')], allowedWithOut))).toBe('STAGE_NOT_ALLOWED');
    expect(codeOf(() => assertPipeline([stage('$merge', {})], allowedWithOut))).toBe('STAGE_NOT_ALLOWED');
    expect(() => assertPipeline([stage('$match')], allowedWithOut)).not.toThrow();
  });

  it('honours a caller-supplied allowed set', () => {
    expect(codeOf(() => assertPipeline([stage('$match')], new Set(['$project'])))).toBe('STAGE_NOT_ALLOWED');
  });

  describe.each([
    ['$facet', 'facet'],
    ['$lookup.pipeline', 'lookup'],
    ['$unionWith.pipeline', 'union'],
  ] as const)('inside %s', (_label, via) => {
    it.each([1, 2, 3])('refuses a $out %i level(s) deep', (levels) => {
      expect(codeOf(() => assertPipeline(nested(levels, stage('$out', 'x'), via)))).toBe('STAGE_NOT_ALLOWED');
    });

    it('refuses an unknown $future stage three levels deep', () => {
      expect(codeOf(() => assertPipeline(nested(3, stage('$future'), via)))).toBe('STAGE_NOT_ALLOWED');
    });

    it('accepts allowlisted stages three levels deep', () => {
      expect(() => assertPipeline(nested(3, stage('$match', { a: 1 }), via))).not.toThrow();
    });
  });

  it('refuses a stage in any branch of a $facet, not only the first', () => {
    const pipeline = [{ $facet: { ok: [stage('$match')], bad: [stage('$merge', {})], later: [stage('$match')] } }];
    expect(codeOf(() => assertPipeline(pipeline))).toBe('STAGE_NOT_ALLOWED');
  });

  it('refuses a mix of the three containers three levels deep', () => {
    const pipeline = [
      { $facet: { a: [{ $lookup: { from: 'x', as: 'y', pipeline: [{ $unionWith: { coll: 'z', pipeline: [stage('$out', 'q')] } }] } }] } },
    ];
    expect(codeOf(() => assertPipeline(pipeline))).toBe('STAGE_NOT_ALLOWED');
  });

  it('does not look inside a $unionWith given as a plain collection name, or a $lookup without a pipeline', () => {
    expect(() =>
      assertPipeline([stage('$unionWith', 'other'), stage('$lookup', { from: 'o', localField: 'a', foreignField: 'b', as: 'c' })]),
    ).not.toThrow();
  });

  it('walks own keys only: a $facet branch named __proto__ is still checked', () => {
    const pipeline = [JSON.parse('{"$facet":{"__proto__":[{"$out":"x"}]}}') as Record<string, unknown>];
    expect(codeOf(() => assertPipeline(pipeline))).toBe('STAGE_NOT_ALLOWED');
  });
});

describe('walkStages', () => {
  it('visits every stage outermost first, with its body', () => {
    const seen: string[] = [];
    walkStages(
      [stage('$match', { a: 1 }), { $facet: { x: [stage('$sort', { a: 1 })], y: [stage('$limit', 1)] } }, stage('$skip', 2)],
      (op, body) => seen.push(`${op}:${JSON.stringify(body)}`),
    );
    expect(seen).toEqual([
      '$match:{"a":1}',
      '$facet:{"x":[{"$sort":{"a":1}}],"y":[{"$limit":1}]}',
      '$sort:{"a":1}',
      '$limit:1',
      '$skip:2',
    ]);
  });

  it('visits $lookup.pipeline and $unionWith.pipeline stages', () => {
    const seen: string[] = [];
    walkStages(
      [
        stage('$lookup', { from: 'a', as: 'b', pipeline: [stage('$match', {})] }),
        stage('$unionWith', { coll: 'c', pipeline: [stage('$project', {})] }),
      ],
      (op) => seen.push(op),
    );
    expect(seen).toEqual(['$lookup', '$match', '$unionWith', '$project']);
  });

  it('refuses a pipeline that is not an array', () => {
    for (const bad of [undefined, null, {}, 'x', 1]) expect(codeOf(() => walkStages(bad, () => undefined))).toBe('INVALID_INPUT');
    expect(() => walkStages({}, () => undefined)).toThrow('A pipeline must be an array of stages.');
  });

  it('refuses a stage that is not an object with exactly one key', () => {
    for (const bad of [null, 'x', 1, [], {}, { $match: {}, $sort: {} }]) {
      expect(codeOf(() => walkStages([bad], () => undefined))).toBe('INVALID_INPUT');
    }
    expect(() => walkStages(['x'], () => undefined)).toThrow('Each pipeline stage must be an object.');
    expect(() => walkStages([{}], () => undefined)).toThrow('Each pipeline stage must have exactly one operator.');
    expect(() => walkStages([{ $match: {}, $sort: {} }], () => undefined)).toThrow('Each pipeline stage must have exactly one operator.');
  });

  it('only walks a pipeline key inside $lookup and $unionWith, not a field that happens to be named pipeline', () => {
    const inner = [stage('$out', 'x')];
    for (const op of ['$match', '$addFields', '$project', '$group', '$graphLookup']) {
      expect(() => assertPipeline([stage(op, { pipeline: inner })])).not.toThrow();
    }
    expect(() => assertPipeline([stage('$facet', { branch: [stage('$match')] })])).not.toThrow();
    expect(codeOf(() => assertPipeline([stage('$facet', { pipeline: inner })]))).toBe('STAGE_NOT_ALLOWED');
  });

  it('refuses a malformed $facet, and a nested value that is not a pipeline', () => {
    expect(() => walkStages([stage('$facet', [])], () => undefined)).toThrow('$facet takes an object of pipelines.');
    expect(codeOf(() => walkStages([stage('$facet', [])], () => undefined))).toBe('INVALID_INPUT');
    expect(codeOf(() => walkStages([stage('$facet', null)], () => undefined))).toBe('INVALID_INPUT');
    expect(codeOf(() => walkStages([stage('$facet', { a: {} })], () => undefined))).toBe('INVALID_INPUT');
    expect(codeOf(() => walkStages([stage('$lookup', { pipeline: 'x' })], () => undefined))).toBe('INVALID_INPUT');
    expect(codeOf(() => walkStages([stage('$unionWith', { pipeline: {} })], () => undefined))).toBe('INVALID_INPUT');
  });

  it('allows MAX_PIPELINE_NESTING levels of nesting and refuses one more', () => {
    expect(() => walkStages(nested(MAX_PIPELINE_NESTING, stage('$match')), () => undefined)).not.toThrow();
    expect(codeOf(() => walkStages(nested(MAX_PIPELINE_NESTING + 1, stage('$match')), () => undefined))).toBe('INVALID_INPUT');
    expect(() => walkStages(nested(MAX_PIPELINE_NESTING + 1, stage('$match')), () => undefined)).toThrow('The pipeline is nested too deeply.');
  });
});

describe('assertNoServerJs', () => {
  const clean = [
    null,
    undefined,
    1,
    'x',
    true,
    [],
    {},
    { a: 1, b: [{ c: 'd' }] },
    { $expr: { $gt: ['$a', '$b'] } },
    { note: '$where' },
    { where: 1, $whereabouts: 2, function: 3, $functions: 4, accumulator: 5 },
    [['$function']],
  ];
  it.each(clean.map((v) => [JSON.stringify(v) ?? 'undefined', v]))('accepts %s', (_label, value) => {
    expect(() => assertNoServerJs(value)).not.toThrow();
  });

  it.each([...SERVER_JS_KEYS])('refuses %s with JS_NOT_ALLOWED, in every position', (key) => {
    const positions: unknown[] = [
      { [key]: 'x' },
      { a: { [key]: 'x' } },
      { $and: [{ a: 1 }, { [key]: 'x' }] },
      { $expr: { $and: [{ [key]: {} }] } },
      [{ $match: { [key]: 1 } }],
      [{ $addFields: { f: { [key]: {} } } }],
      [{ $facet: { a: [{ $match: { [key]: 1 } }] } }],
      [{ $lookup: { from: 'x', as: 'y', pipeline: [{ $match: { [key]: 1 } }] } }],
      [{ $unionWith: { coll: 'x', pipeline: [{ $match: { [key]: 1 } }] } }],
      [{ $facet: { a: [{ $lookup: { from: 'x', as: 'y', pipeline: [{ $unionWith: { coll: 'z', pipeline: [{ $match: { [key]: 1 } }] } }] } }] } }],
      [[[{ [key]: 1 }]]],
    ];
    for (const value of positions) expect(codeOf(() => assertNoServerJs(value))).toBe('JS_NOT_ALLOWED');
  });

  it('tells the Agent to use $expr', () => {
    expect(() => assertNoServerJs({ $where: 'x' })).toThrow(/\$expr/);
  });

  it('finds a key that is an own property named __proto__', () => {
    const hidden = JSON.parse('{"__proto__":{"$where":"1"}}') as unknown;
    expect(codeOf(() => assertNoServerJs(hidden))).toBe('JS_NOT_ALLOWED');
  });

  it('survives an array too long to spread into a call', () => {
    const big = Array.from({ length: 300_000 }, () => 1);
    expect(() => assertNoServerJs(big)).not.toThrow();
    big.push({ $function: 1 } as unknown as number);
    expect(codeOf(() => assertNoServerJs(big))).toBe('JS_NOT_ALLOWED');
  });
});

describe('assertDepth', () => {
  const arrays = (n: number): unknown => {
    let v: unknown = 1;
    for (let i = 0; i < n; i += 1) v = [v];
    return v;
  };
  const objects = (n: number): unknown => {
    let v: unknown = 1;
    for (let i = 0; i < n; i += 1) v = { k: v };
    return v;
  };

  it('accepts primitives and any value up to MAX_JSON_DEPTH levels of containers', () => {
    expect(() => assertDepth(1)).not.toThrow();
    expect(() => assertDepth(null)).not.toThrow();
    expect(() => assertDepth(arrays(MAX_JSON_DEPTH))).not.toThrow();
    expect(() => assertDepth(objects(MAX_JSON_DEPTH))).not.toThrow();
  });

  it('refuses one level more, for arrays and objects alike', () => {
    expect(codeOf(() => assertDepth(arrays(MAX_JSON_DEPTH + 1)))).toBe('INVALID_INPUT');
    expect(() => assertDepth(arrays(MAX_JSON_DEPTH + 1))).toThrow('The input is nested too deeply.');
    expect(codeOf(() => assertDepth(objects(MAX_JSON_DEPTH + 1)))).toBe('INVALID_INPUT');
  });

  it('measures every branch, not only the first', () => {
    expect(codeOf(() => assertDepth({ shallow: 1, other: [1, 2], deep: objects(MAX_JSON_DEPTH + 1) }))).toBe('INVALID_INPUT');
  });

  it('takes the limit as a parameter and handles values far deeper than the stack', () => {
    expect(() => assertDepth(arrays(3), 3)).not.toThrow();
    expect(codeOf(() => assertDepth(arrays(4), 3))).toBe('INVALID_INPUT');
    expect(codeOf(() => assertDepth(arrays(200_000)))).toBe('INVALID_INPUT');
  });
});

describe('isRecord', () => {
  it('is true for objects and false for arrays, null and primitives', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
    for (const v of [[], null, undefined, 1, 'x', true]) expect(isRecord(v)).toBe(false);
  });
});
