import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { ReferenceRule, RowSummary } from '@shared/types';
import { ruleKey, rowSummaryKey } from '../../electron/services/effectiveRules';
import { parseFamilyExport, writeFamilyExport } from '../../electron/services/familyExportFormat';

// A small pool so keys collide often (the generators deduplicate), including
// names that hold the separators a naive key would join on.
const name = fc.constantFrom('shop', 'crm', 'a,b', 'a|b', 'é', 'x.y', 'orders', '__proto__', 'constructor');
const path = fc.constantFrom('name', 'email', 'a.b', 'status', 'total', 'é');

const ruleArb = fc
  .record({
    sourceDb: name,
    sourceCollection: name,
    sourceField: name,
    targetDb: name,
    targetCollection: name,
    targetField: fc.constantFrom('_id', 'id', 'code'),
    // The rule service never stores a repeated path, so neither does a real rule.
    projection: fc.uniqueArray(path, { maxLength: 4 }),
    // The rule service stores a blank template as none, so a real rule never has one.
    displayTemplate: fc.option(fc.constantFrom('{name}', '{a} {b}'), { nil: undefined }),
    enabled: fc.boolean(),
  })
  .map((r): ReferenceRule => ({ ...r, id: 'i', owner: { familyId: 'f' }, createdAt: 'c', updatedAt: 'u' }));

const summaryArb = fc
  .record({
    dbName: name,
    collection: name,
    fields: fc.uniqueArray(path, { minLength: 1, maxLength: 4 }),
  })
  .map((s): RowSummary => ({ ...s, id: 'i', owner: { familyId: 'f' }, updatedAt: 'u' }));

const dedupe = <T>(rows: T[], key: (r: T) => string): T[] => [...new Map(rows.map((r) => [key(r), r])).values()];

describe('Family Export round trip', () => {
  it('parse(write(family)) recovers every shared setting', () => {
    fc.assert(
      fc.property(
        fc.array(ruleArb, { maxLength: 8 }).map((rs) => dedupe(rs, ruleKey)),
        fc.array(summaryArb, { maxLength: 8 }).map((ss) => dedupe(ss, rowSummaryKey)),
        fc.constantFrom('Acme', 'Client deployments', 'é', 'a b'),
        (rules, rowSummaries, familyName) => {
          const file = parseFamilyExport(
            writeFamilyExport({ familyName, settings: { rules, rowSummaries }, now: new Date(0) }),
          );
          expect(file.familyName).toBe(familyName);
          const byKey = new Map(file.referenceRules.map((r) => [ruleKey(r), r]));
          expect(byKey.size).toBe(rules.length);
          for (const r of rules) {
            const got = byKey.get(ruleKey(r))!;
            expect(got).toEqual({
              sourceDb: r.sourceDb,
              sourceCollection: r.sourceCollection,
              sourceField: r.sourceField,
              targetDb: r.targetDb,
              targetCollection: r.targetCollection,
              targetField: r.targetField,
              projection: r.projection,
              ...(r.displayTemplate === undefined ? {} : { displayTemplate: r.displayTemplate }),
              enabled: r.enabled,
            });
          }
          const sums = new Map(file.rowSummaries.map((s) => [rowSummaryKey(s), s]));
          expect(sums.size).toBe(rowSummaries.length);
          for (const s of rowSummaries) {
            expect(sums.get(rowSummaryKey(s))).toEqual({ dbName: s.dbName, collection: s.collection, fields: s.fields });
          }
        },
      ),
    );
  });
});
