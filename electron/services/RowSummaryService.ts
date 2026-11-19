import { randomUUID } from 'node:crypto';
import type {
  EffectiveRowSummary,
  RowSummary,
  RowSummaryClearInput,
  RowSummaryGetInput,
  RowSummarySetInput,
} from '@shared/types';
import { NotFoundError, ValidationError } from '../errors.ts';
import type { FamilyRepo } from '../db/repositories/FamilyRepo.ts';
import type { RowSummaryRepo } from '../db/repositories/RowSummaryRepo.ts';
import { effectiveRowSummary } from './effectiveRules.ts';
import { rowSummaryFieldsProblem } from './rowSummaryValidate.ts';

/** Row Summaries: the fields a collapsed Tree row shows, saved per Collection and owner. */
export class RowSummaryService {
  private summaries: RowSummaryRepo;
  private families: FamilyRepo;

  constructor(summaries: RowSummaryRepo, families: FamilyRepo) {
    this.summaries = summaries;
    this.families = families;
  }

  /** What a Connection uses for one Collection: its own, else its Family's, else `null`. */
  get(input: RowSummaryGetInput): EffectiveRowSummary | null {
    const familyId = this.families.familyIdOfConnection(input.connectionId);
    return effectiveRowSummary(
      this.summaries.find({ connectionId: input.connectionId }, input.dbName, input.collection),
      familyId === null ? null : this.summaries.find({ familyId }, input.dbName, input.collection),
    );
  }

  set(input: RowSummarySetInput): RowSummary {
    const problem = rowSummaryFieldsProblem(input.fields);
    if (problem) throw new ValidationError(problem, { field: 'fields' });
    return this.summaries.upsert({
      id: randomUUID(),
      owner: input.owner,
      dbName: input.dbName,
      collection: input.collection,
      fields: input.fields,
      updatedAt: new Date().toISOString(),
    });
  }

  clear(input: RowSummaryClearInput): void {
    if (this.summaries.delete(input.owner, input.dbName, input.collection) === 0) {
      throw new NotFoundError(`row summary for ${input.dbName}.${input.collection} not found`);
    }
  }
}
