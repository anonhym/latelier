import { describe, it, expect } from 'vitest';
import type { FamilyApplyChoice } from '@shared/types';
import {
  decideApply,
  describeRule,
  describeSummary,
  planApply,
  ruleItemKey,
  sameRule,
  sameSummary,
  summaryItemKey,
} from '../../electron/services/familyApplyPlan';
import type { FamilyExportRowSummary, FamilyExportRule } from '../../electron/services/familyExportFormat';

const rule = (over: Partial<FamilyExportRule> = {}): FamilyExportRule => ({
  sourceDb: 'shop',
  sourceCollection: 'orders',
  sourceField: 'customerId',
  targetDb: 'shop',
  targetCollection: 'customers',
  targetField: '_id',
  projection: ['name'],
  enabled: true,
  ...over,
});
const summary = (over: Partial<FamilyExportRowSummary> = {}): FamilyExportRowSummary => ({
  dbName: 'shop',
  collection: 'orders',
  fields: ['status'],
  ...over,
});
const none = { rules: [], rowSummaries: [] };
const choices = (entries: [string, FamilyApplyChoice][]) => new Map(entries);

describe('item keys', () => {
  it('keeps a rule and a Row Summary of the same namespace apart', () => {
    expect(ruleItemKey(rule())).not.toBe(summaryItemKey(summary()));
    expect(ruleItemKey(rule())).toMatch(/^rule:/);
    expect(summaryItemKey(summary())).toMatch(/^summary:/);
  });
  it('is keyed by the natural key only', () => {
    expect(ruleItemKey(rule({ targetCollection: 'other' }))).toBe(ruleItemKey(rule()));
    expect(ruleItemKey(rule({ sourceField: 'x' }))).not.toBe(ruleItemKey(rule()));
    expect(summaryItemKey(summary({ fields: ['q'] }))).toBe(summaryItemKey(summary()));
  });
});

describe('describe', () => {
  it('words a rule by its target, projection, template and state', () => {
    const d = describeRule(rule({ displayTemplate: '{name}', enabled: false }));
    expect(d).toEqual({
      key: ruleItemKey(rule()),
      kind: 'rule',
      dbName: 'shop',
      collection: 'orders',
      field: 'customerId',
      detail: 'shop.customers._id [name] as {name} (off)',
    });
  });
  it('joins projection fields with a comma and a space', () => {
    expect(describeRule(rule({ projection: ['a', 'b'] })).detail).toBe('shop.customers._id [a, b]');
  });
  it('leaves out an empty projection, no template and an enabled flag', () => {
    expect(describeRule(rule({ projection: [] })).detail).toBe('shop.customers._id');
  });
  it('words a Row Summary by its fields', () => {
    expect(describeSummary(summary({ fields: ['a', 'b'] }))).toEqual({
      key: summaryItemKey(summary()),
      kind: 'rowSummary',
      dbName: 'shop',
      collection: 'orders',
      detail: 'a, b',
    });
  });
});

describe('sameRule / sameSummary', () => {
  it('is true for identical settings', () => {
    expect(sameRule(rule(), rule())).toBe(true);
    expect(sameSummary(summary(), summary())).toBe(true);
  });
  it.each([
    ['targetDb', { targetDb: 'x' }],
    ['targetCollection', { targetCollection: 'x' }],
    ['targetField', { targetField: 'x' }],
    ['projection content', { projection: ['other'] }],
    ['projection length', { projection: ['name', 'email'] }],
    ['displayTemplate', { displayTemplate: 'x' }],
    ['enabled', { enabled: false }],
  ])('sees a difference in %s', (_n, over) => {
    expect(sameRule(rule(), rule(over as Partial<FamilyExportRule>))).toBe(false);
  });
  it('sees projection order', () => {
    expect(sameRule(rule({ projection: ['a', 'b'] }), rule({ projection: ['b', 'a'] }))).toBe(false);
  });
  it('sees a Row Summary difference in content, order and length', () => {
    expect(sameSummary(summary({ fields: ['a', 'b'] }), summary({ fields: ['b', 'a'] }))).toBe(false);
    expect(sameSummary(summary({ fields: ['a'] }), summary({ fields: ['a', 'b'] }))).toBe(false);
  });
});

describe('planApply', () => {
  it('adds everything to an empty target', () => {
    const plan = planApply({ rules: [rule()], rowSummaries: [summary()] }, none);
    expect(plan.added.map((i) => i.kind).sort()).toEqual(['rowSummary', 'rule']);
    expect(plan.unchanged).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  it('classifies added, unchanged and conflicting items of both kinds', () => {
    const file = {
      rules: [rule({ sourceField: 'new' }), rule({ sourceField: 'same' }), rule({ sourceField: 'diff', targetCollection: 'incoming' })],
      rowSummaries: [summary({ collection: 'new' }), summary({ collection: 'same' }), summary({ collection: 'diff', fields: ['in'] })],
    };
    const target = {
      rules: [rule({ sourceField: 'same' }), rule({ sourceField: 'diff', targetCollection: 'current' }), rule({ sourceField: 'only-here' })],
      rowSummaries: [summary({ collection: 'same' }), summary({ collection: 'diff', fields: ['cur'] }), summary({ collection: 'only-here' })],
    };
    const plan = planApply(file, target);
    expect(plan.added.map((i) => i.key)).toEqual([ruleItemKey(rule({ sourceField: 'new' })), summaryItemKey(summary({ collection: 'new' }))].sort((a, b) => a.localeCompare(b)));
    expect(plan.unchanged).toHaveLength(2);
    expect(plan.conflicts.map((c) => c.key)).toEqual(
      [ruleItemKey(rule({ sourceField: 'diff' })), summaryItemKey(summary({ collection: 'diff' }))].sort((a, b) => a.localeCompare(b)),
    );
    const ruleConflict = plan.conflicts.find((c) => c.key.startsWith('rule:'))!;
    expect(ruleConflict.current.detail).toContain('current');
    expect(ruleConflict.incoming.detail).toContain('incoming');
    const summaryConflict = plan.conflicts.find((c) => c.key.startsWith('summary:'))!;
    expect(summaryConflict.current.detail).toBe('cur');
    expect(summaryConflict.incoming.detail).toBe('in');
  });

  it('lists every group in key order whatever order the file and target came in', () => {
    const fields = ['z', 'a', 'm'];
    const file = {
      rules: fields.map((f) => rule({ sourceField: f })),
      rowSummaries: fields.map((c) => summary({ collection: c })),
    };
    const sorted = (keys: string[]) => [...keys].sort((a, b) => a.localeCompare(b));
    const added = planApply(file, none).added.map((i) => i.key);
    expect(added).toEqual(sorted(added));
    const unchanged = planApply(file, file).unchanged.map((i) => i.key);
    expect(unchanged).toEqual(sorted(unchanged));
    const changed = {
      rules: fields.map((f) => rule({ sourceField: f, targetCollection: 'other' })),
      rowSummaries: fields.map((c) => summary({ collection: c, fields: ['q'] })),
    };
    const conflicts = planApply(file, changed).conflicts.map((c) => c.key);
    expect(conflicts).toHaveLength(6);
    expect(conflicts).toEqual(sorted(conflicts));
  });

  it('is an all-unchanged plan for a target that already holds the file', () => {
    const items = { rules: [rule()], rowSummaries: [summary()] };
    const plan = planApply(items, items);
    expect(plan.added).toEqual([]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.unchanged).toHaveLength(2);
  });
});

describe('decideApply', () => {
  const file = {
    rules: [rule({ sourceField: 'new' }), rule({ sourceField: 'same' }), rule({ sourceField: 'diff', targetCollection: 'incoming' })],
    rowSummaries: [summary({ collection: 'new' }), summary({ collection: 'same' }), summary({ collection: 'diff', fields: ['in'] })],
  };
  const target = {
    rules: [rule({ sourceField: 'same' }), rule({ sourceField: 'diff', targetCollection: 'current' })],
    rowSummaries: [summary({ collection: 'same' }), summary({ collection: 'diff', fields: ['cur'] })],
  };
  const ruleDiff = ruleItemKey(rule({ sourceField: 'diff' }));
  const summaryDiff = summaryItemKey(summary({ collection: 'diff' }));

  it('adds new items, counts identical ones and keeps on keep', () => {
    const d = decideApply(file, target, choices([[ruleDiff, 'keep'], [summaryDiff, 'keep']]));
    expect(d.addRules.map((r) => r.sourceField)).toEqual(['new']);
    expect(d.addRowSummaries.map((s) => s.collection)).toEqual(['new']);
    expect(d.replaceRules).toEqual([]);
    expect(d.replaceRowSummaries).toEqual([]);
    expect({ added: d.added, replaced: d.replaced, kept: d.kept, unchanged: d.unchanged }).toEqual({
      added: 2,
      replaced: 0,
      kept: 2,
      unchanged: 2,
    });
  });

  it('replaces only what is taken, per kind', () => {
    const d = decideApply(file, target, choices([[ruleDiff, 'take'], [summaryDiff, 'keep']]));
    expect(d.replaceRules.map((r) => r.targetCollection)).toEqual(['incoming']);
    expect(d.replaceRowSummaries).toEqual([]);
    expect({ replaced: d.replaced, kept: d.kept }).toEqual({ replaced: 1, kept: 1 });
    const e = decideApply(file, target, choices([[ruleDiff, 'keep'], [summaryDiff, 'take']]));
    expect(e.replaceRules).toEqual([]);
    expect(e.replaceRowSummaries.map((s) => s.fields)).toEqual([['in']]);
  });

  it('throws on a conflict with no choice rather than guessing', () => {
    expect(() => decideApply(file, target, choices([[ruleDiff, 'take']]))).toThrow(
      `no choice was given for the conflict ${summaryDiff}`,
    );
    expect(() => decideApply(file, target, choices([[summaryDiff, 'take']]))).toThrow(
      `no choice was given for the conflict ${ruleDiff}`,
    );
  });

  it('needs no choices when nothing conflicts', () => {
    expect(decideApply(file, none, new Map()).added).toBe(6);
  });

  it('ignores a choice for a key that is not a conflict', () => {
    const d = decideApply({ rules: [rule()], rowSummaries: [] }, none, choices([['rule:other', 'take']]));
    expect(d.added).toBe(1);
  });
});
