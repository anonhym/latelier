import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Database } from 'better-sqlite3';
import { IPC_CHANNELS } from '@shared/ipc';
import type {
  FamilyApplyPlan,
  FamilyApplyResult,
  FamilyExportResult,
  FamilyReadExportResult,
  SettingOwner,
} from '@shared/types';
import { createRouter } from '../../electron/ipc/router';
import { registerFamilyExportChannels } from '../../electron/ipc/handlers/familyExport';
import { FamilyRepo } from '../../electron/db/repositories/FamilyRepo';
import { ReferenceRulesRepo } from '../../electron/db/repositories/ReferenceRulesRepo';
import { RowSummaryRepo } from '../../electron/db/repositories/RowSummaryRepo';
import { FamilyService } from '../../electron/services/FamilyService';
import {
  FamilyExportService,
  TOKEN_TTL_MS,
  type FamilyExportDialogs,
} from '../../electron/services/FamilyExportService';
import { ConflictError, NotFoundError, ValidationError } from '../../electron/errors';
import { EXPORT_FORMAT as CONNECTION_EXPORT_FORMAT } from '../../electron/services/connectionExportFormat';
import { createTempDb, type TempDb } from '../helpers/db';
import { createIpcShim } from '../helpers/ipcShim';
import { testSenderCheck } from '../helpers/ipcSender';

function addConnection(db: Database, id: string, name: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO connections (id, name, connection_type, host, port, auth_mech, created_at, updated_at)
     VALUES (?, ?, 'standard', 'localhost', 27017, 'none', ?, ?)`,
  ).run(id, name, now, now);
}

describe('Family Export', () => {
  let tmp: TempDb;
  let files: string;
  let familyRepo: FamilyRepo;
  let rulesRepo: ReferenceRulesRepo;
  let summaryRepo: RowSummaryRepo;
  let families: FamilyService;
  let svc: FamilyExportService;
  let clock: number;
  let savePath: string | null;
  let openPath: string | null;
  let lastSaveArgs: { name: string; message?: string } | null;

  beforeEach(() => {
    tmp = createTempDb();
    files = fs.mkdtempSync(path.join(tmp.dir, 'files-'));
    addConnection(tmp.db, 'c-a', 'Alpha');
    addConnection(tmp.db, 'c-b', 'Bravo');
    familyRepo = new FamilyRepo(tmp.db);
    rulesRepo = new ReferenceRulesRepo(tmp.db);
    summaryRepo = new RowSummaryRepo(tmp.db);
    families = new FamilyService(familyRepo, rulesRepo, summaryRepo);
    clock = Date.parse('2026-11-18T12:00:00.000Z');
    savePath = null;
    openPath = null;
    lastSaveArgs = null;
    const dialogs: FamilyExportDialogs = {
      savePath: async (name, message) => {
        lastSaveArgs = { name, message };
        return savePath;
      },
      openPath: async () => openPath,
    };
    svc = new FamilyExportService({
      families: familyRepo,
      rules: rulesRepo,
      summaries: summaryRepo,
      dialogs,
      now: () => new Date(clock),
    });
  });
  afterEach(() => tmp.cleanup());

  const addRule = (owner: SettingOwner, field: string, over: { target?: string; enabled?: boolean; projection?: string[] } = {}) =>
    rulesRepo.insert({
      id: `r-${Math.random()}`,
      owner,
      source_db: 'shop',
      source_collection: 'orders',
      source_field: field,
      target_db: 'shop',
      target_collection: over.target ?? 'customers',
      target_field: '_id',
      projection_json: JSON.stringify(over.projection ?? ['name']),
      display_template: null,
      enabled: over.enabled === false ? 0 : 1,
      created_at: 'c',
      updated_at: 'u',
    });
  const addSummary = (owner: SettingOwner, collection: string, fields: string[]) =>
    summaryRepo.upsert({ id: `s-${Math.random()}`, owner, dbName: 'shop', collection, fields, updatedAt: 'u' });

  const rulesOf = (familyId: string) =>
    rulesRepo.listByOwner({ familyId }).map((r) => `${r.sourceField}>${r.targetCollection}:${r.enabled}`);
  const summariesOf = (familyId: string) =>
    summaryRepo.listByOwner({ familyId }).map((s) => `${s.collection}:${s.fields.join(',')}`);

  /** Writes the source family's export and reads it back, returning the token. */
  async function exported(sourceId: string): Promise<string> {
    savePath = path.join(files, 'out.latelier-family.json');
    const saved = await svc.export({ familyId: sourceId });
    expect(saved.saved).toBe(true);
    openPath = savePath;
    const read = await svc.readExport();
    if (read.cancelled) throw new Error('expected a file');
    return read.token;
  }

  const source = () => {
    const f = families.create({ name: 'Source' });
    addRule({ familyId: f.id }, 'customerId');
    addRule({ familyId: f.id }, 'agentId', { target: 'agents', enabled: false });
    addSummary({ familyId: f.id }, 'orders', ['status', 'total']);
    return f;
  };

  describe('export', () => {
    it('writes exactly the shared settings, with no Connection data, and reports counts and path', async () => {
      const f = source();
      addConnection(tmp.db, 'c-s', 'Secret Name');
      families.setMembership({ connectionIds: ['c-s'], familyId: f.id });
      addRule({ connectionId: 'c-s' }, 'localField');
      savePath = path.join(files, 'nested', 'dir', 'out.json');
      const res = (await svc.export({ familyId: f.id })) as Extract<FamilyExportResult, { saved: true }>;
      expect(res).toEqual({ saved: true, path: savePath, ruleCount: 2, rowSummaryCount: 1 });
      const text = fs.readFileSync(savePath, 'utf8');
      const file = JSON.parse(text) as { familyName: string; referenceRules: { sourceField: string }[]; rowSummaries: unknown[]; exportedAt: string };
      expect(file.familyName).toBe('Source');
      expect(file.exportedAt).toBe('2026-11-18T12:00:00.000Z');
      expect(file.referenceRules.map((r) => r.sourceField)).toEqual(['agentId', 'customerId']);
      expect(file.rowSummaries).toHaveLength(1);
      expect(text).not.toMatch(/Secret Name|c-s|localField|localhost/);
      expect(lastSaveArgs).toEqual({ name: 'Source.latelier-family.json', message: undefined });
      expect(fs.readdirSync(path.dirname(savePath))).toEqual(['out.json']);
    });

    it('writes nothing when the dialog is cancelled', async () => {
      const f = source();
      savePath = null;
      expect(await svc.export({ familyId: f.id })).toEqual({ saved: false });
      expect(fs.readdirSync(files)).toEqual([]);
    });

    it('exports an empty file and says so in the dialog', async () => {
      const f = families.create({ name: 'Empty' });
      savePath = path.join(files, 'e.json');
      const res = await svc.export({ familyId: f.id });
      expect(res).toMatchObject({ saved: true, ruleCount: 0, rowSummaryCount: 0 });
      expect(lastSaveArgs?.message).toMatch(/file will be empty/);
      expect(JSON.parse(fs.readFileSync(savePath, 'utf8'))).toMatchObject({ referenceRules: [], rowSummaries: [] });
    });

    it('refuses an unknown family before showing a dialog', async () => {
      await expect(svc.export({ familyId: 'nope' })).rejects.toBeInstanceOf(NotFoundError);
      expect(lastSaveArgs).toBeNull();
    });

    it('reports a failed write as an error and leaves no partial file', async () => {
      const f = source();
      fs.writeFileSync(path.join(files, 'blocker'), 'x');
      savePath = path.join(files, 'blocker', 'out.json');
      await expect(svc.export({ familyId: f.id })).rejects.toMatchObject({ code: 'INTERNAL' });
    });
  });

  describe('export cleanup', () => {
    it('keeps the write error when removing the partial file fails too, and logs the cleanup failure', async () => {
      const warn = vi.fn();
      const logged = new FamilyExportService({
        families: familyRepo,
        rules: rulesRepo,
        summaries: summaryRepo,
        dialogs: { savePath: async () => path.join(files, 'out.json'), openPath: async () => null },
        log: { warn } as never,
      });
      const f = source();
      const write = vi.spyOn(fsp, 'writeFile').mockRejectedValue(new Error('disk full'));
      const rm = vi
        .spyOn(fsp, 'rm')
        .mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EPERM' }));
      try {
        await expect(logged.export({ familyId: f.id })).rejects.toThrow(/disk full/);
        expect(warn).toHaveBeenCalledWith('family-export', expect.any(String), { code: 'EPERM' });
      } finally {
        write.mockRestore();
        rm.mockRestore();
      }
    });
  });

  describe('reading', () => {
    it('cancelled changes nothing', async () => {
      openPath = null;
      expect(await svc.readExport()).toEqual({ cancelled: true });
    });

    it('holds a valid file and reports what it carries', async () => {
      const f = source();
      savePath = path.join(files, 'a.json');
      await svc.export({ familyId: f.id });
      openPath = savePath;
      const read = (await svc.readExport()) as Extract<FamilyReadExportResult, { token: string }>;
      expect(read).toMatchObject({ familyName: 'Source', ruleCount: 2, rowSummaryCount: 1 });
      expect(read.token).toMatch(/\S/);
    });

    it('refuses a Connection Export, malformed JSON and an unreadable file, holding nothing', async () => {
      openPath = path.join(files, 'conn.json');
      fs.writeFileSync(openPath, JSON.stringify({ format: CONNECTION_EXPORT_FORMAT, version: 1 }));
      await expect(svc.readExport()).rejects.toThrow('This is a Connection Export. Use Import in the Connections table.');
      fs.writeFileSync(openPath, '{oops');
      await expect(svc.readExport()).rejects.toBeInstanceOf(ValidationError);
      openPath = path.join(files, 'missing.json');
      const err = await svc.readExport().catch((e: Error) => e);
      expect((err as Error).message).toBe("This file can't be read.");
      expect((err as Error).message).not.toContain(files);
    });

    it('refuses a file over the size limit before reading it', async () => {
      openPath = path.join(files, 'big.json');
      fs.writeFileSync(openPath, Buffer.alloc(5 * 1024 * 1024 + 1, 32));
      await expect(svc.readExport()).rejects.toThrow(/too large/);
    });

    it('drops a token after ten minutes, and refuses an unknown one', async () => {
      const f = source();
      const token = await exported(f.id);
      const target = families.create({ name: 'Target' });
      clock += TOKEN_TTL_MS - 1;
      expect(svc.planApply({ token, target: { familyId: target.id } }).added).toHaveLength(3);
      clock += 1;
      expect(() => svc.planApply({ token, target: { familyId: target.id } })).toThrow(/no longer open/);
      expect(() => svc.planApply({ token: 'bogus', target: { familyId: target.id } })).toThrow(ValidationError);
    });

    it('keeps at most five files open, dropping the oldest', async () => {
      const f = source();
      const first = await exported(f.id);
      for (let i = 0; i < 5; i++) await exported(f.id);
      expect(() => svc.planApply({ token: first, target: { familyId: f.id } })).toThrow(/no longer open/);
    });
  });

  describe('apply', () => {
    it('applies an export onto a second family that has nothing', async () => {
      const src = source();
      const token = await exported(src.id);
      const target = families.create({ name: 'Target' });
      const plan = svc.planApply({ token, target: { familyId: target.id } });
      expect({ a: plan.added.length, u: plan.unchanged.length, c: plan.conflicts.length }).toEqual({ a: 3, u: 0, c: 0 });
      const res = svc.apply({ token, target: { familyId: target.id }, resolutions: {} });
      expect(res).toEqual({ familyId: target.id, added: 3, replaced: 0, kept: 0, unchanged: 0, overriddenBy: [] });
      expect(rulesOf(target.id)).toEqual(rulesOf(src.id));
      expect(summariesOf(target.id)).toEqual(summariesOf(src.id));
      // The disabled flag and projection survive.
      expect(rulesOf(target.id)).toContain('agentId>agents:false');
    });

    it('drops the token after apply', async () => {
      const src = source();
      const token = await exported(src.id);
      const target = families.create({ name: 'Target' });
      svc.apply({ token, target: { familyId: target.id }, resolutions: {} });
      expect(() => svc.planApply({ token, target: { familyId: target.id } })).toThrow(/no longer open/);
    });

    it('applies as a new family named by the caller, taken name refused', async () => {
      const src = source();
      const token = await exported(src.id);
      const res = svc.apply({ token, target: { newName: '  Fresh  ' }, resolutions: {} });
      const created = familyRepo.findByIdOrThrow(res.familyId);
      expect(created.name).toBe('Fresh');
      expect(res.added).toBe(3);
      expect(rulesOf(res.familyId)).toEqual(rulesOf(src.id));

      const token2 = await exported(src.id);
      expect(() => svc.apply({ token: token2, target: { newName: 'fresh' }, resolutions: {} })).toThrow(ConflictError);
      expect(familyRepo.list().map((f) => f.name)).toEqual(['Fresh', 'Source']);
      expect(() => svc.apply({ token: token2, target: { newName: '   ' }, resolutions: {} })).toThrow(ValidationError);
      expect(() => svc.apply({ token: token2, target: { newName: 'x'.repeat(81) }, resolutions: {} })).toThrow(ValidationError);
    });

    it('plans a new family as all added without creating it', async () => {
      const src = source();
      const token = await exported(src.id);
      const plan = svc.planApply({ token, target: { newName: 'Fresh' } });
      expect(plan.added).toHaveLength(3);
      expect(familyRepo.list().map((f) => f.name)).toEqual(['Source']);
    });

    describe('with conflicts', () => {
      let target: { id: string };
      let token: string;
      beforeEach(async () => {
        const src = source();
        token = await exported(src.id);
        target = families.create({ name: 'Target' });
        addRule({ familyId: target.id }, 'customerId', { target: 'clients', projection: ['x'] }); // conflict
        addRule({ familyId: target.id }, 'agentId', { target: 'agents', enabled: false }); // identical
        addRule({ familyId: target.id }, 'onlyHere'); // not in the file
        addSummary({ familyId: target.id }, 'orders', ['other']); // conflict
        addSummary({ familyId: target.id }, 'carts', ['k']); // not in the file
      });
      const T = () => ({ familyId: target.id });
      const keys = () => svc.planApply({ token, target: T() }).conflicts.map((c) => c.key);

      it('plans conflicts with current and incoming side by side', () => {
        const plan = svc.planApply({ token, target: T() });
        expect(plan.conflicts).toHaveLength(2);
        const rule = plan.conflicts.find((c) => c.current.kind === 'rule')!;
        expect(rule.current.detail).toContain('clients');
        expect(rule.incoming.detail).toContain('customers');
        expect(plan.unchanged).toHaveLength(1);
        expect(plan.added).toHaveLength(0);
      });

      it('keep leaves the current, take replaces, nothing is deleted', () => {
        const [a, b] = keys();
        const choices = { [a!]: 'take' as const, [b!]: 'keep' as const };
        const res = svc.apply({ token, target: T(), resolutions: choices });
        expect({ added: res.added, replaced: res.replaced, kept: res.kept, unchanged: res.unchanged }).toEqual({
          added: 0, replaced: 1, kept: 1, unchanged: 1,
        });
        const taken = a!.startsWith('rule:') ? 'rule' : 'summary';
        if (taken === 'rule') {
          expect(rulesOf(target.id)).toContain('customerId>customers:true');
          expect(summariesOf(target.id)).toContain('orders:other');
        } else {
          expect(rulesOf(target.id)).toContain('customerId>clients:true');
          expect(summariesOf(target.id)).toContain('orders:status,total');
        }
        expect(rulesOf(target.id)).toContain('onlyHere>customers:true');
        expect(summariesOf(target.id)).toContain('carts:k');
      });

      it('take on everything makes the target hold every item of the file', () => {
        const resolutions = Object.fromEntries(keys().map((k) => [k, 'take' as const]));
        const res = svc.apply({ token, target: T(), resolutions });
        expect(res).toMatchObject({ replaced: 2, kept: 0, unchanged: 1 });
        expect(rulesOf(target.id)).toEqual(['agentId>agents:false', 'customerId>customers:true', 'onlyHere>customers:true']);
        expect(summariesOf(target.id).sort()).toEqual(['carts:k', 'orders:status,total']);
        expect(rulesRepo.listByOwner(T()).find((r) => r.sourceField === 'customerId')!.projection).toEqual(['name']);
      });

      it('refuses with VALIDATION unless every conflict has a choice, and changes nothing', () => {
        svc.planApply({ token, target: T() });
        const [a] = keys();
        const before = { r: rulesOf(target.id), s: summariesOf(target.id) };
        const err = (() => { try { svc.apply({ token, target: T(), resolutions: { [a!]: 'take' } }); } catch (e) { return e; } })();
        expect(err).toBeInstanceOf(ValidationError);
        expect({ r: rulesOf(target.id), s: summariesOf(target.id) }).toEqual(before);
        // The token survives a refusal, so the user can answer and retry.
        expect(svc.planApply({ token, target: T() }).conflicts).toHaveLength(2);
      });

      it('refuses a take whose current row changed since the plan, and lets a keep through', () => {
        const plan = svc.planApply({ token, target: T() });
        const ruleKey = plan.conflicts.find((c) => c.current.kind === 'rule')!.key;
        const summaryKey = plan.conflicts.find((c) => c.current.kind === 'rowSummary')!.key;
        const current = rulesRepo.listByOwner(T()).find((r) => r.sourceField === 'customerId')!;
        rulesRepo.update(current.id, { projection_json: JSON.stringify(['edited-meanwhile']), updated_at: new Date().toISOString() });
        const before = { r: rulesOf(target.id), s: summariesOf(target.id) };

        expect(() =>
          svc.apply({ token, target: T(), resolutions: { [ruleKey]: 'take', [summaryKey]: 'take' } }),
        ).toThrow(ConflictError);
        expect({ r: rulesOf(target.id), s: summariesOf(target.id) }).toEqual(before);

        const kept = svc.apply({ token, target: T(), resolutions: { [ruleKey]: 'keep', [summaryKey]: 'take' } });
        expect(kept).toMatchObject({ kept: 1, replaced: 1 });
      });

      it('refuses with VALIDATION when apply is called without a plan and a conflict has no choice', () => {
        expect(() => svc.apply({ token, target: T(), resolutions: {} })).toThrow(ValidationError);
      });

      it('ignores a choice for a key that is no longer a conflict', () => {
        const resolutions: Record<string, 'keep' | 'take'> = Object.fromEntries(keys().map((k) => [k, 'keep' as const]));
        resolutions['rule:["shop","orders","nothing"]'] = 'take';
        expect(svc.apply({ token, target: T(), resolutions }).kept).toBe(2);
      });
    });

    it('refuses with CONFLICT when a conflict appears after the plan, and changes nothing', async () => {
      const src = source();
      const token = await exported(src.id);
      const target = families.create({ name: 'Target' });
      const plan = svc.planApply({ token, target: { familyId: target.id } });
      expect(plan.conflicts).toEqual([]);
      addRule({ familyId: target.id }, 'customerId', { target: 'clients' });
      const err = (() => { try { svc.apply({ token, target: { familyId: target.id }, resolutions: {} }); } catch (e) { return e; } })();
      expect(err).toBeInstanceOf(ConflictError);
      expect(rulesOf(target.id)).toEqual(['customerId>clients:true']);
      expect(summariesOf(target.id)).toEqual([]);
      // Plan again and the conflict is there to answer.
      const again = svc.planApply({ token, target: { familyId: target.id } });
      const resolutions = Object.fromEntries(again.conflicts.map((c) => [c.key, 'take' as const]));
      expect(svc.apply({ token, target: { familyId: target.id }, resolutions }).replaced).toBe(1);
    });

    it('fails as NOT_FOUND when the target family is gone, at plan and at apply', async () => {
      const src = source();
      const token = await exported(src.id);
      const target = families.create({ name: 'Target' });
      families.delete({ id: target.id, keepAsLocal: false });
      expect(() => svc.planApply({ token, target: { familyId: target.id } })).toThrow(NotFoundError);
      expect(() => svc.apply({ token, target: { familyId: target.id }, resolutions: {} })).toThrow(NotFoundError);
    });

    it('applying the same file twice is a no-op the second time', async () => {
      const src = source();
      const target = families.create({ name: 'Target' });
      const token = await exported(src.id);
      svc.apply({ token, target: { familyId: target.id }, resolutions: {} });
      const snapshot = rulesRepo.listByOwner({ familyId: target.id }).map((r) => ({ ...r, id: '' }));
      const again = await exported(src.id);
      const plan = svc.planApply({ token: again, target: { familyId: target.id } });
      expect({ a: plan.added.length, c: plan.conflicts.length, u: plan.unchanged.length }).toEqual({ a: 0, c: 0, u: 3 });
      const res = svc.apply({ token: again, target: { familyId: target.id }, resolutions: {} });
      expect(res).toMatchObject({ added: 0, replaced: 0, kept: 0, unchanged: 3, overriddenBy: [] });
      expect(rulesRepo.listByOwner({ familyId: target.id }).map((r) => ({ ...r, id: '' }))).toEqual(snapshot);
    });

    it('rolls back everything, a new family included, when a write fails', async () => {
      const src = source();
      const token = await exported(src.id);
      const real = rulesRepo.insert.bind(rulesRepo);
      let calls = 0;
      const spy = vi.spyOn(rulesRepo, 'insert').mockImplementation((row) => {
        calls += 1;
        if (calls === 2) throw new Error('disk full');
        return real(row);
      });
      expect(() => svc.apply({ token, target: { newName: 'Fresh' }, resolutions: {} })).toThrow('disk full');
      spy.mockRestore();
      expect(familyRepo.list().map((f) => f.name)).toEqual(['Source']);
      expect(tmp.db.prepare('SELECT COUNT(*) AS n FROM reference_rules').get()).toEqual({ n: 2 });
      // The file is still held: the user can try again.
      expect(svc.apply({ token, target: { newName: 'Fresh' }, resolutions: {} }).added).toBe(3);
    });

    it('rolls back replaced rows too when a later write fails', async () => {
      const src = source();
      const token = await exported(src.id);
      const target = families.create({ name: 'Target' });
      addRule({ familyId: target.id }, 'customerId', { target: 'clients' });
      const plan = svc.planApply({ token, target: { familyId: target.id } });
      const resolutions = Object.fromEntries(plan.conflicts.map((c) => [c.key, 'take' as const]));
      const spy = vi.spyOn(summaryRepo, 'upsert').mockImplementation(() => { throw new Error('boom'); });
      expect(() => svc.apply({ token, target: { familyId: target.id }, resolutions })).toThrow('boom');
      spy.mockRestore();
      expect(rulesOf(target.id)).toEqual(['customerId>clients:true']);
    });
  });

  describe('Overrides', () => {
    it('leaves members untouched and reports the ones hiding something the apply brought in', async () => {
      const src = source();
      const target = families.create({ name: 'Target', memberIds: ['c-a', 'c-b'] });
      addRule({ connectionId: 'c-a' }, 'customerId', { target: 'mine' }); // overrides an added rule
      addSummary({ connectionId: 'c-a' }, 'orders', ['mine']); // overrides an added summary
      addRule({ connectionId: 'c-b' }, 'localOnly'); // not an override
      const before = {
        a: rulesRepo.listByOwner({ connectionId: 'c-a' }),
        b: rulesRepo.listByOwner({ connectionId: 'c-b' }),
        as: summaryRepo.listByOwner({ connectionId: 'c-a' }),
      };
      const token = await exported(src.id);
      const res = svc.apply({ token, target: { familyId: target.id }, resolutions: {} });
      expect(res.overriddenBy).toHaveLength(1);
      expect(res.overriddenBy[0]!.connectionId).toBe('c-a');
      expect(res.overriddenBy[0]!.keys.sort()).toEqual(res.overriddenBy[0]!.items.map((i) => i.key).sort());
      expect(res.overriddenBy[0]!.items.map((i) => i.kind).sort()).toEqual(['rowSummary', 'rule']);
      expect({
        a: rulesRepo.listByOwner({ connectionId: 'c-a' }),
        b: rulesRepo.listByOwner({ connectionId: 'c-b' }),
        as: summaryRepo.listByOwner({ connectionId: 'c-a' }),
      }).toEqual(before);
    });

    it('does not report an override of something the apply left alone', async () => {
      const src = source();
      const target = families.create({ name: 'Target', memberIds: ['c-a'] });
      addRule({ familyId: target.id }, 'customerId', { target: 'clients' });
      addRule({ connectionId: 'c-a' }, 'customerId', { target: 'mine' });
      const token = await exported(src.id);
      const plan = svc.planApply({ token, target: { familyId: target.id } });
      const resolutions = Object.fromEntries(plan.conflicts.map((c) => [c.key, 'keep' as const]));
      const res = svc.apply({ token, target: { familyId: target.id }, resolutions });
      expect(res.overriddenBy).toEqual([]);
    });

    it('reports a replaced item a member overrides', async () => {
      const src = source();
      const target = families.create({ name: 'Target', memberIds: ['c-a'] });
      addRule({ familyId: target.id }, 'customerId', { target: 'clients' });
      addRule({ connectionId: 'c-a' }, 'customerId', { target: 'mine' });
      const token = await exported(src.id);
      const plan = svc.planApply({ token, target: { familyId: target.id } });
      const resolutions = Object.fromEntries(plan.conflicts.map((c) => [c.key, 'take' as const]));
      const res = svc.apply({ token, target: { familyId: target.id }, resolutions });
      expect(res.overriddenBy.map((o) => o.connectionId)).toEqual(['c-a']);
      expect(res.overriddenBy[0]!.items.map((i) => i.field)).toEqual(['customerId']);
    });
  });
});

describe('families:* export channels through the router', () => {
  let tmp: TempDb;
  const shim = createIpcShim();
  let open: string | null = null;

  beforeEach(() => {
    tmp = createTempDb();
    const familyRepo = new FamilyRepo(tmp.db);
    const router = createRouter(shim.ipcMain as never, testSenderCheck);
    registerFamilyExportChannels(
      router,
      new FamilyExportService({
        families: familyRepo,
        rules: new ReferenceRulesRepo(tmp.db),
        summaries: new RowSummaryRepo(tmp.db),
        dialogs: { savePath: async () => path.join(tmp.dir, 'x.json'), openPath: async () => open },
      }),
    );
    familyRepo.insert({ id: 'f1', name: 'One', created_at: 'c', updated_at: 'u' });
  });
  afterEach(() => tmp.cleanup());

  it('takes the renderer payloads and returns typed refusals', async () => {
    const saved = await shim.invoke<FamilyExportResult>(IPC_CHANNELS.familiesExport, { familyId: 'f1' });
    expect(saved).toMatchObject({ ok: true, data: { saved: true } });
    open = path.join(tmp.dir, 'x.json');
    const read = await shim.invoke<FamilyReadExportResult>(IPC_CHANNELS.familiesReadExport, {});
    if (!read.ok || read.data.cancelled) throw new Error('expected a token');
    const { token } = read.data;
    const plan = await shim.invoke<FamilyApplyPlan>(IPC_CHANNELS.familiesPlanApply, { token, target: { newName: 'Two' } });
    expect(plan).toMatchObject({ ok: true, data: { added: [], conflicts: [] } });
    const applied = await shim.invoke<FamilyApplyResult>(IPC_CHANNELS.familiesApply, { token, target: { newName: 'Two' }, resolutions: {} });
    expect(applied).toMatchObject({ ok: true, data: { added: 0 } });

    const bad = await shim.invoke(IPC_CHANNELS.familiesApply, { token, target: { familyId: 'f1' }, resolutions: { k: 'maybe' } });
    expect(bad).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    const both = await shim.invoke(IPC_CHANNELS.familiesPlanApply, { token, target: { familyId: 'f1', newName: 'x' } });
    expect(both).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    const gone = await shim.invoke(IPC_CHANNELS.familiesExport, { familyId: 'nope' });
    expect(gone).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    const extra = await shim.invoke(IPC_CHANNELS.familiesReadExport, { path: '/etc/passwd' });
    expect(extra).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });
});
