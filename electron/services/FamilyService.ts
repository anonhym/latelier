import { randomUUID } from 'node:crypto';
import type {
  ConnectionFamily,
  FamilyCreateInput,
  FamilyDeleteInput,
  FamilyOverrides,
  FamilyRenameInput,
  FamilySettings,
  FamilySetMembershipInput,
  ReferenceRule,
} from '@shared/types';
import { ValidationError } from '../errors.ts';
import type { FamilyRepo } from '../db/repositories/FamilyRepo.ts';
import type {
  ReferenceRuleInsert,
  ReferenceRulesRepo,
} from '../db/repositories/ReferenceRulesRepo.ts';
import type { RowSummaryRepo } from '../db/repositories/RowSummaryRepo.ts';
import { ruleKey } from './effectiveRules.ts';

const MAX_FAMILY_NAME = 80;

function nowIso(): string {
  return new Date().toISOString();
}

function validName(raw: string): string {
  const name = raw.trim();
  if (name.length < 1 || name.length > MAX_FAMILY_NAME) {
    throw new ValidationError(`a family name takes 1 to ${MAX_FAMILY_NAME} characters`, { field: 'name' });
  }
  return name;
}

function copyOfRule(rule: ReferenceRule, connectionId: string, now: string): ReferenceRuleInsert {
  return {
    id: randomUUID(),
    owner: { connectionId },
    source_db: rule.sourceDb,
    source_collection: rule.sourceCollection,
    source_field: rule.sourceField,
    target_db: rule.targetDb,
    target_collection: rule.targetCollection,
    target_field: rule.targetField,
    projection_json: JSON.stringify(rule.projection),
    display_template: rule.displayTemplate ?? null,
    enabled: rule.enabled ? 1 : 0,
    created_at: now,
    updated_at: now,
  };
}

/** Connection Families: naming, membership, and what happens to shared settings on leave and delete. */
export class FamilyService {
  private families: FamilyRepo;
  private rules: ReferenceRulesRepo;
  private summaries: RowSummaryRepo;

  constructor(families: FamilyRepo, rules: ReferenceRulesRepo, summaries: RowSummaryRepo) {
    this.families = families;
    this.rules = rules;
    this.summaries = summaries;
  }

  list(): ConnectionFamily[] {
    return this.families.list();
  }

  create(input: FamilyCreateInput): ConnectionFamily {
    const name = validName(input.name);
    const now = nowIso();
    const id = randomUUID();
    return this.families.transaction(() => {
      this.families.insert({ id, name, created_at: now, updated_at: now });
      for (const connectionId of new Set(input.memberIds ?? [])) this.join(connectionId, id, false);
      return this.families.findByIdOrThrow(id);
    });
  }

  rename(input: FamilyRenameInput): ConnectionFamily {
    return this.families.rename(input.id, validName(input.name), nowIso());
  }

  /**
   * Put Connections into a Family, or take them out of theirs (`familyId: null`).
   * A Connection already in another Family leaves it and joins in one
   * transaction, so a failure part-way leaves nobody moved.
   */
  setMembership(input: FamilySetMembershipInput): ConnectionFamily[] {
    const keep = input.keepAsLocal === true;
    this.families.transaction(() => {
      if (input.familyId !== null) this.families.findByIdOrThrow(input.familyId);
      for (const connectionId of new Set(input.connectionIds)) {
        this.join(connectionId, input.familyId, keep);
      }
    });
    return this.families.list();
  }

  /**
   * Delete a Family. Its shared settings go with it; with `keepAsLocal` every
   * member first gets a local copy of each one it does not already override.
   * Members are left with no Family.
   */
  delete(input: FamilyDeleteInput): void {
    this.families.transaction(() => {
      const family = this.families.findByIdOrThrow(input.id);
      if (input.keepAsLocal) {
        for (const connectionId of family.memberIds) this.copySharedToConnection(family.id, connectionId);
      }
      this.families.deleteById(family.id);
    });
  }

  /** The shared Reference Rules and Row Summaries a Family owns. */
  settings(id: string): FamilySettings {
    this.families.findByIdOrThrow(id);
    return {
      rules: this.rules.listByOwner({ familyId: id }),
      rowSummaries: this.summaries.listByOwner({ familyId: id }),
    };
  }

  /** For each shared setting of a Family, the members whose own row replaces it. Settings nobody overrides are left out. */
  overrides(id: string): FamilyOverrides {
    const family = this.families.findByIdOrThrow(id);
    const sharedRules = this.rules.listByOwner({ familyId: id });
    const sharedSummaries = this.summaries.listByOwner({ familyId: id });
    const out: FamilyOverrides = { rules: [], rowSummaries: [] };

    const ownRuleKeys = new Map(
      family.memberIds.map((m) => [m, new Set(this.rules.listByOwner({ connectionId: m }).map(ruleKey))]),
    );
    for (const shared of sharedRules) {
      const key = ruleKey(shared);
      const connectionIds = family.memberIds.filter((m) => ownRuleKeys.get(m)?.has(key));
      if (connectionIds.length > 0) out.rules.push({ ruleId: shared.id, connectionIds });
    }

    for (const shared of sharedSummaries) {
      const connectionIds = family.memberIds.filter(
        (m) => this.summaries.find({ connectionId: m }, shared.dbName, shared.collection) !== null,
      );
      if (connectionIds.length > 0) out.rowSummaries.push({ summaryId: shared.id, connectionIds });
    }
    return out;
  }

  /** Move one Connection to `target` (a leave, then a join); a no-op when it is already there. */
  private join(connectionId: string, target: string | null, keepAsLocal: boolean): void {
    const current = this.families.familyIdOfConnection(connectionId);
    if (current === target) return;
    if (current !== null && keepAsLocal) this.copySharedToConnection(current, connectionId);
    this.families.setFamily(connectionId, target);
  }

  /**
   * Give a Connection a local copy of every shared setting of a Family that it
   * has no row for. A row it already has is an Override and wins, so no copy
   * replaces it.
   */
  private copySharedToConnection(familyId: string, connectionId: string): void {
    const now = nowIso();
    const ownKeys = new Set(this.rules.listByOwner({ connectionId }).map(ruleKey));
    for (const shared of this.rules.listByOwner({ familyId })) {
      if (!ownKeys.has(ruleKey(shared))) this.rules.insert(copyOfRule(shared, connectionId, now));
    }
    for (const shared of this.summaries.listByOwner({ familyId })) {
      if (this.summaries.find({ connectionId }, shared.dbName, shared.collection) !== null) continue;
      this.summaries.upsert({
        id: randomUUID(),
        owner: { connectionId },
        dbName: shared.dbName,
        collection: shared.collection,
        fields: shared.fields,
        updatedAt: now,
      });
    }
  }
}
