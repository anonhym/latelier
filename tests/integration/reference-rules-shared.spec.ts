import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { MongoClient } from 'mongodb';
import type { SettingOwner } from '@shared/types';
import { MongoPool } from '../../electron/mongo/MongoPool';
import { ReferenceRulesRepo } from '../../electron/db/repositories/ReferenceRulesRepo';
import { FamilyRepo } from '../../electron/db/repositories/FamilyRepo';
import { RowSummaryRepo } from '../../electron/db/repositories/RowSummaryRepo';
import { FamilyService } from '../../electron/services/FamilyService';
import { ReferenceRulesService } from '../../electron/services/ReferenceRulesService';
import { NotFoundError, ValidationError } from '../../electron/errors';
import { createTempDb, type TempDb } from '../helpers/db';
import { getSharedMongoUri, makeConnection, makeReader, uriToHostPort } from '../helpers/mongo';

const DB = 'refs_shared_db';

// Two members that both reach the one test server, and a third that is no one's member.
const MEMBER_A = 'shared-a';
const MEMBER_B = 'shared-b';
const OUTSIDER = 'shared-out';

function addConnection(tmp: TempDb, id: string, name: string): void {
  const now = new Date().toISOString();
  tmp.db
    .prepare(
      `INSERT INTO connections (id, name, connection_type, host, port, auth_mech, created_at, updated_at)
       VALUES (?, ?, 'standard', 'localhost', 27017, 'none', ?, ?)`,
    )
    .run(id, name, now, now);
}

describe('Reference Rules shared through a Family', () => {
  let pool: MongoPool;
  let tmp: TempDb;
  let svc: ReferenceRulesService;
  let families: FamilyService;
  let familyId: string;

  beforeAll(async () => {
    const hp = uriToHostPort(getSharedMongoUri());
    pool = new MongoPool({
      repo: makeReader([MEMBER_A, MEMBER_B, OUTSIDER].map((id) => makeConnection(id, hp, { defaultDb: DB }))),
      vault: { get: () => null } as unknown as import('../../electron/secrets/SecretsVault').SecretsVault,
    });
    const seed = new MongoClient(getSharedMongoUri());
    try {
      await seed.connect();
      await seed.db(DB).collection('customers').deleteMany({});
      await seed.db(DB).collection('clients').deleteMany({});
      await seed.db(DB).collection('customers').insertOne({ _id: 'c1' as never, name: 'from customers' });
      await seed.db(DB).collection('clients').insertOne({ _id: 'c1' as never, name: 'from clients' });
    } finally {
      await seed.close();
    }
  });

  beforeEach(() => {
    tmp = createTempDb();
    addConnection(tmp, MEMBER_A, 'A');
    addConnection(tmp, MEMBER_B, 'B');
    addConnection(tmp, OUTSIDER, 'Out');
    const rulesRepo = new ReferenceRulesRepo(tmp.db);
    const familyRepo = new FamilyRepo(tmp.db);
    svc = new ReferenceRulesService(rulesRepo, pool);
    families = new FamilyService(familyRepo, rulesRepo, new RowSummaryRepo(tmp.db));
    familyId = families.create({ name: 'Fam', memberIds: [MEMBER_A, MEMBER_B] }).id;
  });

  afterAll(async () => {
    await pool.disconnectAll();
  });

  const create = (owner: SettingOwner, field: string, targetCollection = 'customers') =>
    svc.create({
      owner,
      sourceDb: DB,
      sourceCollection: 'orders',
      sourceField: field,
      targetDb: DB,
      targetCollection,
    });

  describe('effective', () => {
    it('reads the Connection\'s own rules plus the Family\'s, tagging where each came from', () => {
      const shared = create({ familyId }, 'customer_id');
      create({ familyId }, 'agent_id');
      const own = create({ connectionId: MEMBER_A }, 'customer_id', 'clients');
      const local = create({ connectionId: MEMBER_A }, 'note_id');

      const a = svc.effective(MEMBER_A);
      expect(a.map((r) => [r.sourceField, r.origin])).toEqual([
        ['agent_id', 'shared'],
        ['customer_id', 'override'],
        ['note_id', 'local'],
      ]);
      expect(a.find((r) => r.origin === 'override')).toMatchObject({ id: own.id, sharedRuleId: shared.id });
      expect(a.find((r) => r.origin === 'local')?.id).toBe(local.id);

      // The other member sees only the shared rules.
      expect(svc.effective(MEMBER_B).map((r) => [r.sourceField, r.origin])).toEqual([
        ['agent_id', 'shared'],
        ['customer_id', 'shared'],
      ]);
    });

    it('gives a Connection outside the Family none of the shared rules', () => {
      create({ familyId }, 'customer_id');
      expect(svc.effective(OUTSIDER)).toEqual([]);
    });

    it('narrows to one Collection when both names are given', () => {
      create({ familyId }, 'customer_id');
      svc.create({
        owner: { familyId },
        sourceDb: DB,
        sourceCollection: 'invoices',
        sourceField: 'customer_id',
        targetDb: DB,
        targetCollection: 'customers',
      });
      expect(svc.effective(MEMBER_B, DB, 'invoices').map((r) => r.sourceCollection)).toEqual(['invoices']);
      expect(svc.effective(MEMBER_B)).toHaveLength(2);
    });

    it('leaves list() to the Connection\'s own rules', () => {
      create({ familyId }, 'customer_id');
      create({ connectionId: MEMBER_A }, 'note_id');
      expect(svc.list(MEMBER_A).map((r) => r.sourceField)).toEqual(['note_id']);
      expect(svc.listForCollection(MEMBER_A, DB, 'orders').map((r) => r.sourceField)).toEqual(['note_id']);
    });

    it('keeps a disabled Override in the set, which hides the shared rule on that Connection only', () => {
      const shared = create({ familyId }, 'customer_id');
      svc.override({ connectionId: MEMBER_A, sharedRuleId: shared.id, patch: { enabled: false } });
      const a = svc.effective(MEMBER_A);
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ origin: 'override', enabled: false });
      expect(svc.effective(MEMBER_B)[0]).toMatchObject({ origin: 'shared', enabled: true });
    });
  });

  describe('override', () => {
    it('copies the shared rule onto the Connection with the patch applied', () => {
      const shared = svc.create({
        owner: { familyId },
        sourceDb: DB,
        sourceCollection: 'orders',
        sourceField: 'customer_id',
        targetDb: DB,
        targetCollection: 'customers',
        projection: ['name'],
        displayTemplate: '{name}',
      });
      const o = svc.override({ connectionId: MEMBER_A, sharedRuleId: shared.id, patch: { targetCollection: 'clients' } });
      expect(o).toMatchObject({
        owner: { connectionId: MEMBER_A },
        sourceField: 'customer_id',
        targetCollection: 'clients',
        projection: ['name'],
        displayTemplate: '{name}',
        enabled: true,
      });
      expect(o.id).not.toBe(shared.id);
      // The shared rule itself is untouched.
      expect(svc.get(shared.id).targetCollection).toBe('customers');
    });

    it('stores a cleared display template on a new Override as none, as an update does', () => {
      const shared = svc.create({
        owner: { familyId },
        sourceDb: DB,
        sourceCollection: 'orders',
        sourceField: 'customer_id',
        targetDb: DB,
        targetCollection: 'customers',
        displayTemplate: '{name}',
      });
      const o = svc.override({ connectionId: MEMBER_A, sharedRuleId: shared.id, patch: { displayTemplate: '' } });
      expect(o.displayTemplate).toBeUndefined();
    });

    it('updates the existing Override when asked again for the same rule', () => {
      const shared = create({ familyId }, 'customer_id');
      const first = svc.override({ connectionId: MEMBER_A, sharedRuleId: shared.id, patch: { enabled: false } });
      const second = svc.override({ connectionId: MEMBER_A, sharedRuleId: shared.id, patch: { targetCollection: 'clients' } });
      expect(second.id).toBe(first.id);
      expect(second).toMatchObject({ enabled: false, targetCollection: 'clients' });
      expect(svc.list(MEMBER_A)).toHaveLength(1);
    });

    it('refuses a shared rule from another Family as VALIDATION', () => {
      const other = families.create({ name: 'Other' }).id;
      const foreign = create({ familyId: other }, 'customer_id');
      expect(() => svc.override({ connectionId: MEMBER_A, sharedRuleId: foreign.id, patch: {} })).toThrow(ValidationError);
      expect(() => svc.override({ connectionId: OUTSIDER, sharedRuleId: create({ familyId }, 'x').id, patch: {} })).toThrow(ValidationError);
      expect(svc.list(MEMBER_A)).toEqual([]);
    });

    it('refuses a Connection-owned rule as the target, and answers NOT_FOUND for unknown ids', () => {
      const own = create({ connectionId: MEMBER_A }, 'customer_id');
      expect(() => svc.override({ connectionId: MEMBER_A, sharedRuleId: own.id, patch: {} })).toThrow(ValidationError);
      expect(() => svc.override({ connectionId: MEMBER_A, sharedRuleId: 'nope', patch: {} })).toThrow(NotFoundError);
      const shared = create({ familyId }, 'agent_id');
      expect(() => svc.override({ connectionId: 'ghost', sharedRuleId: shared.id, patch: {} })).toThrow(NotFoundError);
    });
  });

  describe('resetToShared', () => {
    it('deletes the Override so the shared rule takes over again', () => {
      const shared = create({ familyId }, 'customer_id');
      const o = svc.override({ connectionId: MEMBER_A, sharedRuleId: shared.id, patch: { enabled: false } });
      svc.resetToShared(o.id);
      expect(svc.effective(MEMBER_A).map((r) => [r.id, r.origin])).toEqual([[shared.id, 'shared']]);
    });

    it('refuses a local rule, a shared rule, and a Connection outside any Family as VALIDATION', () => {
      const shared = create({ familyId }, 'customer_id');
      const local = create({ connectionId: MEMBER_A }, 'note_id');
      const outsider = create({ connectionId: OUTSIDER }, 'customer_id');
      expect(() => svc.resetToShared(local.id)).toThrow(ValidationError);
      expect(() => svc.resetToShared(shared.id)).toThrow(ValidationError);
      expect(() => svc.resetToShared(outsider.id)).toThrow(ValidationError);
      expect(svc.get(local.id).id).toBe(local.id);
      expect(() => svc.resetToShared('nope')).toThrow(NotFoundError);
    });
  });

  describe('resolve', () => {
    const value = '"c1"';

    it('reads a shared rule through the Connection it is asked on', async () => {
      const shared = create({ familyId }, 'customer_id');
      const result = await svc.resolve({ ruleId: shared.id, connectionId: MEMBER_B, valueEjson: value });
      expect(result).toMatchObject({ ruleId: shared.id, found: true });
      expect((result.documents[0] as { name: string }).name).toBe('from customers');
    });

    it('lets an Override stand in for the shared rule it replaces, answering under the shared rule\'s id', async () => {
      const shared = create({ familyId }, 'customer_id');
      svc.override({ connectionId: MEMBER_A, sharedRuleId: shared.id, patch: { targetCollection: 'clients' } });
      const onA = await svc.resolve({ ruleId: shared.id, connectionId: MEMBER_A, valueEjson: value });
      const onB = await svc.resolve({ ruleId: shared.id, connectionId: MEMBER_B, valueEjson: value });
      expect(onA.ruleId).toBe(shared.id);
      expect((onA.documents[0] as { name: string }).name).toBe('from clients');
      expect((onB.documents[0] as { name: string }).name).toBe('from customers');
    });

    it('requires a Connection for a shared rule, and that it be a member', async () => {
      const shared = create({ familyId }, 'customer_id');
      await expect(svc.resolve({ ruleId: shared.id, valueEjson: value })).rejects.toThrow(ValidationError);
      await expect(svc.resolve({ ruleId: shared.id, connectionId: OUTSIDER, valueEjson: value })).rejects.toThrow(ValidationError);
    });

    it('still resolves a Connection-owned rule with no connectionId, and refuses another Connection', async () => {
      const own = create({ connectionId: MEMBER_A }, 'customer_id');
      const result = await svc.resolve({ ruleId: own.id, valueEjson: value });
      expect(result.found).toBe(true);
      await expect(svc.resolve({ ruleId: own.id, connectionId: MEMBER_A, valueEjson: value })).resolves.toMatchObject({ found: true });
      await expect(svc.resolve({ ruleId: own.id, connectionId: MEMBER_B, valueEjson: value })).rejects.toThrow(ValidationError);
    });
  });

  describe('autodetect', () => {
    it('counts a shared rule as already configured', async () => {
      create({ familyId }, 'customer_id');
      const out = await svc.autodetect({
        connectionId: MEMBER_B,
        dbName: DB,
        collection: 'orders',
        sampleDocs: [{ customer_id: 'c1' }],
      });
      expect(out.find((c) => c.sourceField === 'customer_id')?.alreadyConfigured).toBe(true);
      const outsider = await svc.autodetect({
        connectionId: OUTSIDER,
        dbName: DB,
        collection: 'orders',
        sampleDocs: [{ customer_id: 'c1' }],
      });
      expect(outsider.find((c) => c.sourceField === 'customer_id')?.alreadyConfigured).toBe(false);
    });
  });
});
