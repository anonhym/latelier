import { describe, expect, it } from 'vitest';
import type { Stage } from '@shared/types';
import {
  DEFAULT_BODIES,
  KNOWN_STAGE_OPS,
  addStage,
  duplicateStage,
  isWriteStage,
  moveStage,
  nextStageId,
  removeStage,
  setBody,
  setOp,
  stageSig,
  stageSummary,
  toggleEnabled,
  validatePipeline,
  validateStageBody,
} from '../../src/pages/Workspace/Aggregation/pipeline';
import { OPERATORS } from '../../src/features/fieldSuggestions/operators';

const NAMED_COMMON_STAGES = [
  '$facet', '$bucket', '$sample', '$graphLookup',
  '$unionWith', '$setWindowFields', '$geoNear', '$documents',
] as const;

const emptyState = { stages: [] as Stage[], activeStageId: null };

describe('pipeline ops', () => {
  it('addStage appends with unique id and activates it', () => {
    const s1 = addStage(emptyState, '$match');
    const s2 = addStage(s1, '$group');
    expect(s2.stages).toHaveLength(2);
    expect(new Set(s2.stages.map((s) => s.id)).size).toBe(2);
    expect(s2.activeStageId).toBe(s2.stages[1]!.id);
  });

  it('addStage positions by afterIndex', () => {
    const s1 = addStage(emptyState, '$match');
    const s2 = addStage(s1, '$sort');
    const s3 = addStage(s2, '$limit', 0);
    expect(s3.stages.map((s) => s.op)).toEqual(['$match', '$limit', '$sort']);
  });

  it('removeStage drops by id and clears active if matching', () => {
    const s1 = addStage(emptyState, '$match');
    const id = s1.stages[0]!.id;
    const s2 = removeStage(s1, id);
    expect(s2.stages).toHaveLength(0);
    expect(s2.activeStageId).toBeNull();
  });

  it('moveStage reorders', () => {
    let s = addStage(emptyState, '$match');
    s = addStage(s, '$sort');
    s = addStage(s, '$limit');
    const r = moveStage(s, 0, 2);
    expect(r.stages.map((x) => x.op)).toEqual(['$sort', '$limit', '$match']);
  });

  it('moveStage returns same state when out of bounds', () => {
    const s1 = addStage(emptyState, '$match');
    expect(moveStage(s1, 0, 5)).toEqual(s1);
    expect(moveStage(s1, -1, 0)).toEqual(s1);
  });

  it('setBody updates only the target stage', () => {
    const s = addStage(emptyState, '$match');
    const id = s.stages[0]!.id;
    const r = setBody(s, id, '{"posted":true}');
    expect(r.stages[0]!.body).toBe('{"posted":true}');
  });

  it('toggleEnabled flips enabled', () => {
    const s = addStage(emptyState, '$match');
    const id = s.stages[0]!.id;
    const r = toggleEnabled(s, id);
    expect(r.stages[0]!.enabled).toBe(false);
    expect(toggleEnabled(r, id).stages[0]!.enabled).toBe(true);
  });

  it('duplicateStage inserts a copy with a new id right after', () => {
    const s = addStage(emptyState, '$match');
    const id = s.stages[0]!.id;
    const r = duplicateStage(s, id);
    expect(r.stages).toHaveLength(2);
    expect(r.stages[0]!.id).toBe(id);
    expect(r.stages[1]!.id).not.toBe(id);
    expect(r.stages[1]!.op).toBe('$match');
    expect(r.activeStageId).toBe(r.stages[1]!.id);
  });

  it('nextStageId is strictly increasing', () => {
    const s = addStage(emptyState, '$match');
    expect(nextStageId(s.stages)).toBe(s.stages[0]!.id + 1);
  });

  it('isWriteStage detects $out and $merge only', () => {
    expect(isWriteStage('$out')).toBe(true);
    expect(isWriteStage('$merge')).toBe(true);
    expect(isWriteStage('$match')).toBe(false);
  });
});

describe('setOp (T2.1)', () => {
  it('preserves a user-edited body when changing op', () => {
    const s = addStage(emptyState, '$match');
    const id = s.stages[0]!.id;
    const edited = setBody(s, id, '{ "custom": true }');
    const r = setOp(edited, id, '$group');
    expect(r.stages[0]!.op).toBe('$group');
    expect(r.stages[0]!.body).toBe('{ "custom": true }');
  });

  it('swaps body to the new default when the prior body was empty', () => {
    const s = addStage(emptyState, '$match');
    const id = s.stages[0]!.id;
    const emptied = setBody(s, id, '   ');
    const r = setOp(emptied, id, '$sort');
    expect(r.stages[0]!.op).toBe('$sort');
    expect(r.stages[0]!.body).toBe(DEFAULT_BODIES['$sort']);
  });

  it('swaps body to the new default when the prior body equalled the prior op default', () => {
    const s = addStage(emptyState, '$match'); // body === DEFAULT_BODIES['$match']
    const id = s.stages[0]!.id;
    const r = setOp(s, id, '$sort');
    expect(r.stages[0]!.op).toBe('$sort');
    expect(r.stages[0]!.body).toBe(DEFAULT_BODIES['$sort']);
  });

  it('supports a custom string op', () => {
    const s = addStage(emptyState, '$match');
    const id = s.stages[0]!.id;
    const r = setOp(s, id, '$myCustomStage');
    expect(r.stages[0]!.op).toBe('$myCustomStage');
  });

  it('is a no-op when the id is missing (stage identity preserved)', () => {
    const s = addStage(emptyState, '$match');
    const r = setOp(s, 999999, '$sort');
    expect(r).toEqual(s);
  });
});

describe('expanded curated stage set (T2.1)', () => {
  it('KNOWN_STAGE_OPS includes all 8 named common stages', () => {
    for (const op of NAMED_COMMON_STAGES) {
      expect(KNOWN_STAGE_OPS).toContain(op);
    }
  });

  it('every named common stage has a DEFAULT_BODIES entry', () => {
    for (const op of NAMED_COMMON_STAGES) {
      expect(DEFAULT_BODIES[op]).toBeTruthy();
    }
  });
});

describe('stageSig (T2.1 — AC6)', () => {
  it('differs when op differs with body constant', () => {
    const a: Stage = { id: 1, op: '$match', body: '{}', enabled: true };
    const b: Stage = { id: 1, op: '$sort', body: '{}', enabled: true };
    expect(stageSig(a)).not.toBe(stageSig(b));
  });

  it('differs when body differs with op constant', () => {
    const a: Stage = { id: 1, op: '$match', body: '{}', enabled: true };
    const b: Stage = { id: 1, op: '$match', body: '{ "x": 1 }', enabled: true };
    expect(stageSig(a)).not.toBe(stageSig(b));
  });

  it('is stable for identical op+body', () => {
    const a: Stage = { id: 1, op: '$match', body: '{}', enabled: true };
    const b: Stage = { id: 2, op: '$match', body: '{}', enabled: true };
    expect(stageSig(a)).toBe(stageSig(b));
  });
});

describe('validatePipeline', () => {
  it('fails when no enabled stages', () => {
    const v = validatePipeline([]);
    expect(v.ok).toBe(false);
  });

  it('accepts valid EJSON bodies', () => {
    const stages: Stage[] = [
      { id: 1, op: '$match', body: '{}', enabled: true },
      { id: 2, op: '$limit', body: '10', enabled: true },
    ];
    expect(validatePipeline(stages).ok).toBe(true);
  });

  it('rejects invalid EJSON', () => {
    const stages: Stage[] = [
      { id: 1, op: '$match', body: '{ bogus ', enabled: true },
    ];
    const v = validatePipeline(stages);
    expect(v.ok).toBe(false);
    expect(v.errors[0]!.id).toBe(1);
  });

  it('warns on unknown op without blocking', () => {
    const stages: Stage[] = [
      { id: 1, op: '$fakeOp', body: '{}', enabled: true },
    ];
    const v = validatePipeline(stages);
    expect(v.ok).toBe(true);
    expect(v.warnings[0]!.id).toBe(1);
  });
});

/**
 * X14 §4 (T4) — this pays off the app's disagreement with
 * itself: the templates the app writes and the help the stage picker shows are
 * written in the dialect its own validator used to refuse.
 */
describe('validateStageBody — Shell Syntax (X14 §4)', () => {
  const body = (op: string, text: string): Stage => ({ id: 1, op, body: text, enabled: true });

  it('accepts the shipped $group template, unedited', () => {
    // The exact string `addStage('$group')` writes into a new stage.
    expect(DEFAULT_BODIES['$group']).toBe('{\n  _id: "$field",\n  count: { $sum: 1 }\n}');
    expect(validateStageBody(body('$group', DEFAULT_BODIES['$group']!))).toBeNull();
  });

  it.each(Object.keys(DEFAULT_BODIES))('accepts the shipped %s template, unedited', (op) => {
    expect(validateStageBody(body(op, DEFAULT_BODIES[op]!))).toBeNull();
  });

  // The stage picker renders `OperatorDocPanel`, whose `example` block is the
  // built-in help. Every one of them must validate as written.
  const stagePickerExamples = OPERATORS.filter(
    (op) => (KNOWN_STAGE_OPS as readonly string[]).includes(op.name) && op.example,
  ).map((op) => [op.name, op.example!] as const);

  it('the stage picker shows help for every known stage op', () => {
    expect(new Set(stagePickerExamples.map(([name]) => name)).size).toBe(KNOWN_STAGE_OPS.length);
  });

  it.each(stagePickerExamples)('accepts the %s stage-picker help example', (op, example) => {
    expect(validateStageBody(body(op, example))).toBeNull();
  });

  // `$count`, `$unwind`, `$limit`, `$skip`, `$unset`, `$redact` and `$out` take
  // a primitive body and are judged by their own branch. No shipped template
  // exercises it — every primitive default is already strict JSON — so these
  // hand-written cases are the only cover that branch has.
  it('accepts a single-quoted $count body (the primitive-body branch)', () => {
    expect(validateStageBody(body('$count', "'totalCount'"))).toBeNull();
  });

  it('accepts a single-quoted $unwind body (the primitive-body branch)', () => {
    expect(validateStageBody(body('$unwind', "'$arrayField'"))).toBeNull();
  });

  it('accepts a mongosh ObjectId in a $match body', () => {
    expect(
      validateStageBody(body('$match', '{ _id: ObjectId("507f1f77bcf86cd799439011") }')),
    ).toBeNull();
  });

  // X14 §5 — still refused, and now the refusal says why and where.
  // The reason is the transform's own, verbatim; only the `Line L, column C`
  // prefix is added here. An earlier fix stripped acorn's own trailing `(1:7)` from the
  // reason, so this message carries one position rather than two disagreeing
  // by one — asserted whole, because a `toContain` would not have caught the
  // second one.
  it('still refuses text no repair can rescue, and reports the transform reason', () => {
    expect(validateStageBody(body('$match', '{ bogus '))).toBe(
      'Line 1, column 8: Unexpected token',
    );
    expect(validateStageBody(body('$match', '{ name: /^acme/gi }'))).toBe(
      'Line 1, column 9: The regular expression flag "g" (global) has no MongoDB equivalent. Remove it.',
    );
    expect(validateStageBody(body('$match', '{ a: b }'))).toContain('"b" is a bare word');
    expect(validateStageBody(body('$count', "'a' + 'b'"))).toContain(
      'arithmetic or comparison expression',
    );
    expect(validateStageBody(body('$match', '   '))).toBe('body is empty');
  });

  // A stage body is multi-line and hand-indented, which is the whole reason
  // §5 asks for a location: a typo forty lines down is not findable by eye.
  it('locates the refusal by line and column inside a multi-line body', () => {
    const multiline = '{\n  "a": 1,\n  "b": { c }\n}';
    expect(validateStageBody(body('$match', multiline))).toMatch(/^Line 3, column 10: /);
  });

  // The repair runs in front of the EJSON check, never instead of it: a body
  // that is well-formed JSON but not well-formed BSON comes back `unchanged`
  // from the transform and must still be refused.
  //
  // These two must NOT move with the block above. "the transform could
  // not read this" and "this is well-formed JSON but not well-formed BSON" are
  // different faults with different fixes; if both sets changed together, a
  // shared message had collapsed them.
  it('still refuses a malformed sentinel that parses as JSON', () => {
    expect(validateStageBody(body('$match', '{ "_id": { "$oid": "nothex" } }'))).toBe('invalid EJSON');
    expect(validateStageBody(body('$match', '{ _id: { $oid: "nothex" } }'))).toBe('invalid EJSON');
  });
});

describe('stageSummary', () => {
  it('summarizes $match by first key', () => {
    expect(
      stageSummary({ id: 1, op: '$match', body: '{ "posted": true, "a": 1 }', enabled: true }),
    ).toContain('posted');
  });

  it('counts $group metrics', () => {
    const summary = stageSummary({
      id: 1,
      op: '$group',
      body: '{ "_id": "$x", "count": { "$sum": 1 } }',
      enabled: true,
    });
    expect(summary).toContain('metrics: 1');
  });
});
