import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { runMigrations, type Migration } from '../../electron/db/migrationRunner';

function loadMigrationsFromDisk(): Migration[] {
  const dir = path.resolve(__dirname, '..', '..', 'electron', 'db', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
  return files
    .map((name) => {
      const match = name.match(/^(\d+)-/);
      if (!match) throw new Error(`bad migration filename: ${name}`);
      return {
        version: Number(match[1]),
        name,
        sql: fs.readFileSync(path.join(dir, name), 'utf8'),
      };
    })
    .sort((a, b) => a.version - b.version);
}

interface SeedTab {
  id: string;
  connection_id: string;
  kind: 'collection' | 'aggregation';
  db_name: string;
  collection: string;
  state_json: string;
  position: number;
  is_active?: number;
  opened_at?: string;
  pinned?: number;
}

function seedConnection(db: BetterSqlite3.Database, id: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO connections (id, name, connection_type, host, port, auth_mech, created_at, updated_at)
     VALUES (?, 'c-' || ?, 'standard', 'localhost', 27017, 'none', ?, ?)`,
  ).run(id, id, now, now);
}

function seedTab(db: BetterSqlite3.Database, t: SeedTab): void {
  db.prepare(
    `INSERT INTO workspace_tabs (
       id, connection_id, kind, db_name, collection,
       state_json, position, is_active, opened_at, pinned
     ) VALUES (
       @id, @connection_id, @kind, @db_name, @collection,
       @state_json, @position, @is_active, @opened_at, @pinned
     )`,
  ).run({
    is_active: 0,
    opened_at: t.opened_at ?? new Date().toISOString(),
    pinned: 0,
    ...t,
  });
}

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mongolab-mig07-'));
  return path.join(dir, 'test.db');
}

describe('migration 007 — collection-subtabs', () => {
  const opened: BetterSqlite3.Database[] = [];

  afterEach(() => {
    while (opened.length) opened.pop()!.close();
  });

  function withMigrationsThrough(version: number): BetterSqlite3.Database {
    const db = new BetterSqlite3(tmpFile());
    db.pragma('foreign_keys = ON');
    opened.push(db);
    const migrations = loadMigrationsFromDisk().filter((m) => m.version <= version);
    runMigrations(db, migrations);
    return db;
  }

  it('merges aggregation rows into matching collection rows', () => {
    const db = withMigrationsThrough(6);
    seedConnection(db, 'conn');
    seedTab(db, {
      id: 'tab-coll',
      connection_id: 'conn',
      kind: 'collection',
      db_name: 'd',
      collection: 'c',
      state_json: JSON.stringify({ view: 'JSON', page: 2, queryDirty: false }),
      position: 0,
      is_active: 1,
    });
    seedTab(db, {
      id: 'tab-agg',
      connection_id: 'conn',
      kind: 'aggregation',
      db_name: 'd',
      collection: 'c',
      state_json: JSON.stringify({
        stages: [{ id: 1, op: '$match', body: '{}', enabled: true }],
        activeStageId: null,
        outputHeight: 260,
        outputView: 'Tree',
      }),
      position: 1,
    });

    runMigrations(db, loadMigrationsFromDisk());

    const rows = db
      .prepare('SELECT id, kind, state_json FROM workspace_tabs')
      .all() as Array<{ id: string; kind: string; state_json: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe('tab-coll');
    const state = JSON.parse(rows[0]!.state_json);
    expect(state.activeView).toBe('aggregation');
    expect(state.aggregation.stages).toHaveLength(1);
    expect(state.aggregation.stages[0].op).toBe('$match');
    // Original Documents state preserved.
    expect(state.view).toBe('JSON');
    expect(state.page).toBe(2);
  });

  it('promotes a standalone aggregation row to a collection row', () => {
    const db = withMigrationsThrough(6);
    seedConnection(db, 'conn');
    seedTab(db, {
      id: 'tab-agg',
      connection_id: 'conn',
      kind: 'aggregation',
      db_name: 'd',
      collection: 'orphan',
      state_json: JSON.stringify({
        stages: [{ id: 7, op: '$count', body: '"n"', enabled: true }],
        activeStageId: 7,
        outputHeight: 200,
        outputView: 'JSON',
        name: 'My pipeline',
      }),
      position: 0,
    });

    runMigrations(db, loadMigrationsFromDisk());

    const row = db
      .prepare('SELECT id, kind, state_json FROM workspace_tabs WHERE id = ?')
      .get('tab-agg') as { id: string; kind: string; state_json: string };
    expect(row.kind).toBe('collection');
    const state = JSON.parse(row.state_json);
    expect(state.activeView).toBe('aggregation');
    expect(state.aggregation.stages).toHaveLength(1);
    expect(state.aggregation.name).toBe('My pipeline');
    // Default Documents shape is synthesized so the renderer can show
    // Documents view if the user clicks the sub-tab.
    expect(state.view).toBe('Tree');
    expect(state.builder).toBeDefined();
  });

  it('keeps only the most recent of duplicate aggregation rows on the same collection', () => {
    const db = withMigrationsThrough(6);
    seedConnection(db, 'conn');
    seedTab(db, {
      id: 'tab-agg-old',
      connection_id: 'conn',
      kind: 'aggregation',
      db_name: 'd',
      collection: 'c',
      state_json: JSON.stringify({ stages: [{ id: 1, op: '$match', body: '{}', enabled: true }] }),
      position: 0,
      opened_at: '2026-01-01T00:00:00.000Z',
    });
    seedTab(db, {
      id: 'tab-agg-new',
      connection_id: 'conn',
      kind: 'aggregation',
      db_name: 'd',
      collection: 'c',
      state_json: JSON.stringify({ stages: [{ id: 2, op: '$group', body: '{}', enabled: true }] }),
      position: 1,
      opened_at: '2026-04-01T00:00:00.000Z',
    });

    runMigrations(db, loadMigrationsFromDisk());

    const rows = db
      .prepare('SELECT id, kind, state_json FROM workspace_tabs')
      .all() as Array<{ id: string; kind: string; state_json: string }>;
    expect(rows.length).toBe(1);
    const state = JSON.parse(rows[0]!.state_json);
    expect(state.aggregation.stages[0].op).toBe('$group');
  });
});
