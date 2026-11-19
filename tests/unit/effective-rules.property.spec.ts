import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { ReferenceRule } from '@shared/types';
import { effectiveRules, ruleKey } from '../../electron/services/effectiveRules';

// Names drawn from a tiny pool so the two owners collide often, with one that
// holds the separators a naive key would join on.
const name = fc.constantFrom('a', 'b', 'a,b', 'a|b', '', 'é', 'x.y');

const ruleOf = (owner: ReferenceRule['owner'], prefix: string) =>
  fc
    .record({
      sourceDb: name,
      sourceCollection: name,
      sourceField: name,
      enabled: fc.boolean(),
    })
    .map(
      (r): ReferenceRule => ({
        ...r,
        id: `${prefix}-${JSON.stringify([r.sourceDb, r.sourceCollection, r.sourceField])}`,
        owner,
        targetDb: 't',
        targetCollection: 't',
        targetField: '_id',
        projection: [],
        createdAt: 't',
        updatedAt: 't',
      }),
    );

// One owner never holds two rules for a key (the table forbids it), so the
// generated sets are deduplicated by key.
const dedupe = (rows: ReferenceRule[]): ReferenceRule[] =>
  [...new Map(rows.map((r) => [ruleKey(r), r])).values()];

const own = fc.array(ruleOf({ connectionId: 'c' }, 'own'), { maxLength: 8 }).map(dedupe);
const fam = fc.array(ruleOf({ familyId: 'f' }, 'fam'), { maxLength: 8 }).map(dedupe);

describe('effectiveRules property', () => {
  it('lists every (db, collection, field) key at most once', () => {
    fc.assert(
      fc.property(own, fam, (o, f) => {
        const keys = effectiveRules(o, f).map(ruleKey);
        expect(new Set(keys).size).toBe(keys.length);
      }),
    );
  });

  it('covers exactly the union of both owners keys', () => {
    fc.assert(
      fc.property(own, fam, (o, f) => {
        const got = new Set(effectiveRules(o, f).map(ruleKey));
        const want = new Set([...o, ...f].map(ruleKey));
        expect(got).toEqual(want);
      }),
    );
  });

  it('always keeps the Connection row on a shared key, and tags origin by where the key lives', () => {
    fc.assert(
      fc.property(own, fam, (o, f) => {
        const ownKeys = new Set(o.map(ruleKey));
        const famById = new Map(f.map((r) => [ruleKey(r), r.id]));
        for (const r of effectiveRules(o, f)) {
          const key = ruleKey(r);
          if ('connectionId' in r.owner) {
            expect(r.origin).toBe(famById.has(key) ? 'override' : 'local');
            expect(r.sharedRuleId).toBe(famById.get(key));
          } else {
            expect(ownKeys.has(key)).toBe(false);
            expect(r.origin).toBe('shared');
            expect(r.sharedRuleId).toBeUndefined();
          }
        }
      }),
    );
  });

  it('is sorted by database, collection and field', () => {
    fc.assert(
      fc.property(own, fam, (o, f) => {
        const out = effectiveRules(o, f);
        for (let i = 1; i < out.length; i++) {
          const a = out[i - 1];
          const b = out[i];
          const cmp =
            a.sourceDb.localeCompare(b.sourceDb) ||
            a.sourceCollection.localeCompare(b.sourceCollection) ||
            a.sourceField.localeCompare(b.sourceField);
          expect(cmp).toBeLessThanOrEqual(0);
        }
      }),
    );
  });
});
