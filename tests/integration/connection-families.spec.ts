import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import BetterSqlite3, { type Database } from 'better-sqlite3';
import type { SettingOwner } from '@shared/types';
import { runMigrations } from '../../electron/db/migrationRunner';
import { ConnectionRepo } from '../../electron/db/repositories/ConnectionRepo';
import { FamilyRepo } from '../../electron/db/repositories/FamilyRepo';
import { ReferenceRulesRepo } from '../../electron/db/repositories/ReferenceRulesRepo';
import { RowSummaryRepo } from '../../electron/db/repositories/RowSummaryRepo';
import { FamilyService } from '../../electron/services/FamilyService';
import { RowSummaryService } from '../../electron/services/RowSummaryService';
import { ReferenceRulesService } from '../../electron/services/ReferenceRulesService';
import { ConflictError, NotFoundError, ValidationError } from '../../electron/errors';
import { createTempDb, loadMigrationsFromDisk, type TempDb } from '../helpers/db';
import type { MongoPool } from '../../electron/mongo/MongoPool';

function addConnection(db: Database, id: string, name: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO connections (id, name, connection_type, host, port, auth_mech, created_at, updated_at)
     VALUES (?, ?, 'standard', 'localhost', 27017, 'none', ?, ?)`,
  ).run(id, name, now, now);
}

describe('migration 019 — connection families', () => {
  let db: BetterSqlite3.Database | null = null;
  let dir: string | null = null;

  afterEach(() => {
    db?.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    db = null;
    dir = null;
  });

  it('keeps every existing rule with its Connection as owner and lands on version 19', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mongolab-mig19-'));
    db = new BetterSqlite3(path.join(dir, 'test.db'));
    db.pragma('foreign_keys = ON');
    const all = loadMigrationsFromDisk();
    runMigrations(db, all.filter((m) => m.version < 19));
    addConnection(db, 'c1', 'One');
    addConnection(db, 'c2', 'Two');
    const insert = db.prepare(
      `INSERT INTO reference_rules
         (id, connection_id, source_db, source_collection, source_field, target_db,
          target_collection, target_field, projection_json, display_template, enabled, created_at, updated_at)
       VALUES (?, ?, 'shop', 'orders', ?, 'shop', 'customers', '_id', '["name"]', '{name}', ?, 'c0', 'u0')`,
    );
    insert.run('r1', 'c1', 'customer_id', 1);
    insert.run('r2', 'c1', 'agent_id', 0);
    insert.run('r3', 'c2', 'customer_id', 1);
    const before = db.prepare('SELECT * FROM reference_rules ORDER BY id').all() as Array<Record<string, unknown>>;

    // Up to 19 only: this checks what 019 does, and a later migration moves the version on.
    runMigrations(db, all.filter((m) => m.version <= 19));

    const after = db.prepare('SELECT * FROM reference_rules ORDER BY id').all() as Array<Record<string, unknown>>;
    expect(after).toHaveLength(3);
    expect(after.map((r) => ({ ...r, family_id: undefined }))).toEqual(
      before.map((r) => ({ ...r, family_id: undefined })),
    );
    expect(after.every((r) => r.family_id === null)).toBe(true);
    expect((db.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(19);
    // The rebuild kept the old uniqueness for a Connection's own rules.
    expect(() => insert.run('r4', 'c1', 'customer_id', 1)).toThrow(/UNIQUE/);
    // Deleting a Connection still cascades to its own rules.
    db.prepare("DELETE FROM connections WHERE id = 'c1'").run();
    expect(db.prepare('SELECT id FROM reference_rules').all()).toEqual([{ id: 'r3' }]);
  });
});

describe('owner columns', () => {
  let tmp: TempDb;
  beforeEach(() => {
    tmp = createTempDb();
    addConnection(tmp.db, 'c1', 'One');
    tmp.db
      .prepare("INSERT INTO connection_families (id, name, created_at, updated_at) VALUES ('f1', 'Fam', 'x', 'x')")
      .run();
  });
  afterEach(() => tmp.cleanup());

  const insertRule = (id: string, conn: string | null, fam: string | null, field = 'customer_id') =>
    tmp.db
      .prepare(
        `INSERT INTO reference_rules
           (id, connection_id, family_id, source_db, source_collection, source_field,
            target_db, target_collection, created_at, updated_at)
         VALUES (?, ?, ?, 'shop', 'orders', ?, 'shop', 'customers', 'x', 'x')`,
      )
      .run(id, conn, fam, field);

  it('refuses a rule with no owner or two owners', () => {
    expect(() => insertRule('a', null, null)).toThrow(/CHECK/);
    expect(() => insertRule('b', 'c1', 'f1')).toThrow(/CHECK/);
  });

  it('keeps one rule per owner and key, but lets a Connection and its Family share a key', () => {
    insertRule('a', 'c1', null);
    insertRule('b', null, 'f1');
    expect(() => insertRule('c', 'c1', null)).toThrow(/UNIQUE/);
    expect(() => insertRule('d', null, 'f1')).toThrow(/UNIQUE/);
    insertRule('e', 'c1', null, 'other_field');
  });

  it('applies the same owner rules to row summaries', () => {
    const insert = (id: string, conn: string | null, fam: string | null) =>
      tmp.db
        .prepare(
          `INSERT INTO row_summaries (id, connection_id, family_id, db_name, collection, fields_json, updated_at)
           VALUES (?, ?, ?, 'shop', 'orders', '["a"]', 'x')`,
        )
        .run(id, conn, fam);
    expect(() => insert('a', null, null)).toThrow(/CHECK/);
    expect(() => insert('b', 'c1', 'f1')).toThrow(/CHECK/);
    insert('c', 'c1', null);
    insert('d', null, 'f1');
    expect(() => insert('e', 'c1', null)).toThrow(/UNIQUE/);
    expect(() => insert('f', null, 'f1')).toThrow(/UNIQUE/);
  });

  it('cascades a Family row away with the Family and nulls its members', () => {
    tmp.db.prepare("UPDATE connections SET family_id = 'f1' WHERE id = 'c1'").run();
    insertRule('a', null, 'f1');
    tmp.db.prepare("DELETE FROM connection_families WHERE id = 'f1'").run();
    expect(tmp.db.prepare('SELECT COUNT(*) AS n FROM reference_rules').get()).toEqual({ n: 0 });
    expect(tmp.db.prepare("SELECT family_id FROM connections WHERE id = 'c1'").get()).toEqual({ family_id: null });
  });
});

describe('FamilyService and RowSummaryService', () => {
  let tmp: TempDb;
  let families: FamilyService;
  let rowSummaries: RowSummaryService;
  let rules: ReferenceRulesService;
  let rulesRepo: ReferenceRulesRepo;
  let familyRepo: FamilyRepo;
  let summaryRepo: RowSummaryRepo;

  beforeEach(() => {
    tmp = createTempDb();
    addConnection(tmp.db, 'c-b', 'Bravo');
    addConnection(tmp.db, 'c-a', 'Alpha');
    addConnection(tmp.db, 'c-c', 'Charlie');
    familyRepo = new FamilyRepo(tmp.db);
    rulesRepo = new ReferenceRulesRepo(tmp.db);
    summaryRepo = new RowSummaryRepo(tmp.db);
    families = new FamilyService(familyRepo, rulesRepo, summaryRepo);
    rowSummaries = new RowSummaryService(summaryRepo, familyRepo);
    rules = new ReferenceRulesService(rulesRepo, {} as MongoPool);
  });
  afterEach(() => tmp.cleanup());

  const ruleFor = (owner: SettingOwner, field: string, over: { enabled?: boolean; targetCollection?: string } = {}) =>
    rules.create({
      owner,
      sourceDb: 'shop',
      sourceCollection: 'orders',
      sourceField: field,
      targetDb: 'shop',
      targetCollection: over.targetCollection ?? 'customers',
      enabled: over.enabled,
    });

  /** The effective set reduced to what a Connection can observe, so it compares across a leave or delete. */
  const observed = (connectionId: string) =>
    rules
      .effective(connectionId)
      .map((r) => `${r.sourceField}>${r.targetCollection}:${r.enabled}`);

  describe('names', () => {
    it('creates, lists and renames, trimming the name', () => {
      const f = families.create({ name: '  Acme  ' });
      expect(f.name).toBe('Acme');
      expect(f.memberIds).toEqual([]);
      expect(families.rename({ id: f.id, name: 'Acme Corp' }).name).toBe('Acme Corp');
      expect(families.list().map((x) => x.name)).toEqual(['Acme Corp']);
    });

    it('refuses an empty, blank or over-long name as VALIDATION', () => {
      expect(() => families.create({ name: '' })).toThrow(ValidationError);
      expect(() => families.create({ name: '   ' })).toThrow(ValidationError);
      expect(() => families.create({ name: 'x'.repeat(81) })).toThrow(ValidationError);
      expect(families.create({ name: 'x'.repeat(80) }).name).toHaveLength(80);
      const f = families.create({ name: 'ok' });
      expect(() => families.rename({ id: f.id, name: '' })).toThrow(ValidationError);
    });

    it('refuses a duplicate name as CONFLICT, ignoring case, on create and rename', () => {
      families.create({ name: 'Acme' });
      expect(() => families.create({ name: 'ACME' })).toThrow(ConflictError);
      const other = families.create({ name: 'Other' });
      expect(() => families.rename({ id: other.id, name: 'acme' })).toThrow(ConflictError);
      // Renaming to its own name in another case is allowed.
      expect(families.rename({ id: other.id, name: 'OTHER' }).name).toBe('OTHER');
    });

    it('answers NOT_FOUND for an unknown Family', () => {
      expect(() => families.rename({ id: 'nope', name: 'x' })).toThrow(NotFoundError);
      expect(() => families.delete({ id: 'nope', keepAsLocal: false })).toThrow(NotFoundError);
      expect(() => families.overrides('nope')).toThrow(NotFoundError);
    });
  });

  describe('membership', () => {
    it('lists members sorted by Connection name', () => {
      const f = families.create({ name: 'F', memberIds: ['c-c', 'c-a', 'c-b'] });
      expect(f.memberIds).toEqual(['c-a', 'c-b', 'c-c']);
    });

    it('moves a Connection from one Family to another', () => {
      const f1 = families.create({ name: 'F1', memberIds: ['c-a'] });
      const f2 = families.create({ name: 'F2' });
      const all = families.setMembership({ connectionIds: ['c-a', 'c-b'], familyId: f2.id });
      expect(all.find((f) => f.id === f1.id)?.memberIds).toEqual([]);
      expect(all.find((f) => f.id === f2.id)?.memberIds).toEqual(['c-a', 'c-b']);
    });

    it('moves nobody when one Connection in the batch does not exist', () => {
      const f1 = families.create({ name: 'F1', memberIds: ['c-a'] });
      const f2 = families.create({ name: 'F2' });
      expect(() =>
        families.setMembership({ connectionIds: ['c-a', 'ghost'], familyId: f2.id }),
      ).toThrow(NotFoundError);
      expect(familyRepo.findByIdOrThrow(f1.id).memberIds).toEqual(['c-a']);
      expect(familyRepo.findByIdOrThrow(f2.id).memberIds).toEqual([]);
    });

    it('refuses an unknown target Family and leaves everyone where they were', () => {
      const f1 = families.create({ name: 'F1', memberIds: ['c-a'] });
      expect(() => families.setMembership({ connectionIds: ['c-a'], familyId: 'nope' })).toThrow(NotFoundError);
      expect(familyRepo.findByIdOrThrow(f1.id).memberIds).toEqual(['c-a']);
    });

    it('rolls create back when a listed member does not exist', () => {
      expect(() => families.create({ name: 'F', memberIds: ['c-a', 'ghost'] })).toThrow(NotFoundError);
      expect(families.list()).toEqual([]);
    });

    it('leaves with familyId null, and joining the Family it is already in does nothing', () => {
      const f = families.create({ name: 'F', memberIds: ['c-a'] });
      families.setMembership({ connectionIds: ['c-a'], familyId: f.id });
      expect(familyRepo.findByIdOrThrow(f.id).memberIds).toEqual(['c-a']);
      families.setMembership({ connectionIds: ['c-a'], familyId: null });
      expect(familyRepo.findByIdOrThrow(f.id).memberIds).toEqual([]);
    });

    it('shows the Family on the Connection summary query', () => {
      const f = families.create({ name: 'F', memberIds: ['c-a'] });
      const map = new ConnectionRepo(tmp.db).familiesByConnection();
      expect(map.get('c-a')).toEqual({ familyId: f.id, familyName: 'F' });
      expect(map.has('c-b')).toBe(false);
    });
  });

  describe('leaving', () => {
    function setup() {
      const f = families.create({ name: 'F', memberIds: ['c-a', 'c-b'] });
      ruleFor({ familyId: f.id }, 'customer_id');
      ruleFor({ familyId: f.id }, 'agent_id');
      rowSummaries.set({ owner: { familyId: f.id }, dbName: 'shop', collection: 'orders', fields: ['total'] });
      // c-a overrides one shared rule, switching it off, and has a local rule.
      const shared = rulesRepo.listByOwner({ familyId: f.id }).find((r) => r.sourceField === 'customer_id')!;
      rules.override({ connectionId: 'c-a', sharedRuleId: shared.id, patch: { enabled: false } });
      ruleFor({ connectionId: 'c-a' }, 'local_id');
      return f;
    }

    it('with keep, leaves the Connection with the same effective rules it had', () => {
      setup();
      const before = observed('c-a');
      expect(before).toHaveLength(3);
      families.setMembership({ connectionIds: ['c-a'], familyId: null, keepAsLocal: true });
      expect(observed('c-a')).toEqual(before);
      expect(rules.effective('c-a').every((r) => r.origin === 'local')).toBe(true);
      // The Override won: its disabled state was not replaced by a copy of the shared rule.
      expect(rules.effective('c-a').find((r) => r.sourceField === 'customer_id')?.enabled).toBe(false);
      expect(rowSummaries.get({ connectionId: 'c-a', dbName: 'shop', collection: 'orders' })?.origin).toBe('local');
    });

    it('without keep, leaves only the Connection\'s own rules, Overrides turned local', () => {
      setup();
      families.setMembership({ connectionIds: ['c-a'], familyId: null });
      expect(observed('c-a')).toEqual(['customer_id>customers:false', 'local_id>customers:true']);
      expect(rules.effective('c-a').every((r) => r.origin === 'local')).toBe(true);
      expect(rowSummaries.get({ connectionId: 'c-a', dbName: 'shop', collection: 'orders' })).toBeNull();
    });

    it('leaves the other members and the shared rows as they were', () => {
      const f = setup();
      const bBefore = observed('c-b');
      families.setMembership({ connectionIds: ['c-a'], familyId: null, keepAsLocal: true });
      expect(observed('c-b')).toEqual(bBefore);
      expect(rulesRepo.listByOwner({ familyId: f.id })).toHaveLength(2);
    });

    it('keep applies when moving to another Family, and the new Family\'s rules then apply too', () => {
      setup();
      const g = families.create({ name: 'G' });
      ruleFor({ familyId: g.id }, 'g_only');
      families.setMembership({ connectionIds: ['c-a'], familyId: g.id, keepAsLocal: true });
      expect(observed('c-a')).toEqual([
        'agent_id>customers:true',
        'customer_id>customers:false',
        'g_only>customers:true',
        'local_id>customers:true',
      ]);
    });
  });

  describe('deleting', () => {
    function setup() {
      const f = families.create({ name: 'F', memberIds: ['c-a', 'c-b'] });
      ruleFor({ familyId: f.id }, 'customer_id');
      ruleFor({ familyId: f.id }, 'agent_id', { targetCollection: 'agents' });
      rowSummaries.set({ owner: { familyId: f.id }, dbName: 'shop', collection: 'orders', fields: ['total'] });
      const shared = rulesRepo.listByOwner({ familyId: f.id }).find((r) => r.sourceField === 'customer_id')!;
      rules.override({ connectionId: 'c-a', sharedRuleId: shared.id, patch: { targetCollection: 'clients' } });
      return f;
    }

    it('with keep, every member\'s effective rules are unchanged and nobody keeps the Family', () => {
      const f = setup();
      const a = observed('c-a');
      const b = observed('c-b');
      families.delete({ id: f.id, keepAsLocal: true });
      expect(observed('c-a')).toEqual(a);
      expect(observed('c-b')).toEqual(b);
      expect(families.list()).toEqual([]);
      expect(new ConnectionRepo(tmp.db).familiesByConnection().size).toBe(0);
      expect(rowSummaries.get({ connectionId: 'c-b', dbName: 'shop', collection: 'orders' })?.fields).toEqual(['total']);
      // c-a's Override survived untouched.
      expect(a).toContain('customer_id>clients:true');
    });

    it('without keep, members keep only their own rows', () => {
      const f = setup();
      families.delete({ id: f.id, keepAsLocal: false });
      expect(observed('c-a')).toEqual(['customer_id>clients:true']);
      expect(observed('c-b')).toEqual([]);
      expect(rulesRepo.listByOwner({ familyId: f.id })).toEqual([]);
      expect(rowSummaries.get({ connectionId: 'c-b', dbName: 'shop', collection: 'orders' })).toBeNull();
    });

    it('is atomic: a copy that fails leaves the Family and its members in place', () => {
      const f = setup();
      const realInsert = rulesRepo.insert.bind(rulesRepo);
      let calls = 0;
      rulesRepo.insert = (row) => {
        if (++calls === 2) throw new Error('disk full');
        return realInsert(row);
      };
      expect(() => families.delete({ id: f.id, keepAsLocal: true })).toThrow('disk full');
      expect(familyRepo.findByIdOrThrow(f.id).memberIds).toEqual(['c-a', 'c-b']);
      expect(rulesRepo.listByOwner({ connectionId: 'c-b' })).toEqual([]);
    });
  });

  describe('deleting a Connection', () => {
    it('removes only its own rows, never the Family\'s', () => {
      const f = families.create({ name: 'F', memberIds: ['c-a', 'c-b'] });
      ruleFor({ familyId: f.id }, 'customer_id');
      ruleFor({ connectionId: 'c-a' }, 'local_id');
      rowSummaries.set({ owner: { connectionId: 'c-a' }, dbName: 'shop', collection: 'orders', fields: ['x'] });
      rowSummaries.set({ owner: { familyId: f.id }, dbName: 'shop', collection: 'orders', fields: ['y'] });
      new ConnectionRepo(tmp.db).deleteById('c-a');
      expect(rulesRepo.listByOwner({ familyId: f.id })).toHaveLength(1);
      expect(summaryRepo.listByOwner({ familyId: f.id })).toHaveLength(1);
      expect(rulesRepo.listByOwner({ connectionId: 'c-a' })).toEqual([]);
      expect(summaryRepo.listByOwner({ connectionId: 'c-a' })).toEqual([]);
      expect(familyRepo.findByIdOrThrow(f.id).memberIds).toEqual(['c-b']);
    });
  });

  describe('overrides listing', () => {
    it('names, per shared setting, the members that override it, and omits settings nobody overrides', () => {
      const f = families.create({ name: 'F', memberIds: ['c-a', 'c-b', 'c-c'] });
      const r1 = ruleFor({ familyId: f.id }, 'customer_id');
      ruleFor({ familyId: f.id }, 'agent_id');
      rules.override({ connectionId: 'c-b', sharedRuleId: r1.id, patch: { enabled: false } });
      rules.override({ connectionId: 'c-a', sharedRuleId: r1.id, patch: { targetCollection: 'x' } });
      const s = rowSummaries.set({ owner: { familyId: f.id }, dbName: 'shop', collection: 'orders', fields: ['y'] });
      rowSummaries.set({ owner: { connectionId: 'c-c' }, dbName: 'shop', collection: 'orders', fields: ['z'] });
      // A local rule with no shared counterpart is not an Override.
      ruleFor({ connectionId: 'c-c' }, 'local_id');
      expect(families.overrides(f.id)).toEqual({
        rules: [{ ruleId: r1.id, connectionIds: ['c-a', 'c-b'] }],
        rowSummaries: [{ summaryId: s.id, connectionIds: ['c-c'] }],
      });
    });
  });

  describe('Row Summary', () => {
    const key = { dbName: 'shop', collection: 'orders' };

    it('resolves a Connection\'s own over its Family\'s, then clears back to the shared one', () => {
      const f = families.create({ name: 'F', memberIds: ['c-a'] });
      const shared = rowSummaries.set({ owner: { familyId: f.id }, ...key, fields: ['a'] });
      expect(rowSummaries.get({ connectionId: 'c-a', ...key })).toMatchObject({ origin: 'shared', fields: ['a'] });
      const own = rowSummaries.set({ owner: { connectionId: 'c-a' }, ...key, fields: ['b', 'c'] });
      expect(rowSummaries.get({ connectionId: 'c-a', ...key })).toMatchObject({
        origin: 'override',
        sharedId: shared.id,
        fields: ['b', 'c'],
      });
      expect(rowSummaries.set({ owner: { connectionId: 'c-a' }, ...key, fields: ['d'] }).id).toBe(own.id);
      rowSummaries.clear({ owner: { connectionId: 'c-a' }, ...key });
      expect(rowSummaries.get({ connectionId: 'c-a', ...key })?.origin).toBe('shared');
    });

    it('is local without a Family, and null when nothing is saved', () => {
      expect(rowSummaries.get({ connectionId: 'c-b', ...key })).toBeNull();
      rowSummaries.set({ owner: { connectionId: 'c-b' }, ...key, fields: ['a'] });
      expect(rowSummaries.get({ connectionId: 'c-b', ...key })?.origin).toBe('local');
    });

    it('is per Collection', () => {
      rowSummaries.set({ owner: { connectionId: 'c-b' }, ...key, fields: ['a'] });
      expect(rowSummaries.get({ connectionId: 'c-b', dbName: 'shop', collection: 'other' })).toBeNull();
      expect(rowSummaries.get({ connectionId: 'c-b', dbName: 'other', collection: 'orders' })).toBeNull();
    });

    it('refuses fields outside 1 to 4, _id, and duplicates as VALIDATION, saving nothing', () => {
      const owner = { connectionId: 'c-b' };
      for (const fields of [[], ['a', 'b', 'c', 'd', 'e'], ['_id'], ['a', 'a']]) {
        expect(() => rowSummaries.set({ owner, ...key, fields })).toThrow(ValidationError);
      }
      expect(summaryRepo.listByOwner(owner)).toEqual([]);
    });

    it('answers NOT_FOUND for an owner that does not exist, and for clearing nothing', () => {
      expect(() => rowSummaries.set({ owner: { connectionId: 'ghost' }, ...key, fields: ['a'] })).toThrow(NotFoundError);
      expect(() => rowSummaries.set({ owner: { familyId: 'ghost' }, ...key, fields: ['a'] })).toThrow(NotFoundError);
      expect(() => rowSummaries.clear({ owner: { connectionId: 'c-b' }, ...key })).toThrow(NotFoundError);
      expect(() => rowSummaries.get({ connectionId: 'ghost', ...key })).toThrow(NotFoundError);
    });
  });
});
