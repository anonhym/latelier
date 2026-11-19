import { describe, expect, it } from 'vitest';
import {
  stagesInPipelineText,
  shapeBefore,
  shapeFields,
  type ShapeStage,
  type SourceField,
} from '../../src/features/fieldSuggestions/stageShape';

const st = (op: string, body: string, enabled = true): ShapeStage => ({ op, body, enabled });
const SOURCE: SourceField[] = [
  { path: 'name', type: 'string', frequency: 9 },
  { path: 'age', type: 'number', frequency: 8 },
  { path: 'tags', type: 'array', frequency: 7 },
  { path: 'address', type: 'object', frequency: 6 },
  { path: 'address.city', type: 'string', frequency: 6 },
];
const SOURCE_PATHS = SOURCE.map((f) => f.path);

/** The paths offered at stage `index`, with the origin of each. */
function at(stages: ShapeStage[], index: number, preview: string[] = []) {
  const { fields, unknownShape } = shapeFields(shapeBefore(stages, index), SOURCE, preview);
  return { paths: fields.map((f) => f.path).sort((a, b) => a.localeCompare(b)), unknownShape, fields };
}
const sorted = (xs: string[]) => [...xs].sort((a, b) => a.localeCompare(b));

describe('the fields that reach a stage', () => {
  it('the first stage sees the source fields', () => {
    const r = at([st('$match', '{}')], 0);
    expect(r.paths).toEqual(sorted(SOURCE_PATHS));
    expect(r.unknownShape).toBe(false);
  });

  it.each([
    ['$match', '{ age: { $gt: 1 } }'],
    ['$sort', '{ age: 1 }'],
    ['$limit', '5'],
    ['$skip', '5'],
    ['$sample', '{ size: 3 }'],
  ])('a %s keeps every source field', (op, body) => {
    expect(at([st(op, body), st('$group', '{ _id: "$a" }')], 1).paths).toEqual(sorted(SOURCE_PATHS));
  });

  it('a chain of pass-through stages keeps the source fields', () => {
    const stages = [
      st('$match', '{ age: { $gt: 1 } }'),
      st('$sort', '{ age: -1 }'),
      st('$skip', '1'),
      st('$limit', '10'),
      st('$group', '{ _id: "$name" }'),
    ];
    expect(at(stages, 4).paths).toEqual(sorted(SOURCE_PATHS));
  });

  it('a $group drops the source fields and offers its own', () => {
    const stages = [st('$group', '{ _id: "$name", total: { $sum: "$age" }, n: { $sum: 1 } }'), st('$sort', '{ n: -1 }')];
    expect(at(stages, 1).paths).toEqual(['_id', 'n', 'total']);
  });

  it('a $group with a compound _id offers its parts', () => {
    const stages = [st('$group', '{ _id: { by: "$name", yr: { $year: "$d" } }, n: { $sum: 1 } }'), st('$match', '{}')];
    expect(at(stages, 1).paths).toEqual(['_id', '_id.by', '_id.yr', 'n']);
  });

  it('a $lookup keeps the source fields and adds its as', () => {
    const stages = [st('$lookup', '{ from: "c", localField: "a", foreignField: "b", as: "orders" }'), st('$match', '{}')];
    expect(at(stages, 1).paths).toEqual(sorted([...SOURCE_PATHS, 'orders']));
  });

  it.each([
    ['$addFields', '{ full: { $concat: ["$name"] }, "a.b": 1 }', ['full', 'a.b']],
    ['$set', '{ full: 1 }', ['full']],
    ['$unwind', '{ path: "$tags", includeArrayIndex: "i" }', ['i']],
    ['$unwind', '"$tags"', []],
    ['$setWindowFields', '{ sortBy: { age: 1 }, output: { r: { $rank: {} } } }', ['r']],
    ['$geoNear', '{ near: {}, distanceField: "dist", includeLocs: "loc" }', ['dist', 'loc']],
    ['$graphLookup', '{ from: "x", startWith: "$a", as: "tree" }', ['tree']],
  ])('a %s keeps the source fields and adds %j', (op, body, added) => {
    expect(at([st(op, body), st('$match', '{}')], 1).paths).toEqual(sorted([...SOURCE_PATHS, ...added]));
  });

  it('an $unset removes the named fields and what lies below them', () => {
    expect(at([st('$unset', '"address"'), st('$match', '{}')], 1).paths).toEqual(['age', 'name', 'tags']);
    expect(at([st('$unset', '["age", "tags"]'), st('$match', '{}')], 1).paths).toEqual(
      sorted(['name', 'address', 'address.city']),
    );
  });

  it('an $unset takes away a field an earlier stage added', () => {
    const stages = [st('$addFields', '{ tmp: 1 }'), st('$unset', '"tmp"'), st('$match', '{}')];
    expect(at(stages, 2).paths).toEqual(sorted(SOURCE_PATHS));
  });

  it('a $project with inclusions rebuilds the shape, _id included', () => {
    expect(at([st('$project', '{ name: 1, shout: { $toUpper: "$name" } }'), st('$match', '{}')], 1).paths).toEqual([
      '_id',
      'name',
      'shout',
    ]);
    expect(at([st('$project', '{ name: 1, _id: 0 }'), st('$match', '{}')], 1).paths).toEqual(['name']);
    expect(at([st('$project', '{ _id: 1 }'), st('$match', '{}')], 1).paths).toEqual(['_id']);
  });

  it('a $project of exclusions only removes them', () => {
    expect(at([st('$project', '{ age: 0, tags: false }'), st('$match', '{}')], 1).paths).toEqual(
      sorted(['name', 'address', 'address.city']),
    );
    expect(at([st('$project', '{ _id: 0 }'), st('$match', '{}')], 1).paths).toEqual(sorted(SOURCE_PATHS));
  });

  it.each([
    ['$count', '"n"', ['n']],
    ['$sortByCount', '"$name"', ['_id', 'count']],
    ['$bucket', '{ groupBy: "$age", boundaries: [0, 9], output: { total: { $sum: 1 } } }', ['_id', 'count', 'total']],
    ['$bucketAuto', '{ groupBy: "$age", buckets: 2 }', ['_id', 'count']],
    ['$facet', '{ a: [], b: [] }', ['a', 'b']],
  ])('a %s drops the source fields', (op, body, expected) => {
    expect(at([st(op, body), st('$match', '{}')], 1).paths).toEqual(expected);
  });

  it('a stage after the rebuild adds to the rebuilt shape, not the source one', () => {
    const stages = [st('$group', '{ _id: "$name" }'), st('$addFields', '{ x: 1 }'), st('$match', '{}')];
    expect(at(stages, 2).paths).toEqual(['_id', 'x']);
  });

  it('a disabled stage is skipped, wherever it sits', () => {
    const stages = [st('$group', '{ _id: "$name" }', false), st('$match', '{}'), st('$group', '{ n: 1 }', false), st('$match', '{}')];
    expect(at(stages, 3).paths).toEqual(sorted(SOURCE_PATHS));
    // And the stage itself, when it is the disabled one, still sees what is before it.
    expect(at([st('$group', '{ _id: "$name" }'), st('$match', '{}', false)], 1).paths).toEqual(['_id']);
  });

  it('only the stages before the edited one count', () => {
    const stages = [st('$match', '{}'), st('$group', '{ _id: "$name" }'), st('$project', '{ z: 1 }')];
    expect(at(stages, 0).paths).toEqual(sorted(SOURCE_PATHS));
    expect(at(stages, 1).paths).toEqual(sorted(SOURCE_PATHS));
    expect(at(stages, 2).paths).toEqual(['_id']);
  });

  it('an $out or $merge changes nothing', () => {
    expect(at([st('$out', '"x"'), st('$match', '{}')], 1).paths).toEqual(sorted(SOURCE_PATHS));
  });
});

describe('where the text cannot say', () => {
  it.each([
    ['$replaceRoot', '{ newRoot: "$address" }'],
    ['$replaceWith', '"$address"'],
    ['$unionWith', '{ coll: "x" }'],
    ['$documents', '[ {} ]'],
  ])('after a %s only the previous stage\'s preview names fields', (op, body) => {
    const r = at([st(op, body), st('$match', '{}')], 1, ['city', 'zip']);
    expect(r.paths).toEqual(['city', 'zip']);
    expect(r.unknownShape).toBe(false);
    expect(r.fields.every((f) => f.origin === 'preview')).toBe(true);
  });

  it('falls back to the source fields, flagged, when there is no preview either', () => {
    const r = at([st('$replaceRoot', '{ newRoot: "$address" }'), st('$match', '{}')], 1);
    expect(r.paths).toEqual(sorted(SOURCE_PATHS));
    expect(r.unknownShape).toBe(true);
    expect(r.fields.every((f) => f.origin === 'source')).toBe(true);
  });

  it('a stage whose body does not parse leaves the shape unknown but keeps what is known', () => {
    const r = at([st('$group', '{ _id: '), st('$match', '{}')], 1);
    expect(r.paths).toEqual(sorted(SOURCE_PATHS));
    expect(r.unknownShape).toBe(true);
  });

  it('a body of the wrong kind leaves the shape unknown', () => {
    expect(at([st('$group', '"x"'), st('$match', '{}')], 1).unknownShape).toBe(true);
    expect(at([st('$count', '{}'), st('$match', '{}')], 1).unknownShape).toBe(true);
    expect(at([st('$unset', '5'), st('$match', '{}')], 1).unknownShape).toBe(true);
    expect(at([st('$unwind', '5'), st('$match', '{}')], 1).unknownShape).toBe(true);
  });

  it('an operator it does not know leaves the shape unknown', () => {
    const r = at([st('$mystery', '{}'), st('$match', '{}')], 1);
    expect(r.unknownShape).toBe(true);
    expect(r.paths).toEqual(sorted(SOURCE_PATHS));
  });

  it('a later stage whose text is known makes the shape known again', () => {
    const stages = [st('$replaceRoot', '{ newRoot: "$address" }'), st('$group', '{ _id: "$city" }'), st('$match', '{}')];
    const r = at(stages, 2);
    expect(r.paths).toEqual(['_id']);
    expect(r.unknownShape).toBe(false);
  });

  it('parses Shell Syntax: unquoted keys, single quotes, a date constructor', () => {
    const stages = [st('$group', `{ _id: '$name', first: { $min: ISODate("2020-01-01") } }`), st('$match', '{}')];
    expect(at(stages, 1).paths).toEqual(['_id', 'first']);
  });
});

describe('merging with the previous stage\'s preview', () => {
  it('adds the preview\'s fields, once, to a derived shape', () => {
    const stages = [st('$group', '{ _id: { k: "$name" }, n: { $sum: 1 } }'), st('$match', '{}')];
    const r = at(stages, 1, ['_id', 'n', 'surprise']);
    expect(r.paths).toEqual(['_id', '_id.k', 'n', 'surprise']);
    expect(r.fields.find((f) => f.path === 'surprise')?.origin).toBe('preview');
    expect(r.fields.find((f) => f.path === 'n')?.origin).toBe('derived');
  });

  it('keeps the source field\'s type and frequency over a preview or derived entry', () => {
    const r = at([st('$addFields', '{ name: 1 }'), st('$match', '{}')], 1, ['name']);
    expect(r.fields.find((f) => f.path === 'name')).toEqual({ path: 'name', origin: 'source', type: 'string', frequency: 9 });
  });

  it('does not offer a preview field an $unset took out of the source', () => {
    const r = at([st('$unset', '"age"'), st('$match', '{}')], 1);
    expect(r.paths).not.toContain('age');
  });
});

describe('the shape stage by stage', () => {
  const shape = (stages: ShapeStage[]) => shapeBefore(stages, stages.length);

  it('starts as the untouched source', () => {
    expect(shapeBefore([], 0)).toEqual({ kind: 'source', keepSource: true, removed: [], added: [] });
    expect(shape([st('$match', '{}')])).toEqual({ kind: 'source', keepSource: true, removed: [], added: [] });
  });

  it.each([
    ['$group', '{ _id: "$a", n: { $sum: 1 } }', ['_id', 'n']],
    ['$group', '{ n: 1, _id: 1 }', ['_id', 'n']],
    ['$group', '{ _id: { $year: "$d" } }', ['_id']],
    ['$group', '{ _id: { y: 1, $x: 2 } }', ['_id', '_id.y']],
    ['$group', '{ _id: null }', ['_id']],
    ['$count', '"total"', ['total']],
    ['$count', '""', []],
    ['$bucket', '{ groupBy: "$a", output: { s: { $sum: 1 } } }', ['_id', 'count', 's']],
    ['$bucket', '{ groupBy: "$a", output: 5 }', ['_id', 'count']],
    ['$facet', '{ a: [], b: [] }', ['a', 'b']],
    ['$project', '{ a: 1, b: { $x: 1 } }', ['_id', 'a', 'b']],
    ['$project', '{ a: 1, _id: false }', ['a']],
    ['$project', '{ _id: 1 }', ['_id']],
    ['$project', '{ _id: { $x: 1 } }', ['_id']],
  ])('%s %s rebuilds the shape as %j', (op, body, added) => {
    // A removal before it must not leak into the rebuilt shape.
    expect(shape([st('$unset', '"zzz"'), st('$addFields', '{ old: 1 }'), st(op, body)])).toEqual({
      kind: 'rebuilt',
      keepSource: false,
      removed: [],
      added,
    });
  });

  it.each([
    ['$addFields', '{ a: 1, b: 2 }', ['a', 'b']],
    ['$lookup', '{ as: "x" }', ['x']],
    ['$lookup', '{ as: "" }', []],
    ['$lookup', '{ as: 5 }', []],
    ['$graphLookup', '{ as: "t" }', ['t']],
    ['$unwind', '{ path: "$a" }', []],
    ['$unwind', '"$a"', []],
    ['$setWindowFields', '{ output: { r: 1 } }', ['r']],
    ['$setWindowFields', '{ output: 5 }', []],
    ['$setWindowFields', '{ sortBy: {} }', []],
    ['$geoNear', '{ distanceField: "d" }', ['d']],
    ['$geoNear', '{ near: {} }', []],
  ])('%s %s adds %j and keeps the source', (op, body, added) => {
    expect(shape([st(op, body)])).toEqual({ kind: 'source', keepSource: true, removed: [], added });
  });

  it('a field is added once, however many stages name it', () => {
    expect(shape([st('$addFields', '{ x: 1 }'), st('$set', '{ x: 2 }')]).added).toEqual(['x']);
  });

  it.each([
    ['$match', '{ broken'], ['$sort', ''], ['$limit', 'x'], ['$skip', '{'], ['$sample', ''], ['$redact', '5'],
    ['$fill', '{'], ['$densify', ''], ['$out', '{'], ['$merge', ''],
  ])('a %s changes nothing, whatever its body says', (op, body) => {
    expect(shape([st(op, body)])).toEqual({ kind: 'source', keepSource: true, removed: [], added: [] });
  });

  it('an $unset records what it removes, and only while the source is kept', () => {
    expect(shape([st('$unset', '["a", "b"]')])).toEqual({ kind: 'source', keepSource: true, removed: ['a', 'b'], added: [] });
    expect(shape([st('$group', '{ _id: 1 }'), st('$unset', '"_id"')])).toEqual({
      kind: 'rebuilt',
      keepSource: false,
      removed: [],
      added: [],
    });
  });

  it('an $unset leaves fields that only share a prefix', () => {
    const r = shapeFields(shapeBefore([st('$unset', '"addr"')], 1), [{ path: 'addr' }, { path: 'address' }, { path: 'addr.x' }], []);
    expect(r.fields.map((f) => f.path)).toEqual(['address']);
  });

  it.each([
    ['$project', '5'], ['$project', '"x"'], ['$project', '[]'], ['$project', 'null'], ['$project', ''],
    ['$addFields', '5'], ['$set', '[]'], ['$lookup', '"x"'], ['$graphLookup', '5'], ['$unwind', '5'],
    ['$unwind', 'null'], ['$group', '5'], ['$group', 'null'], ['$count', '{}'], ['$count', '5'],
    ['$bucket', '"x"'], ['$bucketAuto', '5'], ['$facet', '[]'], ['$setWindowFields', '5'], ['$geoNear', '"x"'],
    ['$unset', '5'], ['$unset', '["a", 1]'], ['$unset', '{}'], ['$mystery', '{}'],
  ])('a %s with the body %s leaves the shape unknown and unchanged', (op, body) => {
    expect(shape([st(op, body)])).toEqual({ kind: 'unknown', keepSource: true, removed: [], added: [] });
  });

  it.each(['$replaceRoot', '$replaceWith', '$unionWith', '$documents'])('a %s clears everything and marks the shape unknown', (op) => {
    expect(shape([st('$addFields', '{ x: 1 }'), st('$unset', '"a"'), st(op, '{}')])).toEqual({
      kind: 'unknown',
      keepSource: false,
      removed: [],
      added: [],
    });
  });
});

describe('what is offered when the shape is unknown or empty', () => {
  const offered = (stages: ShapeStage[], preview: string[] = []) =>
    shapeFields(shapeBefore(stages, stages.length), SOURCE, preview);

  it('after a rebuild whose text a later stage cannot read, offers what was derived, not the source', () => {
    const r = offered([st('$group', '{ _id: 1, n: 1 }'), st('$project', '')]);
    expect(r.fields.map((f) => f.path)).toEqual(['_id', 'n']);
    expect(r.unknownShape).toBe(true);
  });

  it('a rebuild that leaves no field offers none, and is not a guess', () => {
    const r = offered([st('$count', '""')]);
    expect(r.fields).toEqual([]);
    expect(r.unknownShape).toBe(false);
  });

  it('an unknown shape with a preview is not a guess, and does not offer the source', () => {
    const r = offered([st('$replaceRoot', '{}')], ['x']);
    expect(r.fields.map((f) => f.path)).toEqual(['x']);
    expect(r.unknownShape).toBe(false);
  });

  it('a kept source with an unreadable stage is flagged but still offered', () => {
    const r = offered([st('$addFields', '5')]);
    expect(r.fields.map((f) => f.path)).toEqual(SOURCE_PATHS);
    expect(r.unknownShape).toBe(true);
  });
});

describe('stagesInPipelineText', () => {
  it('reads the complete elements and leaves the one being typed', () => {
    expect(stagesInPipelineText('{ $match: { a: 1 } }, { $unset: "x" }, { $sort: { b')).toEqual([
      { op: '$match', body: '{"a":1}', enabled: true },
      { op: '$unset', body: '"x"', enabled: true },
    ]);
    expect(stagesInPipelineText('')).toEqual([]);
  });

  it('is not fooled by braces and quotes inside strings, or by nested arrays', () => {
    expect(stagesInPipelineText(`{ $match: { a: "}{ ]" } }, { $match: { b: 'it\\'s }' } }, { $in: [{ x: 1 }] }, `)).toEqual([
      { op: '$match', body: '{"a":"}{ ]"}', enabled: true },
      { op: '$match', body: '{"b":"it\'s }"}', enabled: true },
      { op: '$in', body: '[{"x":1}]', enabled: true },
    ]);
  });

  it('stands an unreadable element in as a stage with an unknown shape', () => {
    for (const text of ['{ $a: 1, $b: 2 }, ', '{ a: 1 }, ', '{ }, ', '{ $m: }, ']) {
      const stages = stagesInPipelineText(text);
      expect(stages).toEqual([{ op: '$unreadable', body: '', enabled: true }]);
      expect(shapeBefore(stages, 1).kind).toBe('unknown');
    }
  });
});
