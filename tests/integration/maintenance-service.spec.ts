import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RecentQueryRepo } from '../../electron/db/repositories/RecentQueryRepo';
import { AuditRepo } from '../../electron/db/repositories/AuditRepo';
import { MaintenanceService } from '../../electron/services/MaintenanceService';
import { createTempDb, type TempDb } from '../helpers/db';

const CONNECTION_ID = 'conn-maint';

function insertRecent(db: TempDb['db'], id: string, ranAt: string): void {
  db.prepare(`
    INSERT INTO recent_queries (
      id, connection_id, db_name, collection, kind, payload_json,
      ran_at, duration_ms, result_count, error_code
    ) VALUES (
      ?, ?, 'mydb', 'items', 'find', '{}',
      ?, 5, 1, NULL
    )
  `).run(id, CONNECTION_ID, ranAt);
}

function seedConnection(db: TempDb['db']): void {
  db.prepare(`
    INSERT INTO connections (
      id, name, color, connection_type, host, port,
      auth_mech, tls_enabled, tls_verify, ssh_enabled,
      connect_timeout_ms, socket_timeout_ms, server_selection_timeout_ms,
      read_preference, max_pool_size, direct_connection,
      created_at, updated_at
    ) VALUES (
      ?, 'Test', '#1A6835', 'standard', 'localhost', 27017,
      'none', 1, 1, 0,
      10000, 30000, 30000,
      'primary', 100, 0,
      ?, ?
    )
  `).run(CONNECTION_ID, new Date().toISOString(), new Date().toISOString());
}

/**
 * Regression test for P1-2: previously MaintenanceService.vacuum reached into
 * `recentRepo.db` to run an ad-hoc DELETE. The repo is now responsible for the
 * SQL via `deleteOlderThan(days)`, and the public `db` field is removed.
 */
describe('RecentQueryRepo.deleteOlderThan + MaintenanceService.vacuum', () => {
  let tmp: TempDb;

  beforeEach(() => {
    tmp = createTempDb();
    seedConnection(tmp.db);
  });

  afterEach(() => {
    tmp.cleanup();
  });

  it('deleteOlderThan removes rows older than the threshold and keeps newer rows', () => {
    const repo = new RecentQueryRepo(tmp.db);
    insertRecent(tmp.db, 'old', "datetime('now', '-90 days')");
    insertRecent(tmp.db, 'old2', "datetime('now', '-31 days')");
    insertRecent(tmp.db, 'fresh', "datetime('now', '-1 day')");

    // The helper inserted literal SQL strings into `ran_at`; rewrite them as
    // computed datetime values so the comparison is meaningful.
    tmp.db.prepare("UPDATE recent_queries SET ran_at = datetime('now', '-90 days') WHERE id = 'old'").run();
    tmp.db.prepare("UPDATE recent_queries SET ran_at = datetime('now', '-31 days') WHERE id = 'old2'").run();
    tmp.db.prepare("UPDATE recent_queries SET ran_at = datetime('now', '-1 day') WHERE id = 'fresh'").run();

    const deleted = repo.deleteOlderThan(30);
    expect(deleted).toBe(2);

    expect(repo.findById('fresh')).not.toBeNull();
    expect(repo.findById('old')).toBeNull();
    expect(repo.findById('old2')).toBeNull();
  });

  it('MaintenanceService.runIfNeeded calls deleteOlderThan on first run and skips inside the 24h window', () => {
    const repo = new RecentQueryRepo(tmp.db);
    insertRecent(tmp.db, 'old', "datetime('now', '-60 days')");
    tmp.db.prepare("UPDATE recent_queries SET ran_at = datetime('now', '-60 days') WHERE id = 'old'").run();

    const calls: Array<{ key: string; value: unknown }> = [];
    const store = new Map<string, unknown>();
    const appState = {
      get: <T>(key: string) => (store.get(key) ?? null) as T | null,
      set: <T>(key: string, value: T) => {
        store.set(key, value);
        calls.push({ key, value });
      },
    };

    const svc = new MaintenanceService(repo, new AuditRepo(tmp.db));

    // First run — old row gone, lastRunAt set.
    svc.runIfNeeded(appState);
    expect(repo.findById('old')).toBeNull();
    expect(store.get('maintenance.lastRunAt')).toBeTruthy();

    // Reset call log; second invocation within 24h must not write again.
    calls.length = 0;
    insertRecent(tmp.db, 'still-old', "datetime('now', '-45 days')");
    tmp.db.prepare("UPDATE recent_queries SET ran_at = datetime('now', '-45 days') WHERE id = 'still-old'").run();

    svc.runIfNeeded(appState);
    expect(calls).toHaveLength(0);
    // still-old should remain because vacuum did not re-run.
    expect(repo.findById('still-old')).not.toBeNull();
  });

  it('the sweep deletes audit rows past 90 days and keeps newer ones', () => {
    const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
    const insertAudit = (id: string, ranAt: string) =>
      tmp.db.prepare(`
        INSERT INTO audit_log (id, connection_id, db_name, collection, op, summary_json, outcome, ran_at, duration_ms)
        VALUES (?, ?, 'mydb', 'items', 'collectionDrop', '{"op":"collectionDrop"}', 'ok', ?, 3)
      `).run(id, CONNECTION_ID, ranAt);
    insertAudit('audit-91d', daysAgo(91));
    insertAudit('audit-89d', daysAgo(89));
    insertAudit('audit-now', daysAgo(0));
    const store = new Map<string, unknown>();
    const appState = {
      get: <T>(key: string) => (store.get(key) ?? null) as T | null,
      set: <T>(key: string, value: T) => void store.set(key, value),
    };

    new MaintenanceService(new RecentQueryRepo(tmp.db), new AuditRepo(tmp.db)).runIfNeeded(appState);

    const ids = (tmp.db.prepare('SELECT id FROM audit_log ORDER BY id').all() as { id: string }[]).map((r) => r.id);
    expect(ids).toEqual(['audit-89d', 'audit-now']);
  });
});
