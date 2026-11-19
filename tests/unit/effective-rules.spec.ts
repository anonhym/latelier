import { describe, it, expect } from 'vitest';
import type { ReferenceRule, RowSummary } from '@shared/types';
import {
  effectiveRowSummary,
  effectiveRules,
  rowSummaryKey,
  ruleKey,
} from '../../electron/services/effectiveRules';

const CONN = { connectionId: 'c1' };
const FAM = { familyId: 'f1' };

function rule(over: Partial<ReferenceRule> & { id: string }): ReferenceRule {
  return {
    owner: CONN,
    sourceDb: 'shop',
    sourceCollection: 'orders',
    sourceField: 'customer_id',
    targetDb: 'shop',
    targetCollection: 'customers',
    targetField: '_id',
    projection: [],
    enabled: true,
    createdAt: 't',
    updatedAt: 't',
    ...over,
  };
}

const own = (over: Partial<ReferenceRule> & { id: string }) => rule({ owner: CONN, ...over });
const shared = (over: Partial<ReferenceRule> & { id: string }) => rule({ owner: FAM, ...over });

describe('effectiveRules', () => {
  it('returns nothing when neither owner has a rule', () => {
    expect(effectiveRules([], [])).toEqual([]);
  });

  it('marks a Connection rule with no shared counterpart local', () => {
    const r = own({ id: 'a' });
    expect(effectiveRules([r], [])).toEqual([{ ...r, origin: 'local' }]);
  });

  it('marks a Family rule nothing replaces shared', () => {
    const r = shared({ id: 'a' });
    expect(effectiveRules([], [r])).toEqual([{ ...r, origin: 'shared' }]);
  });

  it('lets a Connection rule with the same key replace the shared one and name it', () => {
    const s = shared({ id: 's', targetCollection: 'customers' });
    const o = own({ id: 'o', targetCollection: 'clients' });
    const out = effectiveRules([o], [s]);
    expect(out).toEqual([{ ...o, origin: 'override', sharedRuleId: 's' }]);
  });

  it('keeps a disabled Override in the set so the shared rule stays hidden there', () => {
    const s = shared({ id: 's' });
    const o = own({ id: 'o', enabled: false });
    const out = effectiveRules([o], [s]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'o', origin: 'override', enabled: false });
  });

  it('matches on database, collection and field together, not on the field alone', () => {
    const s = shared({ id: 's', sourceCollection: 'invoices' });
    const o = own({ id: 'o', sourceCollection: 'orders' });
    const out = effectiveRules([o], [s]);
    expect(out.map((r) => [r.id, r.origin])).toEqual([
      ['s', 'shared'],
      ['o', 'local'],
    ]);
    const other = effectiveRules([own({ id: 'o', sourceDb: 'a' })], [shared({ id: 's', sourceDb: 'b' })]);
    expect(other.map((r) => r.origin).sort((x, y) => x.localeCompare(y))).toEqual(['local', 'shared']);
    const field = effectiveRules([own({ id: 'o', sourceField: 'x' })], [shared({ id: 's', sourceField: 'y' })]);
    expect(field.map((r) => r.origin).sort((x, y) => x.localeCompare(y))).toEqual(['local', 'shared']);
  });

  it('keeps a shared rule for a database the member does not have, without complaint', () => {
    const s = shared({ id: 's', sourceDb: 'only_elsewhere' });
    const out = effectiveRules([own({ id: 'o', sourceDb: 'shop' })], [s]);
    expect(out.map((r) => [r.id, r.origin])).toEqual([
      ['s', 'shared'],
      ['o', 'local'],
    ]);
  });

  it('sorts by database, collection and field with localeCompare', () => {
    const rows = [
      own({ id: '1', sourceDb: 'b', sourceCollection: 'a', sourceField: 'a' }),
      own({ id: '2', sourceDb: 'a', sourceCollection: 'b', sourceField: 'a' }),
      own({ id: '3', sourceDb: 'a', sourceCollection: 'a', sourceField: 'b' }),
      own({ id: '4', sourceDb: 'a', sourceCollection: 'a', sourceField: 'a' }),
    ];
    expect(effectiveRules(rows, []).map((r) => r.id)).toEqual(['4', '3', '2', '1']);
    // A shared row sorts among the Connection's, not after them.
    const mixed = effectiveRules(
      [own({ id: 'z', sourceField: 'z' })],
      [shared({ id: 'a', sourceField: 'a' })],
    );
    expect(mixed.map((r) => r.id)).toEqual(['a', 'z']);
  });

  it('does not mutate its inputs', () => {
    const o = [own({ id: 'o', sourceField: 'b' }), own({ id: 'p', sourceField: 'a' })];
    const s = [shared({ id: 's', sourceField: 'a' })];
    const before = JSON.stringify([o, s]);
    effectiveRules(o, s);
    expect(JSON.stringify([o, s])).toBe(before);
  });
});

describe('ruleKey / rowSummaryKey', () => {
  it('does not collide when a name contains the separator', () => {
    const a = ruleKey({ sourceDb: 'a,b', sourceCollection: 'c', sourceField: 'd' });
    const b = ruleKey({ sourceDb: 'a', sourceCollection: 'b,c', sourceField: 'd' });
    expect(a).not.toBe(b);
    expect(rowSummaryKey({ dbName: 'a|b', collection: 'c' })).not.toBe(
      rowSummaryKey({ dbName: 'a', collection: 'b|c' }),
    );
  });
});

describe('effectiveRowSummary', () => {
  const sum = (id: string, owner: RowSummary['owner'], fields: string[]): RowSummary => ({
    id,
    owner,
    dbName: 'shop',
    collection: 'orders',
    fields,
    updatedAt: 't',
  });

  it('is null with neither', () => {
    expect(effectiveRowSummary(null, null)).toBeNull();
  });

  it('is local when only the Connection has one', () => {
    const c = sum('c', CONN, ['a']);
    expect(effectiveRowSummary(c, null)).toEqual({ ...c, origin: 'local' });
  });

  it('is shared when only the Family has one', () => {
    const f = sum('f', FAM, ['a']);
    expect(effectiveRowSummary(null, f)).toEqual({ ...f, origin: 'shared' });
  });

  it('is an override naming the shared one when both exist', () => {
    const c = sum('c', CONN, ['a']);
    const f = sum('f', FAM, ['b']);
    expect(effectiveRowSummary(c, f)).toEqual({ ...c, origin: 'override', sharedId: 'f' });
  });
});
