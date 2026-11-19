import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { stageBodyCompletionSource } from '../../src/components/scriptEditor/stageBodyCompletions';
import { invalidateSampleSchemaCache } from '../../src/features/fieldSuggestions/sources';
import { validateStageBody } from '../../src/pages/Workspace/Aggregation/pipeline';

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

const CTX = { connectionId: 'c1', dbName: 'shop', collection: 'orders' };

interface Run {
  result: CompletionResult | null;
  labels: string[];
  /** The document after picking `label`, exactly as CodeMirror would write it. */
  pick: (label: string) => string;
}

async function run(stageOp: string, fixture: string, explicit = false): Promise<Run> {
  const pos = fixture.indexOf('█');
  if (pos < 0) throw new Error('fixture missing caret marker');
  const doc = fixture.slice(0, pos) + fixture.slice(pos + 1);
  const source = stageBodyCompletionSource({ getContext: () => CTX, getStageOp: () => stageOp });
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
