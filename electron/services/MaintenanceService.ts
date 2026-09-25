import type { RecentQueryRepo } from '../db/repositories/RecentQueryRepo.ts';
import type { AuditRepo } from '../db/repositories/AuditRepo.ts';
import type { AppStateService } from './AppStateService.ts';

const MAINTENANCE_KEY = 'maintenance.lastRunAt';
const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RECENT_RETENTION_DAYS = 30;
const AUDIT_RETENTION_DAYS = 90;

export class MaintenanceService {
  private recentRepo: RecentQueryRepo;
  private auditRepo: AuditRepo;
  constructor(recentRepo: RecentQueryRepo, auditRepo: AuditRepo) {
    this.recentRepo = recentRepo;
    this.auditRepo = auditRepo;
  }

  runIfNeeded(appState: Pick<AppStateService, 'get' | 'set'>): void {
    const lastRun = appState.get<string>(MAINTENANCE_KEY);
    const now = Date.now();

    if (lastRun !== null) {
      const lastRunMs = new Date(lastRun).getTime();
      if (now - lastRunMs < INTERVAL_MS) return;
    }

    this.vacuum();
    appState.set(MAINTENANCE_KEY, new Date(now).toISOString());
  }

  private vacuum(): void {
    this.recentRepo.deleteOlderThan(RECENT_RETENTION_DAYS);
    this.auditRepo.deleteOlderThan(AUDIT_RETENTION_DAYS);
  }
}
