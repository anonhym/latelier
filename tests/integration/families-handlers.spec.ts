import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { MongoClient } from 'mongodb';
import { IPC_CHANNELS } from '@shared/ipc';
import type {
  ConnectionFamily,
  EffectiveReferenceRule,
  EffectiveRowSummary,
  FamilyOverrides,
  FamilySettings,
  ReferenceRule,
  ReferenceResolveResult,
  RowSummary,
} from '@shared/types';
import { createRouter } from '../../electron/ipc/router';
import { registerRefsChannels } from '../../electron/ipc/handlers/refs';
import { registerFamiliesChannels } from '../../electron/ipc/handlers/families';
import { registerRowSummaryChannels } from '../../electron/ipc/handlers/rowSummary';
import { MongoPool } from '../../electron/mongo/MongoPool';
import { ReferenceRulesRepo } from '../../electron/db/repositories/ReferenceRulesRepo';
import { FamilyRepo } from '../../electron/db/repositories/FamilyRepo';
import { RowSummaryRepo } from '../../electron/db/repositories/RowSummaryRepo';
import { ReferenceRulesService } from '../../electron/services/ReferenceRulesService';
import { FamilyService } from '../../electron/services/FamilyService';
import { RowSummaryService } from '../../electron/services/RowSummaryService';
import { createTempDb, insertConnectionRow, type TempDb } from '../helpers/db';
import { createIpcShim } from '../helpers/ipcShim';
import { testSenderCheck } from '../helpers/ipcSender';
import { getSharedMongoUri, makeConnection, makeReader, uriToHostPort } from '../helpers/mongo';

/**
 * Drives `families:*`, `rowSummary:*` and the Family-aware `refs:*` channels
 * through the real router and zod schemas, a temp SQLite file and a real
 * mongod, so a payload the renderer sends is proven to be one a schema takes
 * and a service refusal is proven to cross as its typed code.
 */
const DB = 'families_router_db';
const A = 'fam-conn-a';
const B = 'fam-conn-b';

describe('families / rowSummary / refs channels via router', () => {
  let tmp: TempDb;
  let pool: MongoPool;
  const shim = createIpcShim();

  async function call<T>(channel: string, payload?: unknown): Promise<T> {
    const env = await shim.invoke<T>(channel, payload);
    if (!env.ok) throw new Error(`${channel} failed: ${env.error.code} ${env.error.message}`);
    return env.data;
  }

  async function code(channel: string, payload?: unknown): Promise<string> {
    const env = await shim.invoke(channel, payload);
    if (env.ok) throw new Error(`${channel} unexpectedly succeeded`);
    return env.error.code;
  }

  beforeAll(async () => {
    const seed = new MongoClient(getSharedMongoUri());
    try {
      await seed.connect();
      await seed.db(DB).collection('customers').deleteMany({});
      await seed.db(DB).collection('customers').insertOne({ _id: 'c1' as never, name: 'Acme' });
    } finally {
      await seed.close();
    }
    tmp = createTempDb();
    insertConnectionRow(tmp.db, A);
    insertConnectionRow(tmp.db, B);
    const hp = uriToHostPort(getSharedMongoUri());
    pool = new MongoPool({
      repo: makeReader([A, B].map((id) => makeConnection(id, hp, { defaultDb: DB }))),
      vault: { get: () => null } as unknown as import('../../electron/secrets/SecretsVault').SecretsVault,
    });
    const router = createRouter(shim.ipcMain, testSenderCheck);
    const rulesRepo = new ReferenceRulesRepo(tmp.db);
    const familyRepo = new FamilyRepo(tmp.db);
    const summaryRepo = new RowSummaryRepo(tmp.db);
    registerRefsChannels(router, new ReferenceRulesService(rulesRepo, pool));
    registerFamiliesChannels(router, new FamilyService(familyRepo, rulesRepo, summaryRepo));
    registerRowSummaryChannels(router, new RowSummaryService(summaryRepo, familyRepo));
  });

  beforeEach(() => {
    tmp.db.prepare('DELETE FROM reference_rules').run();
    tmp.db.prepare('DELETE FROM row_summaries').run();
    tmp.db.prepare('UPDATE connections SET family_id = NULL').run();
    tmp.db.prepare('DELETE FROM connection_families').run();
  });

  afterAll(async () => {
    await pool.disconnectAll();
    tmp.cleanup();
  });

  const sharedRule = (familyId: string, field = 'customer_id') =>
    call<ReferenceRule>(IPC_CHANNELS.refsCreate, {
      owner: { familyId },
      sourceDb: DB,
      sourceCollection: 'orders',
      sourceField: field,
      targetDb: DB,
      targetCollection: 'customers',
    });

  describe('families:*', () => {
    it('creates, lists, renames and deletes a Family', async () => {
      expect(await call<ConnectionFamily[]>(IPC_CHANNELS.familiesList, {})).toEqual([]);
      const f = await call<ConnectionFamily>(IPC_CHANNELS.familiesCreate, { name: ' Acme ', memberIds: [A] });
      expect(f).toMatchObject({ name: 'Acme', memberIds: [A] });
      const renamed = await call<ConnectionFamily>(IPC_CHANNELS.familiesRename, { id: f.id, name: 'Acme Corp' });
      expect(renamed.name).toBe('Acme Corp');
      await call<undefined>(IPC_CHANNELS.familiesDelete, { id: f.id, keepAsLocal: false });
      expect(await call<ConnectionFamily[]>(IPC_CHANNELS.familiesList, {})).toEqual([]);
    });

    it('moves and removes members, returning every Family', async () => {
      const f = await call<ConnectionFamily>(IPC_CHANNELS.familiesCreate, { name: 'F' });
      const joined = await call<ConnectionFamily[]>(IPC_CHANNELS.familiesSetMembership, {
        connectionIds: [A, B],
        familyId: f.id,
      });
      expect(joined[0].memberIds).toEqual([A, B].sort((x, y) => x.localeCompare(y)));
      const left = await call<ConnectionFamily[]>(IPC_CHANNELS.familiesSetMembership, {
        connectionIds: [A],
        familyId: null,
        keepAsLocal: true,
      });
      expect(left[0].memberIds).toEqual([B]);
    });

    it('answers CONFLICT, VALIDATION and NOT_FOUND with their codes', async () => {
      await call(IPC_CHANNELS.familiesCreate, { name: 'Acme' });
      expect(await code(IPC_CHANNELS.familiesCreate, { name: 'ACME' })).toBe('CONFLICT');
      expect(await code(IPC_CHANNELS.familiesCreate, { name: '  ' })).toBe('VALIDATION');
      expect(await code(IPC_CHANNELS.familiesCreate, { name: 'x'.repeat(81) })).toBe('VALIDATION');
      expect(await code(IPC_CHANNELS.familiesRename, { id: 'nope', name: 'x' })).toBe('NOT_FOUND');
      expect(await code(IPC_CHANNELS.familiesDelete, { id: 'nope', keepAsLocal: true })).toBe('NOT_FOUND');
      expect(await code(IPC_CHANNELS.familiesSetMembership, { connectionIds: [A], familyId: 'nope' })).toBe('NOT_FOUND');
      expect(await code(IPC_CHANNELS.familiesOverrides, { id: 'nope' })).toBe('NOT_FOUND');
      expect(await code(IPC_CHANNELS.familiesSettings, { id: 'nope' })).toBe('NOT_FOUND');
    });

    it('refuses malformed payloads with VALIDATION', async () => {
      expect(await code(IPC_CHANNELS.familiesCreate, {})).toBe('VALIDATION');
      expect(await code(IPC_CHANNELS.familiesCreate, { name: 'x', memberIds: [''] })).toBe('VALIDATION');
      expect(await code(IPC_CHANNELS.familiesDelete, { id: 'x' })).toBe('VALIDATION');
      expect(await code(IPC_CHANNELS.familiesSetMembership, { connectionIds: [A] })).toBe('VALIDATION');
      expect(await code(IPC_CHANNELS.familiesList, { extra: 1 })).toBe('VALIDATION');
    });

    it('lists the members that override each shared rule', async () => {
      const f = await call<ConnectionFamily>(IPC_CHANNELS.familiesCreate, { name: 'F', memberIds: [A, B] });
      const shared = await sharedRule(f.id);
      await call(IPC_CHANNELS.refsOverride, { connectionId: B, sharedRuleId: shared.id, patch: { enabled: false } });
      expect(await call<FamilyOverrides>(IPC_CHANNELS.familiesOverrides, { id: f.id })).toEqual({
        rules: [{ ruleId: shared.id, connectionIds: [B] }],
        rowSummaries: [],
      });
    });
  });

  describe('families:settings', () => {
    it('returns what the Family itself owns, whoever overrides it', async () => {
      const f = await call<ConnectionFamily>(IPC_CHANNELS.familiesCreate, { name: 'F', memberIds: [A] });
      const shared = await sharedRule(f.id);
      await call(IPC_CHANNELS.rowSummarySet, { owner: { familyId: f.id }, dbName: DB, collection: 'orders', fields: ['name'] });
      await call(IPC_CHANNELS.refsOverride, { connectionId: A, sharedRuleId: shared.id, patch: { enabled: false } });
      const settings = await call<FamilySettings>(IPC_CHANNELS.familiesSettings, { id: f.id });
      expect(settings.rules.map((r) => r.id)).toEqual([shared.id]);
      expect(settings.rowSummaries.map((r) => r.fields)).toEqual([['name']]);
    });
  });

  describe('refs:* with a Family', () => {
    it('refs:list with effective returns the tagged set, and without it only the Connection\'s own rows', async () => {
      const f = await call<ConnectionFamily>(IPC_CHANNELS.familiesCreate, { name: 'F', memberIds: [A] });
      const shared = await sharedRule(f.id);
      const eff = await call<EffectiveReferenceRule[]>(IPC_CHANNELS.refsList, { connectionId: A, effective: true });
      expect(eff).toHaveLength(1);
      expect(eff[0]).toMatchObject({ id: shared.id, origin: 'shared', owner: { familyId: f.id } });
      expect(await call<ReferenceRule[]>(IPC_CHANNELS.refsList, { connectionId: A })).toEqual([]);
      const narrowed = await call<EffectiveReferenceRule[]>(IPC_CHANNELS.refsList, {
        connectionId: A,
        dbName: DB,
        collection: 'elsewhere',
        effective: true,
      });
      expect(narrowed).toEqual([]);
    });

    it('overrides, resets, and answers the typed refusals', async () => {
      const f = await call<ConnectionFamily>(IPC_CHANNELS.familiesCreate, { name: 'F', memberIds: [A] });
      const shared = await sharedRule(f.id);
      const o = await call<ReferenceRule>(IPC_CHANNELS.refsOverride, {
        connectionId: A,
        sharedRuleId: shared.id,
        patch: { enabled: false },
      });
      expect(o).toMatchObject({ owner: { connectionId: A }, enabled: false });
      expect(await code(IPC_CHANNELS.refsOverride, { connectionId: B, sharedRuleId: shared.id, patch: {} })).toBe('VALIDATION');
      expect(await code(IPC_CHANNELS.refsOverride, { connectionId: A, sharedRuleId: 'nope', patch: {} })).toBe('NOT_FOUND');
      expect(await code(IPC_CHANNELS.refsOverride, { connectionId: A, sharedRuleId: shared.id })).toBe('VALIDATION');
      await call<undefined>(IPC_CHANNELS.refsResetToShared, { id: o.id });
      const eff = await call<EffectiveReferenceRule[]>(IPC_CHANNELS.refsList, { connectionId: A, effective: true });
      expect(eff.map((r) => r.origin)).toEqual(['shared']);
      expect(await code(IPC_CHANNELS.refsResetToShared, { id: shared.id })).toBe('VALIDATION');
      expect(await code(IPC_CHANNELS.refsResetToShared, { id: 'nope' })).toBe('NOT_FOUND');
    });

    it('refs:resolve reads a shared rule through the connection the caller names', async () => {
      const f = await call<ConnectionFamily>(IPC_CHANNELS.familiesCreate, { name: 'F', memberIds: [A] });
      const shared = await sharedRule(f.id);
      const out = await call<ReferenceResolveResult>(IPC_CHANNELS.refsResolve, {
        ruleId: shared.id,
        connectionId: A,
        valueEjson: '"c1"',
      });
      expect(out.found).toBe(true);
      expect(await code(IPC_CHANNELS.refsResolve, { ruleId: shared.id, valueEjson: '"c1"' })).toBe('VALIDATION');
      expect(await code(IPC_CHANNELS.refsResolve, { ruleId: shared.id, connectionId: B, valueEjson: '"c1"' })).toBe('VALIDATION');
    });
  });

  // Each foreign key must name its own entity: an unknown family is never
  // reported as an unknown connection, nor the other way round.
  describe('an unknown owner is named for what it is', () => {
    const message = async (channel: string, payload: unknown): Promise<string> => {
      const env = await shim.invoke(channel, payload);
      if (env.ok) throw new Error(`${channel} unexpectedly succeeded`);
      expect(env.error.code).toBe('NOT_FOUND');
      return env.error.message;
    };
    const rule = (owner: object) => ({
      owner,
      sourceDb: DB,
      sourceCollection: 'orders',
      sourceField: 'f',
      targetDb: DB,
      targetCollection: 'customers',
    });
    const summary = (owner: object) => ({ owner, dbName: DB, collection: 'orders', fields: ['a'] });

    it('refs:create', async () => {
      expect(await message(IPC_CHANNELS.refsCreate, rule({ familyId: 'ghost-fam' }))).toBe('family ghost-fam not found');
      expect(await message(IPC_CHANNELS.refsCreate, rule({ connectionId: 'ghost-conn' }))).toBe('connection ghost-conn not found');
    });

    it('rowSummary:set', async () => {
      expect(await message(IPC_CHANNELS.rowSummarySet, summary({ familyId: 'ghost-fam' }))).toBe('family ghost-fam not found');
      expect(await message(IPC_CHANNELS.rowSummarySet, summary({ connectionId: 'ghost-conn' }))).toBe('connection ghost-conn not found');
    });

    it('families:setMembership and families:create', async () => {
      expect(await message(IPC_CHANNELS.familiesSetMembership, { connectionIds: [A], familyId: 'ghost-fam' })).toBe('family ghost-fam not found');
      const f = await call<ConnectionFamily>(IPC_CHANNELS.familiesCreate, { name: 'F' });
      expect(await message(IPC_CHANNELS.familiesSetMembership, { connectionIds: ['ghost-conn'], familyId: f.id })).toBe('connection ghost-conn not found');
      expect(await message(IPC_CHANNELS.familiesCreate, { name: 'G', memberIds: ['ghost-conn'] })).toBe('connection ghost-conn not found');
    });

    it('refs:override', async () => {
      const f = await call<ConnectionFamily>(IPC_CHANNELS.familiesCreate, { name: 'F', memberIds: [A] });
      const shared = await sharedRule(f.id);
      expect(await message(IPC_CHANNELS.refsOverride, { connectionId: 'ghost-conn', sharedRuleId: shared.id, patch: {} })).toBe('connection ghost-conn not found');
      expect(await message(IPC_CHANNELS.refsOverride, { connectionId: A, sharedRuleId: 'ghost-rule', patch: {} })).toBe('reference rule ghost-rule not found');
    });
  });

  describe('rowSummary:*', () => {
    const key = { dbName: DB, collection: 'orders' };

    it('sets, resolves through the Family, overrides and clears', async () => {
      const f = await call<ConnectionFamily>(IPC_CHANNELS.familiesCreate, { name: 'F', memberIds: [A] });
      const saved = await call<RowSummary>(IPC_CHANNELS.rowSummarySet, { owner: { familyId: f.id }, ...key, fields: ['name', 'total'] });
      expect(saved).toMatchObject({ owner: { familyId: f.id }, fields: ['name', 'total'] });
      expect(await call<EffectiveRowSummary | null>(IPC_CHANNELS.rowSummaryGet, { connectionId: A, ...key })).toMatchObject({
        origin: 'shared',
        fields: ['name', 'total'],
      });
      await call(IPC_CHANNELS.rowSummarySet, { owner: { connectionId: A }, ...key, fields: ['only'] });
      expect(await call<EffectiveRowSummary | null>(IPC_CHANNELS.rowSummaryGet, { connectionId: A, ...key })).toMatchObject({
        origin: 'override',
        sharedId: saved.id,
      });
      await call<undefined>(IPC_CHANNELS.rowSummaryClear, { owner: { connectionId: A }, ...key });
      expect((await call<EffectiveRowSummary | null>(IPC_CHANNELS.rowSummaryGet, { connectionId: A, ...key }))?.origin).toBe('shared');
      expect(await call<EffectiveRowSummary | null>(IPC_CHANNELS.rowSummaryGet, { connectionId: B, ...key })).toBeNull();
    });

    it('answers VALIDATION for an invalid field list or a two-owner payload, and NOT_FOUND for clearing nothing', async () => {
      const owner = { connectionId: A };
      expect(await code(IPC_CHANNELS.rowSummarySet, { owner, ...key, fields: [] })).toBe('VALIDATION');
      expect(await code(IPC_CHANNELS.rowSummarySet, { owner, ...key, fields: ['_id'] })).toBe('VALIDATION');
      expect(await code(IPC_CHANNELS.rowSummarySet, { owner, ...key, fields: ['a', 'a'] })).toBe('VALIDATION');
      expect(await code(IPC_CHANNELS.rowSummarySet, { owner, ...key, fields: ['a', 'b', 'c', 'd', 'e'] })).toBe('VALIDATION');
      expect(await code(IPC_CHANNELS.rowSummarySet, { owner: { connectionId: A, familyId: 'f' }, ...key, fields: ['a'] })).toBe('VALIDATION');
      expect(await code(IPC_CHANNELS.rowSummaryClear, { owner, ...key })).toBe('NOT_FOUND');
      expect(await code(IPC_CHANNELS.rowSummarySet, { owner: { familyId: 'ghost-fam' }, ...key, fields: ['a'] })).toBe('NOT_FOUND');
      expect(await code(IPC_CHANNELS.rowSummaryGet, { connectionId: 'ghost', ...key })).toBe('NOT_FOUND');
    });
  });
});
