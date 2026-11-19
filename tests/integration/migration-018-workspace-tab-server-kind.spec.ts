import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { runMigrations, type Migration } from '../../electron/db/migrationRunner';

function loadMigrationsFromDisk(): Migration[] {
  const dir = path.resolve(__dirname, '..', '..', 'electron', 'db', 'migrations');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((name) => ({
      version: Number(/^(\d+)-/.exec(name)![1]),
      name,
      sql: fs.readFileSync(path.join(dir, name), 'utf8'),
    }))
    .sort((a, b) => a.version - b.version);
}

describe('migration 018 — workspace_tabs accepts the server kind', () => {
  let db: BetterSqlite3.Database | null = null;
  let dir: string | null = null;

  afterEach(() => {
    db?.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    db = null;
    dir = null;
  });

  function open(): BetterSqlite3.Database {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mongolab-mig18-'));
    db = new BetterSqlite3(path.join(dir, 'test.db'));
    db.pragma('foreign_keys = ON');
    return db;
  }

  function seedConnection(d: BetterSqlite3.Database): void {
    d.prepare(
      `INSERT INTO connections (id, name, connection_type, host, port, auth_mech, created_at, updated_at)
       VALUES ('c1', 'c1', 'standard', 'localhost', 27017, 'none', 'x', 'x')`,
    ).run();
  }

  const insertTab = (d: BetterSqlite3.Database, id: string, kind: string, pinned = 0) =>
    d
      .prepare(
        `INSERT INTO workspace_tabs
           (id, connection_id, kind, db_name, collection, state_json, position, is_active, opened_at, pinned)
         VALUES (?, 'c1', ?, 'shop', 'orders', '{"a":1}', 3, 1, '2026-01-01T00:00:00.000Z', ?)`,
      )
      .run(id, kind, pinned);

  it('keeps existing rows (pinned included) and lands on version 18', () => {
    const d = open();
    const all = loadMigrationsFromDisk();
    runMigrations(
      d,
      all.filter((m) => m.version < 18),
    );
    seedConnection(d);
    insertTab(d, 't-coll', 'collection', 1);
    insertTab(d, 't-script', 'script');
    const before = d.prepare('SELECT * FROM workspace_tabs ORDER BY id').all();

    runMigrations(d, all);

    expect(before).toHaveLength(2);
    expect(d.prepare('SELECT * FROM workspace_tabs ORDER BY id').all()).toEqual(before);
    expect((d.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(19);
  });

  it("accepts a 'server' row, refuses an unknown kind, and keeps idx_tabs_position", () => {
    const d = open();
    runMigrations(d, loadMigrationsFromDisk());
    seedConnection(d);
    expect(() => insertTab(d, 't-server', 'server')).not.toThrow();
    expect(() => insertTab(d, 't-bad', 'dashboard')).toThrow(/CHECK/);
    expect(
      d.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_tabs_position'").get(),
    ).toBeDefined();
  });
});
