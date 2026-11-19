import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  FamilyApplyInput,
  FamilyApplyOverriddenBy,
  FamilyApplyPlan,
  FamilyApplyPlanInput,
  FamilyApplyResult,
  FamilyApplyTarget,
  FamilyExportInput,
  FamilyExportItem,
  FamilyExportResult,
  FamilyReadExportResult,
  ReferenceRule,
  RowSummary,
} from '@shared/types';
import { ConflictError, SystemError, ValidationError } from '../errors.ts';
import type { FamilyRepo } from '../db/repositories/FamilyRepo.ts';
import type { ReferenceRulesRepo } from '../db/repositories/ReferenceRulesRepo.ts';
import type { RowSummaryRepo } from '../db/repositories/RowSummaryRepo.ts';
import type { Logger } from '../log.ts';
import { ruleKey } from './effectiveRules.ts';
import {
  decideApply,
  describeRule,
  describeSummary,
  planApply,
  ruleItemKey,
  summaryItemKey,
  type ApplyItems,
} from './familyApplyPlan.ts';
import {
  FAMILY_EXPORT_MAX_BYTES,
  familyFileName,
  parseFamilyExport,
  writeFamilyExport,
  type FamilyExportFile,
  type FamilyExportRule,
  type FamilyExportRowSummary,
} from './familyExportFormat.ts';

export const TOKEN_TTL_MS = 10 * 60 * 1000;
/** Files held at once; opening another file past this drops the oldest. */
const MAX_HELD = 5;
const MAX_FAMILY_NAME = 80;

export interface FamilyExportDialogs {
  /** Shows the save dialog; `null` when the user cancels. `message` is shown above the file name where the platform has room for one. */
  savePath(defaultName: string, message?: string): Promise<string | null>;
  /** Shows the open dialog; `null` when the user cancels. */
  openPath(): Promise<string | null>;
}

interface Held {
  file: FamilyExportFile;
  expiresAt: number;
  /**
   * The target and each conflict's current row (by key) the last plan showed: a
   * conflict that appears later is told apart from one never answered, and a
   * row that changed since is told apart from the one the answer was given for.
   */
  planned?: { target: string; conflicts: Map<string, string> };
}

function toRule(rule: ReferenceRule): FamilyExportRule {
  const out: FamilyExportRule = {
    sourceDb: rule.sourceDb,
    sourceCollection: rule.sourceCollection,
    sourceField: rule.sourceField,
    targetDb: rule.targetDb,
    targetCollection: rule.targetCollection,
    targetField: rule.targetField,
    projection: rule.projection,
    enabled: rule.enabled,
  };
  if (rule.displayTemplate !== undefined) out.displayTemplate = rule.displayTemplate;
  return out;
}

function toSummary(summary: RowSummary): FamilyExportRowSummary {
  return { dbName: summary.dbName, collection: summary.collection, fields: summary.fields };
}

function targetId(target: FamilyApplyTarget): string {
  return 'familyId' in target ? `id:${target.familyId}` : `new:${target.newName}`;
}

/**
 * Family Export (X24). Owns the dialogs and the file, so no path is chosen by
 * the renderer, and holds a file it has read under a token between the steps
 * of the Apply flow. The pure parts live in `familyExportFormat` and
 * `familyApplyPlan`.
 */
export class FamilyExportService {
  private readonly families: FamilyRepo;
  private readonly rules: ReferenceRulesRepo;
  private readonly summaries: RowSummaryRepo;
  private readonly dialogs: FamilyExportDialogs;
  private readonly log: Logger | undefined;
  private readonly now: () => Date;
  private readonly held = new Map<string, Held>();

  constructor(opts: {
    families: FamilyRepo;
    rules: ReferenceRulesRepo;
    summaries: RowSummaryRepo;
    dialogs: FamilyExportDialogs;
    log?: Logger;
    now?: () => Date;
  }) {
    this.families = opts.families;
    this.rules = opts.rules;
    this.summaries = opts.summaries;
    this.dialogs = opts.dialogs;
    this.log = opts.log;
    this.now = opts.now ?? (() => new Date());
  }

  async export(input: FamilyExportInput): Promise<FamilyExportResult> {
    const family = this.families.findByIdOrThrow(input.familyId);
    const settings = {
      rules: this.rules.listByOwner({ familyId: family.id }),
      rowSummaries: this.summaries.listByOwner({ familyId: family.id }),
    };
    const empty = settings.rules.length === 0 && settings.rowSummaries.length === 0;
    const target = await this.dialogs.savePath(
      familyFileName(family.name),
      empty ? 'This family shares nothing yet, so the file will be empty.' : undefined,
    );
    if (target === null) return { saved: false };
    const content = writeFamilyExport({ familyName: family.name, settings, now: this.now() });
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      // Written beside the target and renamed over it: a failure part-way never leaves half a file.
      const partial = `${target}.${randomUUID()}.part`;
      try {
        await fs.writeFile(partial, content, 'utf8');
        await fs.rename(partial, target);
      } catch (err) {
        // The write error is what the user needs; a cleanup that also fails must not replace it.
        await fs.rm(partial, { force: true }).catch((cleanupErr: unknown) => {
          this.log?.warn('family-export', 'could not remove the partial export file', {
            code: (cleanupErr as NodeJS.ErrnoException).code ?? 'unknown',
          });
        });
        throw err;
      }
    } catch (err) {
      throw new SystemError('INTERNAL', `failed to write family export: ${(err as Error).message}`);
    }
    return {
      saved: true,
      path: target,
      ruleCount: settings.rules.length,
      rowSummaryCount: settings.rowSummaries.length,
    };
  }

  async readExport(): Promise<FamilyReadExportResult> {
    const file = await this.dialogs.openPath();
    if (file === null) return { cancelled: true };
    const text = await this.readText(file);
    const parsed = parseFamilyExport(text);
    this.dropExpired();
    while (this.held.size >= MAX_HELD) {
      this.held.delete(this.held.keys().next().value as string);
    }
    const token = randomUUID();
    this.held.set(token, { file: parsed, expiresAt: this.now().getTime() + TOKEN_TTL_MS });
    return {
      token,
      familyName: parsed.familyName,
      ruleCount: parsed.referenceRules.length,
      rowSummaryCount: parsed.rowSummaries.length,
    };
  }

  planApply(input: FamilyApplyPlanInput): FamilyApplyPlan {
    const held = this.heldFor(input.token);
    const plan = planApply(this.fileItems(held.file), this.targetItems(input.target));
    held.planned = {
      target: targetId(input.target),
      conflicts: new Map(plan.conflicts.map((c) => [c.key, c.current.detail])),
    };
    return plan;
  }

  apply(input: FamilyApplyInput): FamilyApplyResult {
    const held = this.heldFor(input.token);
    const file = this.fileItems(held.file);
    const result = this.families.transaction(() => {
      const familyId = this.resolveTarget(input.target);
      const target = this.targetItems({ familyId });
      const plan = planApply(file, target);

      const choices = new Map<string, 'keep' | 'take'>();
      for (const [key, choice] of Object.entries(input.resolutions)) choices.set(key, choice);
      const unresolved = plan.conflicts.filter((c) => !choices.has(c.key));
      const planned = held.planned?.target === targetId(input.target) ? held.planned.conflicts : null;
      // "Take" overwrites the current row, so it must be the row the user saw. "Keep" changes nothing, so a row that moved is harmless there.
      const moved = plan.conflicts.filter(
        (c) => choices.get(c.key) === 'take' && planned !== null && planned.has(c.key) && planned.get(c.key) !== c.current.detail,
      );
      if (moved.length > 0) {
        throw new ConflictError('The family changed since it was checked. Check it again.', {
          keys: moved.map((c) => c.key),
        });
      }
      if (unresolved.length > 0) {
        const fresh = unresolved.filter((c) => planned !== null && !planned.has(c.key));
        if (fresh.length > 0) {
          throw new ConflictError('The family changed since it was checked. Check it again.', {
            keys: fresh.map((c) => c.key),
          });
        }
        throw new ValidationError(`Choose what to do with ${unresolved.length} conflicting setting(s) first.`, {
          keys: unresolved.map((c) => c.key),
        });
      }

      const decision = decideApply(file, target, choices);
      const now = this.now().toISOString();
      const owner = { familyId };
      const existingRules = new Map(this.rules.listByOwner(owner).map((r) => [ruleKey(r), r]));
      for (const rule of decision.addRules) {
        this.rules.insert({
          id: randomUUID(),
          owner,
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
        });
      }
      for (const rule of decision.replaceRules) {
        this.rules.update(existingRules.get(ruleKey(rule))!.id, {
          target_db: rule.targetDb,
          target_collection: rule.targetCollection,
          target_field: rule.targetField,
          projection_json: JSON.stringify(rule.projection),
          display_template: rule.displayTemplate ?? null,
          enabled: rule.enabled ? 1 : 0,
          updated_at: now,
        });
      }
      for (const summary of [...decision.addRowSummaries, ...decision.replaceRowSummaries]) {
        this.summaries.upsert({
          id: randomUUID(),
          owner,
          dbName: summary.dbName,
          collection: summary.collection,
          fields: summary.fields,
          updatedAt: now,
        });
      }

      const touched: FamilyExportItem[] = [
        ...[...decision.addRules, ...decision.replaceRules].map(describeRule),
        ...[...decision.addRowSummaries, ...decision.replaceRowSummaries].map(describeSummary),
      ];
      return {
        familyId,
        added: decision.added,
        replaced: decision.replaced,
        kept: decision.kept,
        unchanged: decision.unchanged,
        overriddenBy: this.overriddenBy(familyId, touched),
      };
    });
    this.held.delete(input.token);
    return result;
  }

  /** Members whose own rule or Row Summary has the key of something just added or replaced. */
  private overriddenBy(familyId: string, touched: FamilyExportItem[]): FamilyApplyOverriddenBy[] {
    if (touched.length === 0) return [];
    const out: FamilyApplyOverriddenBy[] = [];
    for (const connectionId of this.families.memberIdsOf(familyId)) {
      const ownRules = new Set(this.rules.listByOwner({ connectionId }).map((r) => ruleItemKey(r)));
      const ownSummaries = new Set(
        this.summaries.listByOwner({ connectionId }).map((s) => summaryItemKey(s)),
      );
      const items = touched.filter((i) => (i.kind === 'rule' ? ownRules : ownSummaries).has(i.key));
      if (items.length > 0) out.push({ connectionId, keys: items.map((i) => i.key), items });
    }
    return out;
  }

  /** The Family an Apply lands on: an existing one (`NOT_FOUND` when gone) or a new one made now. */
  private resolveTarget(target: FamilyApplyTarget): string {
    if ('familyId' in target) return this.families.findByIdOrThrow(target.familyId).id;
    const name = target.newName.trim();
    if (name.length < 1 || name.length > MAX_FAMILY_NAME) {
      throw new ValidationError(`a family name takes 1 to ${MAX_FAMILY_NAME} characters`, { field: 'name' });
    }
    const now = this.now().toISOString();
    return this.families.insert({ id: randomUUID(), name, created_at: now, updated_at: now }).id;
  }

  /** What the target holds today; a new Family holds nothing. */
  private targetItems(target: FamilyApplyTarget): ApplyItems {
    if (!('familyId' in target)) return { rules: [], rowSummaries: [] };
    this.families.findByIdOrThrow(target.familyId);
    const owner = { familyId: target.familyId };
    return {
      rules: this.rules.listByOwner(owner).map(toRule),
      rowSummaries: this.summaries.listByOwner(owner).map(toSummary),
    };
  }

  private fileItems(file: FamilyExportFile): ApplyItems {
    return { rules: file.referenceRules, rowSummaries: file.rowSummaries };
  }

  private heldFor(token: string): Held {
    this.dropExpired();
    const held = this.held.get(token);
    if (!held) throw new ValidationError('This file is no longer open. Open it again.');
    return held;
  }

  private dropExpired(): void {
    const now = this.now().getTime();
    for (const [token, held] of this.held) {
      if (held.expiresAt <= now) this.held.delete(token);
    }
  }

  /** A file system error names an absolute path, so it is logged by its code and reported in words. */
  private async readText(file: string): Promise<string> {
    try {
      if ((await fs.stat(file)).size > FAMILY_EXPORT_MAX_BYTES) {
        throw new ValidationError(
          `This file is too large to apply (${FAMILY_EXPORT_MAX_BYTES / 1024 / 1024} MB limit).`,
        );
      }
      return await fs.readFile(file, 'utf8');
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      this.log?.warn('family-export', 'could not read the picked file', {
        code: (err as NodeJS.ErrnoException).code ?? 'unknown',
      });
      throw new ValidationError("This file can't be read.");
    }
  }
}
