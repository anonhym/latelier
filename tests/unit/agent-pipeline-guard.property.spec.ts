import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  ALLOWED_STAGES,
  SERVER_JS_KEYS,
  assertNoServerJs,
  assertPipeline,
} from '../../electron/agent/pipelineGuard';
import { assertPipelineNamespaces } from '../../electron/agent/namespaceGuard';

type Stage = Record<string, unknown>;
type Kind = 'facet' | 'lookup' | 'union';

// Stages whose body names a collection, so the namespace walk reads them: generated with a proper shape below.
const CONTAINERS = new Set(['$facet', '$lookup', '$unionWith', '$graphLookup']);
const LEAF_OPS = [...ALLOWED_STAGES].filter((op) => !CONTAINERS.has(op));

// Keys an Agent could not mistake for a server-side JavaScript operator; `__proto__` is built by hand in the unit spec.
const safeKey = fc
  .stringMatching(/^[a-zA-Z$_][a-zA-Z0-9$_]{0,7}$/)
  .filter((k) => !SERVER_JS_KEYS.has(k) && k !== '__proto__');

const { json: safeBody } = fc.letrec<{ json: unknown }>((tie) => ({
  json: fc.oneof(
    { depthSize: 'small', maxDepth: 3 },
    fc.constant(null),
    fc.boolean(),
    fc.integer(),
    fc.string(),
    fc.array(tie('json'), { maxLength: 3 }),
    fc.dictionary(safeKey, tie('json'), { maxKeys: 3 }),
  ),
}));

const safeLeaf: fc.Arbitrary<Stage> = fc.tuple(fc.constantFrom(...LEAF_OPS), safeBody).map(([op, body]) => ({ [op]: body }));

const collection = fc.stringMatching(/^[a-z]{1,8}$/);

/** A pipeline of allowlisted stages with operator-free bodies, containers nested up to three deep. */
const { pipeline: safePipeline } = fc.letrec<{ pipeline: Stage[]; stage: Stage }>((tie) => ({
  stage: fc.oneof(
    { depthSize: 'small', maxDepth: 3 },
    safeLeaf,
    safeLeaf,
    fc.dictionary(safeKey, tie('pipeline'), { minKeys: 1, maxKeys: 2 }).map((branches) => ({ $facet: branches })),
    fc.tuple(collection, tie('pipeline')).map(([from, pipeline]) => ({ $lookup: { from, as: 'out', pipeline } })),
    fc.tuple(collection, tie('pipeline')).map(([coll, pipeline]) => ({ $unionWith: { coll, pipeline } })),
    collection.map((from) => ({ $graphLookup: { from, startWith: '$a', connectFromField: 'a', connectToField: 'b', as: 'out' } })),
    collection.map((coll) => ({ $unionWith: coll })),
  ),
  pipeline: fc.array(tie('stage'), { maxLength: 3 }),
}));

function wrapIn(kind: Kind, pipeline: Stage[]): Stage {
  if (kind === 'facet') return { $facet: { branch: pipeline } };
  if (kind === 'lookup') return { $lookup: { from: 'other', as: 'out', pipeline } };
  return { $unionWith: { coll: 'other', pipeline } };
}

/** `target` placed at the end of `kinds.length` levels of nesting, with allowlisted siblings at every level. */
const placed = (target: fc.Arbitrary<Stage>) =>
  fc
    .tuple(
      target,
      fc.array(fc.tuple(fc.constantFrom<Kind>('facet', 'lookup', 'union'), fc.array(safeLeaf, { maxLength: 2 }), fc.array(safeLeaf, { maxLength: 2 })), {
        maxLength: 3,
      }),
      fc.array(safeLeaf, { maxLength: 2 }),
      fc.array(safeLeaf, { maxLength: 2 }),
    )
    .map(([stage, levels, before, after]) => {
      let pipeline: Stage[] = [...before, stage, ...after];
      for (const [kind, lead, trail] of levels) pipeline = [...lead, wrapIn(kind, pipeline), ...trail];
      return pipeline;
    });

const refusedOp = fc
  .oneof(
    fc.constantFrom('$out', '$merge', '$collStats', '$indexStats', '$planCacheStats', '$changeStream', '$currentOp', '$listSessions', '$documents', '$search', '$vectorSearch'),
    fc.stringMatching(/^\$[a-zA-Z]{1,12}$/),
    fc.stringMatching(/^[a-zA-Z]{1,12}$/),
  )
  .filter((op) => !ALLOWED_STAGES.has(op));

const jsKey = fc.constantFrom(...SERVER_JS_KEYS);

/** A body that buries a JavaScript operator under a few levels of ordinary keys and arrays. */
const jsBody: fc.Arbitrary<unknown> = fc
  .tuple(jsKey, safeBody, fc.array(fc.oneof(safeKey, fc.constant(0)), { maxLength: 4 }))
  .map(([key, value, path]) => {
    let node: unknown = { [key]: value };
    for (const step of [...path].reverse()) node = typeof step === 'number' ? [node] : { [step]: node };
    return node;
  });

const jsStage: fc.Arbitrary<Stage> = fc.tuple(fc.constantFrom(...LEAF_OPS), jsBody).map(([op, body]) => ({ [op]: body }));

/** A cross-collection stage that reads a system collection or names its source as an object. */
const deniedSource: fc.Arbitrary<Stage> = fc
  .tuple(fc.stringMatching(/^[a-z.]{0,8}$/), collection)
  .chain(([suffix, db]) => {
    const system = `system.${suffix}`;
    const objectForm = { db, coll: 'c' };
    return fc.constantFrom<Stage>(
      { $lookup: { from: system, localField: 'a', foreignField: 'b', as: 'o' } },
      { $lookup: { from: objectForm, localField: 'a', foreignField: 'b', as: 'o' } },
      { $graphLookup: { from: system, startWith: '$a', connectFromField: 'a', connectToField: 'b', as: 'o' } },
      { $graphLookup: { from: objectForm, startWith: '$a', connectFromField: 'a', connectToField: 'b', as: 'o' } },
      { $unionWith: system },
      { $unionWith: { coll: system } },
      { $unionWith: { coll: objectForm } },
    );
  });

const refusedCode = (fn: () => void): string => {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code ?? 'no code';
  }
  return 'accepted';
};

describe('pipeline guard properties', () => {
  it('refuses any pipeline that holds a stage outside the allowlist, at any depth', () => {
    fc.assert(
      fc.property(placed(refusedOp.map((op) => ({ [op]: {} }))), (pipeline) => {
        expect(refusedCode(() => assertPipeline(pipeline))).toBe('STAGE_NOT_ALLOWED');
      }),
    );
  });

  it('refuses any pipeline that holds a server-side JavaScript operator, at any depth', () => {
    fc.assert(
      fc.property(placed(jsStage), (pipeline) => {
        expect(refusedCode(() => assertNoServerJs(pipeline))).toBe('JS_NOT_ALLOWED');
      }),
    );
  });

  it('refuses any cross-collection stage that reads a system collection or uses the object form, at any depth', () => {
    fc.assert(
      fc.property(placed(deniedSource), (pipeline) => {
        expect(refusedCode(() => assertPipeline(pipeline))).toBe('accepted');
        expect(refusedCode(() => assertPipelineNamespaces(pipeline))).toBe('NAMESPACE_DENIED');
      }),
    );
  });

  it('accepts any pipeline built only from allowlisted stages with operator-free bodies', () => {
    fc.assert(
      fc.property(safePipeline, (pipeline) => {
        expect(refusedCode(() => assertPipeline(pipeline))).toBe('accepted');
        expect(refusedCode(() => assertNoServerJs(pipeline))).toBe('accepted');
        expect(refusedCode(() => assertPipelineNamespaces(pipeline))).toBe('accepted');
      }),
    );
  });

  it('does not change the pipeline it inspects', () => {
    fc.assert(
      fc.property(safePipeline, (pipeline) => {
        const before = JSON.stringify(pipeline);
        assertPipeline(pipeline);
        assertNoServerJs(pipeline);
        expect(JSON.stringify(pipeline)).toBe(before);
      }),
    );
  });
});
