import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { FamilyApplyChoice } from '@shared/types';
import { ruleKey, rowSummaryKey } from '../../electron/services/effectiveRules';
import {
  decideApply,
  planApply,
  type ApplyDecision,
  type ApplyItems,
} from '../../electron/services/familyApplyPlan';
import type { FamilyExportRowSummary, FamilyExportRule } from '../../electron/services/familyExportFormat';

const name = fc.constantFrom('a', 'b', 'a,b', 'a|b', 'é', '__proto__');

const ruleArb = fc
  .record({
    sourceDb: fc.constantFrom('shop', 'crm'),
    sourceCollection: name,
    sourceField: name,
    targetDb: fc.constantFrom('shop', 'crm'),
    targetCollection: name,
    targetField: fc.constantFrom('_id', 'id'),
    projection: fc.array(fc.constantFrom('n', 'e'), { maxLength: 2 }),
    displayTemplate: fc.option(fc.constantFrom('{n}', ''), { nil: undefined }),
    enabled: fc.boolean(),
  })
  .map((r): FamilyExportRule => r);
const summaryArb = fc
  .record({
    dbName: fc.constantFrom('shop', 'crm'),
    collection: name,
    fields: fc.uniqueArray(fc.constantFrom('n', 'e', 'f'), { minLength: 1, maxLength: 3 }),
  })
  .map((s): FamilyExportRowSummary => s);

const dedupe = <T>(rows: T[], key: (r: T) => string): T[] => [...new Map(rows.map((r) => [key(r), r])).values()];
const items = fc.record({
  rules: fc.array(ruleArb, { maxLength: 7 }).map((rs) => dedupe(rs, ruleKey)),
  rowSummaries: fc.array(summaryArb, { maxLength: 7 }).map((ss) => dedupe(ss, rowSummaryKey)),
});

/** The target once a decision is applied: what the database ends up holding. */
function after(target: ApplyItems, d: ApplyDecision): ApplyItems {
  const rules = new Map(target.rules.map((r) => [ruleKey(r), r]));
  for (const r of [...d.addRules, ...d.replaceRules]) rules.set(ruleKey(r), r);
  const sums = new Map(target.rowSummaries.map((s) => [rowSummaryKey(s), s]));
  for (const s of [...d.addRowSummaries, ...d.replaceRowSummaries]) sums.set(rowSummaryKey(s), s);
  return { rules: [...rules.values()], rowSummaries: [...sums.values()] };
}

const resolve = (file: ApplyItems, target: ApplyItems, pick: (i: number) => FamilyApplyChoice) =>
  new Map(planApply(file, target).conflicts.map((c, i): [string, FamilyApplyChoice] => [c.key, pick(i)]));

describe('Family Export apply', () => {
  it('with every conflict taken, the target holds every item of the file', () => {
    fc.assert(
      fc.property(items, items, (file, target) => {
        const result = after(target, decideApply(file, target, resolve(file, target, () => 'take')));
        const rules = new Map(result.rules.map((r) => [ruleKey(r), r]));
        for (const r of file.rules) expect(rules.get(ruleKey(r))).toEqual(r);
        const sums = new Map(result.rowSummaries.map((s) => [rowSummaryKey(s), s]));
        for (const s of file.rowSummaries) expect(sums.get(rowSummaryKey(s))).toEqual(s);
      }),
    );
  });

  it('deletes nothing from the target, whatever is chosen', () => {
    fc.assert(
      fc.property(items, items, fc.array(fc.boolean(), { maxLength: 16 }), (file, target, picks) => {
        const result = after(
          target,
          decideApply(file, target, resolve(file, target, (i) => (picks[i % Math.max(picks.length, 1)] ? 'take' : 'keep'))),
        );
        const ruleKeys = new Set(result.rules.map(ruleKey));
        for (const r of target.rules) expect(ruleKeys.has(ruleKey(r))).toBe(true);
        const sumKeys = new Set(result.rowSummaries.map(rowSummaryKey));
        for (const s of target.rowSummaries) expect(sumKeys.has(rowSummaryKey(s))).toBe(true);
      }),
    );
  });

  it('with every conflict kept, a target item that conflicts is left as it was', () => {
    fc.assert(
      fc.property(items, items, (file, target) => {
        const result = after(target, decideApply(file, target, resolve(file, target, () => 'keep')));
        const rules = new Map(result.rules.map((r) => [ruleKey(r), r]));
        for (const r of target.rules) expect(rules.get(ruleKey(r))).toEqual(r);
      }),
    );
  });

  it('a second apply of the same file finds everything unchanged', () => {
    fc.assert(
      fc.property(items, items, fc.array(fc.boolean(), { maxLength: 16 }), (file, target, picks) => {
        const first = after(
          target,
          decideApply(file, target, resolve(file, target, (i) => (picks[i % Math.max(picks.length, 1)] ? 'take' : 'keep'))),
        );
        // Only items the first apply kept can still differ; with all taken nothing does.
        const all = after(target, decideApply(file, target, resolve(file, target, () => 'take')));
        const plan = planApply(file, all);
        expect(plan.added).toEqual([]);
        expect(plan.conflicts).toEqual([]);
        expect(plan.unchanged).toHaveLength(file.rules.length + file.rowSummaries.length);
        // And the first (mixed) apply never leaves an item the file lacks.
        expect(planApply(file, first).added).toEqual([]);
      }),
    );
  });

  it('counts add up to the file: added + replaced + kept + unchanged', () => {
    fc.assert(
      fc.property(items, items, fc.array(fc.boolean(), { maxLength: 16 }), (file, target, picks) => {
        const d = decideApply(
          file,
          target,
          resolve(file, target, (i) => (picks[i % Math.max(picks.length, 1)] ? 'take' : 'keep')),
        );
        expect(d.added + d.replaced + d.kept + d.unchanged).toBe(file.rules.length + file.rowSummaries.length);
        const plan = planApply(file, target);
        expect(plan.added.length).toBe(d.added);
        expect(plan.unchanged.length).toBe(d.unchanged);
        expect(plan.conflicts.length).toBe(d.replaced + d.kept);
      }),
    );
  });

  it('item keys of a plan are unique across rules and Row Summaries', () => {
    fc.assert(
      fc.property(items, items, (file, target) => {
        const plan = planApply(file, target);
        const keys = [...plan.added, ...plan.unchanged, ...plan.conflicts].map((i) => i.key);
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys.length).toBe(file.rules.length + file.rowSummaries.length);
      }),
    );
  });
});
