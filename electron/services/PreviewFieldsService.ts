import type { PreviewFields } from '@shared/types';
import type { PreviewFieldsRepo } from '../db/repositories/PreviewFieldsRepo.ts';

/**
 * Thin service over PreviewFieldsRepo. Wraps the repo so the IPC handler
 * depends on a service instead of reaching into the data layer directly
 * (matches the router → service → repo layering used everywhere else).
 */
export class PreviewFieldsService {
  private repo: PreviewFieldsRepo;

  constructor(repo: PreviewFieldsRepo) {
    this.repo = repo;
  }

  get(connectionId: string, dbName: string, collection: string): PreviewFields | null {
    return this.repo.get(connectionId, dbName, collection);
  }

  set(
    connectionId: string,
    dbName: string,
    collection: string,
    fields: string[],
  ): PreviewFields {
    return this.repo.set(connectionId, dbName, collection, fields);
  }
}
