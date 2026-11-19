import type {
  FamilyApplyChoice,
  FamilyApplyConflict,
  FamilyApplyPlan,
  FamilyExportItem,
} from '@shared/types';
import { ruleKey, rowSummaryKey } from './effectiveRules.ts';
import type { FamilyExportRowSummary, FamilyExportRule } from './familyExportFormat.ts';

/**
 * Applying a Family Export (X24): which items are new, identical or in
 * conflict, and what an Apply with a set of choices would change. Pure: the
 * service reads the target and writes the result.
 */

export interface ApplyItems {
  rules: FamilyExportRule[];
  rowSummaries: FamilyExportRowSummary[];
}

export const RULE_PREFIX = 'rule:';
export const SUMMARY_PREFIX = 'summary:';

/** The key a rule's resolution is filed under; it cannot collide with a Row Summary's. */
export function ruleItemKey(rule: Pick<FamilyExportRule, 'sourceDb' | 'sourceCollection' | 'sourceField'>): string {
  return `${RULE_PREFIX}${ruleKey(rule)}`;
}

export function summaryItemKey(summary: Pick<FamilyExportRowSummary, 'dbName' | 'collection'>): string {
  return `${SUMMARY_PREFIX}${rowSummaryKey(summary)}`;
}

export function describeRule(rule: FamilyExportRule): FamilyExportItem {
  const projection = rule.projection.length > 0 ? ` [${rule.projection.join(', ')}]` : '';
  const template = rule.displayTemplate === undefined ? '' : ` as ${rule.displayTemplate}`;
  const off = rule.enabled ? '' : ' (off)';
  return {
    key: ruleItemKey(rule),
    kind: 'rule',
    dbName: rule.sourceDb,
    collection: rule.sourceCollection,
    field: rule.sourceField,
    detail: `${rule.targetDb}.${rule.targetCollection}.${rule.targetField}${projection}${template}${off}`,
  };
}

export function describeSummary(summary: FamilyExportRowSummary): FamilyExportItem {
  return {
    key: summaryItemKey(summary),
    kind: 'rowSummary',
    dbName: summary.dbName,
    collection: summary.collection,
    detail: summary.fields.join(', '),
  };
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function sameRule(a: FamilyExportRule, b: FamilyExportRule): boolean {
  return (
    a.targetDb === b.targetDb &&
    a.targetCollection === b.targetCollection &&
    a.targetField === b.targetField &&
    sameList(a.projection, b.projection) &&
    a.displayTemplate === b.displayTemplate &&
    a.enabled === b.enabled
  );
}

export function sameSummary(a: FamilyExportRowSummary, b: FamilyExportRowSummary): boolean {
  return sameList(a.fields, b.fields);
}

interface Classified {
  added: { rules: FamilyExportRule[]; rowSummaries: FamilyExportRowSummary[] };
  unchanged: number;
  unchangedItems: FamilyExportItem[];
  conflicts: {
    rules: { current: FamilyExportRule; incoming: FamilyExportRule }[];
    rowSummaries: { current: FamilyExportRowSummary; incoming: FamilyExportRowSummary }[];
  };
}

function classify(file: ApplyItems, target: ApplyItems): Classified {
  const targetRules = new Map(target.rules.map((r) => [ruleKey(r), r]));
  const targetSummaries = new Map(target.rowSummaries.map((s) => [rowSummaryKey(s), s]));
  const out: Classified = {
    added: { rules: [], rowSummaries: [] },
    unchanged: 0,
    unchangedItems: [],
    conflicts: { rules: [], rowSummaries: [] },
  };
  for (const incoming of file.rules) {
    const current = targetRules.get(ruleKey(incoming));
    if (current === undefined) out.added.rules.push(incoming);
    else if (sameRule(current, incoming)) {
      out.unchanged += 1;
      out.unchangedItems.push(describeRule(incoming));
    } else out.conflicts.rules.push({ current, incoming });
  }
  for (const incoming of file.rowSummaries) {
    const current = targetSummaries.get(rowSummaryKey(incoming));
    if (current === undefined) out.added.rowSummaries.push(incoming);
    else if (sameSummary(current, incoming)) {
      out.unchanged += 1;
      out.unchangedItems.push(describeSummary(incoming));
    } else out.conflicts.rowSummaries.push({ current, incoming });
  }
  return out;
}

/** Sorts a plan's lists by key so the dialog reads in a stable order. */
const byKey = (a: { key: string }, b: { key: string }): number => a.key.localeCompare(b.key);

/** What applying `file` onto `target` would do: items to add, identical ones, and those that differ. */
export function planApply(file: ApplyItems, target: ApplyItems): FamilyApplyPlan {
  const c = classify(file, target);
  const conflicts: FamilyApplyConflict[] = [
    ...c.conflicts.rules.map((x) => ({
      key: ruleItemKey(x.incoming),
      current: describeRule(x.current),
      incoming: describeRule(x.incoming),
    })),
    ...c.conflicts.rowSummaries.map((x) => ({
      key: summaryItemKey(x.incoming),
      current: describeSummary(x.current),
      incoming: describeSummary(x.incoming),
    })),
  ];
  return {
    added: [...c.added.rules.map(describeRule), ...c.added.rowSummaries.map(describeSummary)].sort(byKey),
    unchanged: [...c.unchangedItems].sort(byKey),
    conflicts: conflicts.sort(byKey),
  };
}

export interface ApplyDecision {
  /** Items to insert. */
  addRules: FamilyExportRule[];
  addRowSummaries: FamilyExportRowSummary[];
  /** Items that replace the target's row with the same key. */
  replaceRules: FamilyExportRule[];
  replaceRowSummaries: FamilyExportRowSummary[];
  added: number;
  replaced: number;
  kept: number;
  unchanged: number;
}

/**
 * What an Apply changes, given a choice for every conflict. A conflict with no
 * choice is a caller bug and throws: guessing would silently keep or replace
 * somebody's setting. Nothing is ever removed from the target.
 */
export function decideApply(
  file: ApplyItems,
  target: ApplyItems,
  resolutions: ReadonlyMap<string, FamilyApplyChoice>,
): ApplyDecision {
  const c = classify(file, target);
  const decision: ApplyDecision = {
    addRules: c.added.rules,
    addRowSummaries: c.added.rowSummaries,
    replaceRules: [],
    replaceRowSummaries: [],
    added: c.added.rules.length + c.added.rowSummaries.length,
    replaced: 0,
    kept: 0,
    unchanged: c.unchanged,
  };
  const choose = (key: string): FamilyApplyChoice => {
    const choice = resolutions.get(key);
    if (choice === undefined) throw new Error(`no choice was given for the conflict ${key}`);
    return choice;
  };
  for (const { incoming } of c.conflicts.rules) {
    if (choose(ruleItemKey(incoming)) === 'take') {
      decision.replaceRules.push(incoming);
      decision.replaced += 1;
    } else decision.kept += 1;
  }
  for (const { incoming } of c.conflicts.rowSummaries) {
    if (choose(summaryItemKey(incoming)) === 'take') {
      decision.replaceRowSummaries.push(incoming);
      decision.replaced += 1;
    } else decision.kept += 1;
  }
  return decision;
}
