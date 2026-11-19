import type {
  EffectiveReferenceRule,
  EffectiveRowSummary,
  ReferenceRule,
  RowSummary,
} from '@shared/types';

/** A Reference Rule is identified by the field it hangs on, never by its target. */
export function ruleKey(rule: Pick<ReferenceRule, 'sourceDb' | 'sourceCollection' | 'sourceField'>): string {
  return JSON.stringify([rule.sourceDb, rule.sourceCollection, rule.sourceField]);
}

export function rowSummaryKey(summary: Pick<RowSummary, 'dbName' | 'collection'>): string {
  return JSON.stringify([summary.dbName, summary.collection]);
}

/**
 * What a Connection uses once its own rules and its Family's are resolved.
 *
 * A Connection row whose key matches a Family row replaces it and becomes an
 * `override`; a disabled Override stays in the set so the shared rule it hides
 * stays hidden on this Connection. A Connection row with no shared counterpart
 * is `local`, a Family row nothing replaces is `shared`. A shared rule on a
 * Database or Collection the Connection's server lacks is still listed: it
 * matches nothing at read time and raises nothing here.
 *
 * Sorted by Database, Collection and source field via `localeCompare`.
 */
export function effectiveRules(
  connectionRows: ReferenceRule[],
  familyRows: ReferenceRule[],
): EffectiveReferenceRule[] {
  const sharedByKey = new Map(familyRows.map((r) => [ruleKey(r), r]));
  const ownKeys = new Set<string>();
  const out: EffectiveReferenceRule[] = [];

  for (const row of connectionRows) {
    const key = ruleKey(row);
    ownKeys.add(key);
    const shared = sharedByKey.get(key);
    out.push(
      shared
        ? { ...row, origin: 'override', sharedRuleId: shared.id }
        : { ...row, origin: 'local' },
    );
  }
  for (const row of familyRows) {
    if (!ownKeys.has(ruleKey(row))) out.push({ ...row, origin: 'shared' });
  }

  return out.sort(
    (a, b) =>
      a.sourceDb.localeCompare(b.sourceDb) ||
      a.sourceCollection.localeCompare(b.sourceCollection) ||
      a.sourceField.localeCompare(b.sourceField),
  );
}

/**
 * The same resolution for the Row Summary of one Collection: the Connection's
 * own wins and becomes an `override` when the Family has one too.
 */
export function effectiveRowSummary(
  connectionRow: RowSummary | null,
  familyRow: RowSummary | null,
): EffectiveRowSummary | null {
  if (connectionRow) {
    return familyRow
      ? { ...connectionRow, origin: 'override', sharedId: familyRow.id }
      : { ...connectionRow, origin: 'local' };
  }
  return familyRow ? { ...familyRow, origin: 'shared' } : null;
}
