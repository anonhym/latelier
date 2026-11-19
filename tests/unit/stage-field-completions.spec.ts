import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { stageBodyCompletionSource } from '../../src/components/scriptEditor/stageBodyCompletions';
import { invalidateSampleSchemaCache } from '../../src/features/fieldSuggestions/sources';
import { validateStageBody } from '../../src/pages/Workspace/Aggregation/pipeline';
import type { ShapeStage } from '../../src/features/fieldSuggestions/stageShape';

const { sampleSchema } = vi.hoisted(() => ({
  sampleSchema: vi.fn<(input: { collection: string }) => Promise<{ docs: unknown[] }>>(),
}));
vi.mock('../../src/api/atelier', () => ({ api: { meta: { sampleSchema } } }));

const DOCS: Record<string, unknown[]> = {
  orders: [{ name: 'a', age: 1, tags: ['x'], address: { city: 'p' } }],
  customers: [{ _id: 1, email: 'e' }],
};

beforeEach(() => {
  invalidateSampleSchemaCache();
  sampleSchema.mockReset().mockImplementation(async ({ collection }) => ({ docs: DOCS[collection] ?? [] }));
});

const CTX = { connectionId: 'c1', dbName: 'shop', collection: 'orders', recentDocs: [{ lastRunOnly: 1 }] };

interface Shape {
  stages: ShapeStage[];
  index: number;
  previewDocs?: unknown[];
}

interface Run {
  result: CompletionResult | null;
  labels: string[];
  /** The document after picking `label`, exactly as CodeMirror would write it. */
  pick: (label: string) => string;
}

async function run(stageOp: string, fixture: string, explicit = false, shape?: Shape): Promise<Run> {
  const pos = fixture.indexOf('█');
  if (pos < 0) throw new Error('fixture missing caret marker');
  const doc = fixture.slice(0, pos) + fixture.slice(pos + 1);
  const source = stageBodyCompletionSource({
    getContext: () => CTX,
    getStageOp: () => stageOp,
    ...(shape ? { getStageShape: () => shape } : {}),
  });
  const ctx = { pos, explicit, state: { doc: { toString: () => doc } } } as unknown as CompletionContext;
  const result = (await source(ctx)) as CompletionResult | null;
  return {
    result,
    labels: result?.options.map((o) => o.label) ?? [],
    pick: (label) => {
      const option = result?.options.find((o: Completion) => o.label === label);
      if (!result || !option) throw new Error(`no option ${label} in ${JSON.stringify(result?.options.map((o) => o.label))}`);
      const text = typeof option.apply === 'string' ? option.apply : option.label;
      return doc.slice(0, result.from) + text + doc.slice(result.to);
    },
  };
}

describe('field suggestions in a stage value: the inserted text, by position', () => {
  it.each([
    // Expression positions insert `$field`.
    ['$group', '{ _id: "$█" }', '$name', '{ _id: "$name" }'],
    ['$group', '{ _id: "█" }', '$name', '{ _id: "$name" }'],
    ['$group', '{ _id: "$na█", n: 1 }', '$name', '{ _id: "$name", n: 1 }'],
    ['$group', '{ _id: { by: "$█" } }', '$age', '{ _id: { by: "$age" } }'],
    ['$group', '{ _id: null, t: { $sum: "$█" } }', '$age', '{ _id: null, t: { $sum: "$age" } }'],
    ['$group', '{ _id: null, t: { $push: ["$█"] } }', '$name', '{ _id: null, t: { $push: ["$name"] } }'],
    ['$project', '{ a: "$█" }', '$address.city', '{ a: "$address.city" }'],
    ['$addFields', '{ a: { $concat: ["$█"] } }', '$name', '{ a: { $concat: ["$name"] } }'],
    ['$set', '{ a: "$█" }', '$name', '{ a: "$name" }'],
    ['$unwind', '"$█"', '$tags', '"$tags"'],
    ['$unwind', '{ path: "$█" }', '$tags', '{ path: "$tags" }'],
    ['$bucket', '{ groupBy: "$█", boundaries: [0] }', '$age', '{ groupBy: "$age", boundaries: [0] }'],
    ['$bucket', '{ groupBy: "$age", output: { n: { $sum: "$█" } } }', '$age', '{ groupBy: "$age", output: { n: { $sum: "$age" } } }'],
    ['$sortByCount', '"$█"', '$name', '"$name"'],
    ['$replaceRoot', '{ newRoot: "$█" }', '$address', '{ newRoot: "$address" }'],
    ['$match', '{ $expr: { $gt: ["$█", 1] } }', '$age', '{ $expr: { $gt: ["$age", 1] } }'],
    ['$lookup', '{ from: "customers", let: { v: "$█" } }', '$name', '{ from: "customers", let: { v: "$name" } }'],
    // Name positions insert the bare `field`.
    ['$lookup', '{ from: "customers", localField: "█", foreignField: "_id" }', 'name', '{ from: "customers", localField: "name", foreignField: "_id" }'],
    ['$unset', '"█"', 'name', '"name"'],
    ['$unset', '["age", "█"]', 'name', '["age", "name"]'],
    // An unquoted slot takes its quotes with the pick.
    ['$group', '{ _id: █ }', '$name', '{ _id: "$name" }'],
    ['$unwind', '{ path: █ }', '$tags', '{ path: "$tags" }'],
  ])('%s %s', async (stageOp, fixture, label, expected) => {
    const r = await run(stageOp, fixture, true);
    expect(r.pick(label)).toBe(expected);
    if (stageOp !== '$match') expect(validateStageBody({ id: 1, op: stageOp, body: expected, enabled: true })).toBeNull();
  });

  it('foreignField offers the joined collection\'s fields, not the source\'s', async () => {
    const r = await run('$lookup', '{ from: "customers", foreignField: "█" }');
    expect(r.labels).toEqual(['_id', 'email']);
    expect(r.pick('email')).toBe('{ from: "customers", foreignField: "email" }');
    expect(sampleSchema).toHaveBeenCalledTimes(1);
    expect(sampleSchema.mock.calls[0]![0]).toMatchObject({ collection: 'customers', dbName: 'shop' });
  });

  it('graphLookup\'s connect fields take the joined collection\'s fields, startWith the source\'s', async () => {
    const connect = await run('$graphLookup', '{ from: "customers", connectToField: "█" }');
    expect(connect.labels).toEqual(['_id', 'email']);
    const start = await run('$graphLookup', '{ from: "customers", startWith: "$█" }');
    expect(start.labels).toContain('$name');
    expect(start.labels).not.toContain('$email');
  });

  it('offers nothing for foreignField without a from collection', async () => {
    expect((await run('$lookup', '{ foreignField: "█" }')).result).toBeNull();
    expect(sampleSchema).not.toHaveBeenCalled();
  });

  it('offers the source\'s own fields for localField', async () => {
    const r = await run('$lookup', '{ from: "customers", localField: "█" }');
    expect(r.labels).toEqual(expect.arrayContaining(['name', 'age', 'tags', 'address', 'address.city']));
    expect(r.labels).not.toContain('email');
  });

  it('puts the replace range after the opening quote, so the typed `$` stays part of the token', async () => {
    const r = await run('$group', '{ _id: "$na█" }');
    expect(r.result).toMatchObject({ from: 8, to: 11 });
  });

  it.each([
    ['a literal string in a $project value', '$project', '{ a: "lit█" }'],
    ['a name that is not an expression, in $group', '$group', '{ total: "█" }'],
    ['a $-string in $match outside $expr', '$match', '{ a: "$█" }'],
    ['a name position that starts with $', '$unset', '"$█"'],
    ['a stage that takes no field', '$limit', '"█"'],
    ['$sort values', '$sort', '{ a: "█" }'],
    ['the preserveNullAndEmptyArrays value', '$unwind', '{ preserveNullAndEmptyArrays: "█" }'],
  ])('offers nothing for %s', async (_name, stageOp, fixture) => {
    expect((await run(stageOp, fixture, true)).result).toBeNull();
  });

  it('opens an unquoted, empty slot only when asked for, and offers it when the token already starts with $', async () => {
    expect((await run('$group', '{ _id: █ }', false)).result).toBeNull();
    expect((await run('$group', '{ _id: █ }', true)).result).not.toBeNull();
    expect((await run('$group', '{ _id: $n█ }', false)).result).not.toBeNull();
  });

  it('offers a field of a nested document under its dotted path', async () => {
    const r = await run('$project', '{ a: "$█" }');
    expect(r.labels).toContain('$address.city');
  });
});

describe('a key position', () => {
  it('offers bare field names in $sort, quoting a dotted one so it parses', async () => {
    const r = await run('$sort', '{ █ }');
    expect(r.pick('name')).toBe('{ name }');
    expect(r.pick('address.city')).toBe('{ "address.city" }');
  });

  it('inside quotes a dotted name goes in as it is', async () => {
    const r = await run('$project', '{ "█" }');
    expect(r.pick('address.city')).toBe('{ "address.city" }');
  });

  it('offers operators and no fields once a $ is typed', async () => {
    const r = await run('$group', '{ _id: null, t: { $█ } }');
    expect(r.labels).toEqual(expect.arrayContaining(['$sum', '$avg']));
    expect(r.labels).not.toContain('name');
    expect(r.labels).not.toContain('$name');
    const bare = await run('$group', '{ _id: null, t: { █ } }');
    expect(bare.labels).toContain('name');
  });
});

const st = (op: string, body: string, enabled = true): ShapeStage => ({ op, body, enabled });
const GROUP = st('$group', '{ _id: "$name", n: { $sum: 1 } }');

describe('fields from the stages before the edited one', () => {
  /** Runs the edited stage (the last of `before` plus the edited one) at the caret. */
  const inPipeline = (before: ShapeStage[], op: string, fixture: string, previewDocs?: unknown[]) =>
    run(op, fixture, false, { stages: [...before, st(op, fixture.replace('█', ''))], index: before.length, previewDocs });

  it('a pass-through chain keeps the source fields, in either form', async () => {
    const before = [st('$match', '{}'), st('$sort', '{ age: 1 }'), st('$limit', '5')];
    const expr = await inPipeline(before, '$group', '{ _id: "$█" }');
    expect([...expr.labels].sort((a, b) => a.localeCompare(b))).toEqual(['$address', '$address.city', '$age', '$name', '$tags']);
    expect(expr.pick('$tags')).toBe('{ _id: "$tags" }');
    const name = await inPipeline(before, '$unset', '"█"');
    expect(name.pick('age')).toBe('"age"');
  });

  it('a $group drops the source fields: expression and name positions see only its own', async () => {
    const expr = await inPipeline([GROUP], '$project', '{ a: "$█" }');
    expect(expr.labels).toEqual(['$_id', '$n']);
    expect(expr.pick('$n')).toBe('{ a: "$n" }');
    const name = await inPipeline([GROUP], '$unset', '"█"');
    expect(name.labels).toEqual(['_id', 'n']);
    const key = await inPipeline([GROUP], '$sort', '{ █ }');
    expect(key.labels.filter((l) => !l.startsWith('$'))).toEqual(['_id', 'n']);
    expect(key.pick('n')).toBe('{ n }');
  });

  it('a $lookup keeps the source fields and adds its as', async () => {
    const before = [st('$lookup', '{ from: "customers", localField: "name", foreignField: "_id", as: "buyer" }')];
    const r = await inPipeline(before, '$project', '{ a: "$█" }');
    expect(r.labels).toEqual(expect.arrayContaining(['$buyer', '$name', '$age']));
    expect(r.result?.options.find((o) => o.label === '$buyer')?.detail).toBe('from an earlier stage');
    expect(r.pick('$buyer')).toBe('{ a: "$buyer" }');
  });

  it('after a $replaceRoot only the previous stage\'s preview names fields', async () => {
    const before = [st('$replaceRoot', '{ newRoot: "$address" }')];
    const r = await inPipeline(before, '$project', '{ a: "$█" }', [{ city: 'p', zip: 'z' }]);
    expect(r.labels).toEqual(['$city', '$zip']);
    expect(r.result?.options[0]?.detail).toBe('from the preview');
    expect(r.pick('$zip')).toBe('{ a: "$zip" }');
  });

  it('with no preview after a $replaceRoot, offers the source fields marked as an unknown shape', async () => {
    const r = await inPipeline([st('$replaceRoot', '{ newRoot: "$address" }')], '$project', '{ a: "$█" }');
    expect(r.labels).toContain('$name');
    expect(r.result?.options.every((o) => o.detail === 'unknown shape')).toBe(true);
  });

  it('a disabled stage in the middle does not count', async () => {
    const r = await inPipeline([st('$group', '{ _id: "$name" }', false), st('$match', '{}')], '$project', '{ a: "$█" }');
    expect(r.labels).toContain('$age');
  });

  it('the previous stage\'s preview adds the fields the text could not name', async () => {
    const r = await inPipeline([GROUP], '$project', '{ a: "$█" }', [{ _id: 'x', n: 1, extra: 2 }]);
    expect(r.labels).toEqual(['$_id', '$n', '$extra']);
  });

  it('never offers the final output\'s fields', async () => {
    const r = await inPipeline([st('$match', '{}')], '$project', '{ a: "$█" }');
    expect(r.labels).not.toContain('$lastRunOnly');
    const key = await inPipeline([st('$match', '{}')], '$sort', '{ █ }');
    expect(key.labels).not.toContain('lastRunOnly');
  });

  it('a $ in a key position still offers operators and no fields', async () => {
    const r = await inPipeline([GROUP], '$group', '{ _id: null, t: { $█ } }');
    expect(r.labels).toEqual(expect.arrayContaining(['$sum']));
    expect(r.labels).not.toContain('_id');
    expect(r.labels).not.toContain('n');
  });

  it('a foreignField still reads the joined collection, whatever the pipeline before', async () => {
    const r = await inPipeline([GROUP], '$lookup', '{ from: "customers", foreignField: "█" }');
    expect(r.labels).toEqual(['_id', 'email']);
  });

  it('a localField sees the fields that reach the stage', async () => {
    const r = await inPipeline([GROUP], '$lookup', '{ from: "customers", localField: "█" }');
    expect(r.labels).toEqual(['_id', 'n']);
  });
});

describe('inside a $lookup sub-pipeline: the joined collection\'s fields', () => {
  const LOOKUP = (inner: string) => `{ from: "customers", localField: "name", foreignField: "_id", pipeline: [${inner}], as: "c" }`;
  const at = (inner: string, shape?: Shape) => run('$lookup', LOOKUP(inner), false, shape);

  it.each([
    // Expression positions insert $field, key positions the bare field.
    ['{ $match: { $expr: { $eq: ["$█", 1] } } }', '$email', '{ $match: { $expr: { $eq: ["$email", 1] } } }'],
    ['{ $group: { _id: "$█" } }', '$email', '{ $group: { _id: "$email" } }'],
    ['{ $project: { a: "$█" } }', '$email', '{ $project: { a: "$email" } }'],
    ['{ $unset: "█" }', 'email', '{ $unset: "email" }'],
    ['{ $sort: { █ } }', 'email', '{ $sort: { email } }'],
    ['{ $match: { █ } }', 'email', '{ $match: { email } }'],
  ])('%s', async (inner, label, expected) => {
    const r = await at(inner);
    expect(r.labels).not.toContain('name');
    expect(r.labels).not.toContain('$name');
    expect(r.pick(label)).toBe(LOOKUP(expected));
  });

  it('ignores the outer pipeline entirely', async () => {
    const shape = { stages: [st('$group', '{ _id: "$name", n: 1 }'), st('$lookup', '')], index: 1 };
    const r = await at('{ $project: { a: "$█" } }', shape);
    expect(r.labels).toEqual(['$_id', '$email']);
  });

  it('follows the sub-pipeline\'s own earlier stages', async () => {
    const group = await at('{ $group: { _id: "$email", n: { $sum: 1 } } }, { $sort: { █ } }');
    expect(group.labels.filter((l) => !l.startsWith('$'))).toEqual(['_id', 'n']);
    const added = await at('{ $addFields: { full: 1 } }, { $project: { a: "$█" } }');
    expect(added.labels).toEqual(['$_id', '$email', '$full']);
    const unset = await at('{ $unset: "email" }, { $project: { a: "$█" } }');
    expect(unset.labels).toEqual(['$_id']);
  });

  it('offers no fields where a stage name goes, and none without a from collection', async () => {
    const between = await at('█');
    expect(between.labels.every((l) => l.startsWith('$'))).toBe(true);
    expect(between.labels).not.toContain('email');
    const noFrom = await run('$lookup', '{ pipeline: [{ $match: { $expr: { $eq: ["$█", 1] } } }] }');
    expect(noFrom.result).toBeNull();
  });

  it('a nested $lookup\'s own foreignField is not guessed', async () => {
    expect((await at('{ $lookup: { from: "x", foreignField: "█" } }')).result).toBeNull();
  });

  it('the $lookup\'s own keys outside the pipeline still read as before', async () => {
    const r = await run('$lookup', '{ from: "customers", localField: "█", pipeline: [] }');
    expect(r.labels).toContain('name');
  });

  it('accepting a field with the caret inside an existing reference replaces the whole reference', async () => {
    const dollar = await run('$group', '{ _id: "$na█me", n: { $sum: 1 } }');
    expect(dollar.pick('$name')).toBe('{ _id: "$name", n: { $sum: 1 } }');
    const bare = await run('$lookup', '{ from: "customers", localField: "na█me", as: "c" }');
    expect(bare.pick('name')).toBe('{ from: "customers", localField: "name", as: "c" }');
  });

  it('stops at the closing quote of an unclosed or escaped string, and replaces an unquoted word whole', async () => {
    const unclosed = await run('$group', '{ _id: "$na█me\n}');
    expect(unclosed.pick('$name')).toBe('{ _id: "$name\n}');
    const unquoted = await run('$group', '{ _id: $na█me }', true);
    expect(unquoted.pick('$name')).toBe('{ _id: "$name" }');
  });
});
