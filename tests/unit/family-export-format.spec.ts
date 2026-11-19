import { describe, it, expect } from 'vitest';
import type { FamilySettings, ReferenceRule, RowSummary } from '@shared/types';
import { ValidationError } from '../../electron/errors';
import {
  FAMILY_EXPORT_FORMAT,
  FAMILY_EXPORT_MAX_BYTES,
  familyFileName,
  parseFamilyExport,
  writeFamilyExport,
} from '../../electron/services/familyExportFormat';
import { EXPORT_FORMAT as CONNECTION_EXPORT_FORMAT } from '../../electron/services/connectionExportFormat';

const NOW = new Date('2026-11-18T12:00:00.000Z');

const rule = (over: Partial<ReferenceRule> = {}): ReferenceRule => ({
  id: 'r1',
  owner: { familyId: 'f1' },
  sourceDb: 'shop',
  sourceCollection: 'orders',
  sourceField: 'customerId',
  targetDb: 'shop',
  targetCollection: 'customers',
  targetField: '_id',
  projection: ['name', 'email'],
  displayTemplate: '{name}',
  enabled: true,
  createdAt: 'c',
  updatedAt: 'u',
  ...over,
});

const summary = (over: Partial<RowSummary> = {}): RowSummary => ({
  id: 's1',
  owner: { familyId: 'f1' },
  dbName: 'shop',
  collection: 'orders',
  fields: ['status', 'total'],
  updatedAt: 'u',
  ...over,
});

const written = (settings: FamilySettings, familyName = 'Client deployments') =>
  writeFamilyExport({ familyName, settings, now: NOW });

const valid = () => JSON.parse(written({ rules: [rule()], rowSummaries: [summary()] })) as Record<string, unknown>;

function refusal(text: string): string {
  try {
    parseFamilyExport(text);
  } catch (err) {
    expect(err).toBeInstanceOf(ValidationError);
    return (err as Error).message;
  }
  throw new Error('expected the file to be refused');
}

describe('writeFamilyExport', () => {
  it('writes the documented shape with no ids, timestamps per item or owners', () => {
    const file = valid();
    expect(file).toEqual({
      format: 'latelier-family-export',
      version: 1,
      exportedAt: '2026-11-18T12:00:00.000Z',
      familyName: 'Client deployments',
      referenceRules: [
        {
          sourceDb: 'shop',
          sourceCollection: 'orders',
          sourceField: 'customerId',
          targetDb: 'shop',
          targetCollection: 'customers',
          targetField: '_id',
          projection: ['name', 'email'],
          displayTemplate: '{name}',
          enabled: true,
        },
      ],
      rowSummaries: [{ dbName: 'shop', collection: 'orders', fields: ['status', 'total'] }],
    });
  });

  it('leaves displayTemplate out when the rule has none', () => {
    const file = JSON.parse(written({ rules: [rule({ displayTemplate: undefined })], rowSummaries: [] })) as {
      referenceRules: Record<string, unknown>[];
    };
    expect('displayTemplate' in file.referenceRules[0]!).toBe(false);
  });

  it('orders items by key so the same settings write the same bytes', () => {
    const a = rule({ id: 'a', sourceField: 'b_id' });
    const b = rule({ id: 'b', sourceField: 'a_id' });
    expect(written({ rules: [a, b], rowSummaries: [] })).toBe(written({ rules: [b, a], rowSummaries: [] }));
    const s1 = summary({ collection: 'x' });
    const s2 = summary({ collection: 'a' });
    expect(written({ rules: [], rowSummaries: [s1, s2] })).toBe(written({ rules: [], rowSummaries: [s2, s1] }));
    const out = JSON.parse(written({ rules: [], rowSummaries: [s1, s2] })) as {
      rowSummaries: { collection: string }[];
    };
    expect(out.rowSummaries.map((s) => s.collection)).toEqual(['a', 'x']);
  });

  it('writes an empty file for a family that shares nothing, and reads it back', () => {
    const file = parseFamilyExport(written({ rules: [], rowSummaries: [] }));
    expect(file.referenceRules).toEqual([]);
    expect(file.rowSummaries).toEqual([]);
  });

  it('carries nothing of a Connection', () => {
    const text = written({ rules: [rule()], rowSummaries: [summary()] });
    expect(text).not.toMatch(/connectionId|uri|password|"id"|createdAt|updatedAt|owner/i);
  });
});

describe('parseFamilyExport', () => {
  it('round-trips a written file', () => {
    const file = parseFamilyExport(written({ rules: [rule()], rowSummaries: [summary()] }));
    expect(file.familyName).toBe('Client deployments');
    expect(file.referenceRules).toEqual([
      {
        sourceDb: 'shop',
        sourceCollection: 'orders',
        sourceField: 'customerId',
        targetDb: 'shop',
        targetCollection: 'customers',
        targetField: '_id',
        projection: ['name', 'email'],
        displayTemplate: '{name}',
        enabled: true,
      },
    ]);
    expect(file.rowSummaries).toEqual([{ dbName: 'shop', collection: 'orders', fields: ['status', 'total'] }]);
  });

  it('refuses malformed JSON', () => {
    expect(refusal('{not json')).toMatch(/isn't a JSON file/);
  });

  it.each([['[]'], ['null'], ['"text"'], ['42']])('refuses %s as not a Family Export', (text) => {
    expect(refusal(text)).toMatch(/isn't a L'Atelier Family Export/);
  });

  it('names a Connection Export and says where it goes', () => {
    const msg = refusal(JSON.stringify({ format: CONNECTION_EXPORT_FORMAT, version: 1, connections: [] }));
    expect(msg).toBe('This is a Connection Export. Use Import in the Connections table.');
  });

  it('refuses any other format', () => {
    expect(refusal(JSON.stringify({ format: 'something-else', version: 1 }))).toMatch(
      /isn't a L'Atelier Family Export/,
    );
    expect(refusal(JSON.stringify({ version: 1 }))).toMatch(/isn't a L'Atelier Family Export/);
  });

  it('refuses a newer version by saying to update, and an unknown one by saying so', () => {
    expect(refusal(JSON.stringify({ ...valid(), version: 2 }))).toMatch(/newer version/);
    expect(refusal(JSON.stringify({ ...valid(), version: 0 }))).toMatch(/version .* doesn't know/);
    expect(refusal(JSON.stringify({ ...valid(), version: '1' }))).toMatch(/version .* doesn't know/);
    expect(refusal(JSON.stringify({ ...valid(), version: '2' }))).toMatch(/version .* doesn't know/);
  });

  it('refuses an unknown field, in the file and in an item', () => {
    const root = refusal(JSON.stringify({ ...valid(), connections: [] }));
    expect(root).toMatch(/^This Family Export is damaged: /);
    expect(root).not.toContain(' at ');
    const f = valid();
    (f.referenceRules as Record<string, unknown>[])[0]!.connectionId = 'c1';
    expect(refusal(JSON.stringify(f))).toMatch(/damaged at referenceRules\.0/);
  });

  it('refuses a missing or wrongly typed field and says where', () => {
    const f = valid();
    delete (f.referenceRules as Record<string, unknown>[])[0]!.targetCollection;
    expect(refusal(JSON.stringify(f))).toMatch(/damaged at referenceRules\.0\.targetCollection/);
    const g = valid();
    (g.referenceRules as Record<string, unknown>[])[0]!.enabled = 'yes';
    expect(refusal(JSON.stringify(g))).toMatch(/damaged at referenceRules\.0\.enabled/);
  });

  it('refuses an empty family name, and trims the name it keeps', () => {
    expect(refusal(JSON.stringify({ ...valid(), familyName: '   ' }))).toMatch(/damaged at familyName/);
    expect(parseFamilyExport(JSON.stringify({ ...valid(), familyName: '  Acme ' })).familyName).toBe('Acme');
  });

  it('refuses a rule key that appears twice', () => {
    const f = valid();
    const r = (f.referenceRules as Record<string, unknown>[])[0]!;
    f.referenceRules = [r, { ...r, targetCollection: 'other' }];
    expect(refusal(JSON.stringify(f))).toMatch(/same reference rule appears twice/);
  });

  it('refuses a Row Summary key that appears twice', () => {
    const f = valid();
    const s = (f.rowSummaries as Record<string, unknown>[])[0]!;
    f.rowSummaries = [s, { ...s, fields: ['other'] }];
    expect(refusal(JSON.stringify(f))).toMatch(/same row summary appears twice/);
  });

  it('keeps two rules that differ only in one key part', () => {
    const f = valid();
    const r = (f.referenceRules as Record<string, unknown>[])[0]!;
    f.referenceRules = [r, { ...r, sourceField: 'agentId' }, { ...r, sourceCollection: 'carts' }, { ...r, sourceDb: 'crm' }];
    expect(parseFamilyExport(JSON.stringify(f)).referenceRules).toHaveLength(4);
  });

  it.each([
    ['no fields', []],
    ['five fields', ['a', 'b', 'c', 'd', 'e']],
    ['_id', ['_id']],
    ['a repeated field', ['a', 'a']],
    ['an empty field', [' ']],
  ])('refuses a Row Summary with %s', (_name, fields) => {
    const f = valid();
    (f.rowSummaries as Record<string, unknown>[])[0]!.fields = fields;
    expect(refusal(JSON.stringify(f))).toMatch(/damaged: shop\.orders: a row summary/);
  });

  it('accepts a Row Summary of exactly four fields', () => {
    const f = valid();
    (f.rowSummaries as Record<string, unknown>[])[0]!.fields = ['a', 'b', 'c', 'd'];
    expect(parseFamilyExport(JSON.stringify(f)).rowSummaries[0]!.fields).toHaveLength(4);
  });

  it('refuses a file over 5 MB and takes one just under it', () => {
    const base = JSON.stringify({ ...valid(), familyName: 'x' });
    const pad = (n: number) => base + ' '.repeat(n - Buffer.byteLength(base));
    expect(refusal(pad(FAMILY_EXPORT_MAX_BYTES + 1))).toMatch(/too large to apply \(5 MB limit\)/);
    expect(parseFamilyExport(pad(FAMILY_EXPORT_MAX_BYTES)).format).toBe(FAMILY_EXPORT_FORMAT);
  });

  it('counts the limit in bytes, not characters', () => {
    const base = JSON.stringify(valid());
    const wide = base + 'é'.repeat(Math.ceil((FAMILY_EXPORT_MAX_BYTES - Buffer.byteLength(base)) / 2) + 1);
    expect(wide.length).toBeLessThan(FAMILY_EXPORT_MAX_BYTES);
    expect(refusal(wide)).toMatch(/too large/);
  });

  it('refuses names and lists over their limits', () => {
    const f = valid();
    (f.referenceRules as Record<string, unknown>[])[0]!.sourceDb = 'x'.repeat(256);
    expect(refusal(JSON.stringify(f))).toMatch(/damaged at referenceRules\.0\.sourceDb/);
    expect(refusal(JSON.stringify({ ...valid(), familyName: 'x'.repeat(81) }))).toMatch(/familyName/);
  });

  it('does not let a __proto__ key through as a field', () => {
    const text = '{"format":"latelier-family-export","version":1,"exportedAt":"t","familyName":"A","referenceRules":[],"rowSummaries":[],"__proto__":{"x":1}}';
    expect(refusal(text)).toMatch(/damaged/);
  });
});

describe('familyFileName', () => {
  it('adds the suffix', () => {
    expect(familyFileName('Client deployments')).toBe('Client deployments.latelier-family.json');
  });
  it('replaces characters a file name cannot hold', () => {
    expect(familyFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j.latelier-family.json');
  });
  it('replaces control characters', () => {
    expect(familyFileName('a\nb\tc')).toBe('a-b-c.latelier-family.json');
  });
  it('strips leading dots and falls back for an empty stem', () => {
    expect(familyFileName('a..b')).toBe('a..b.latelier-family.json');
    expect(familyFileName('..hidden')).toBe('hidden.latelier-family.json');
    expect(familyFileName('   ')).toBe('family.latelier-family.json');
  });

  it('cleans paths and a blank template as the rule service does, so a hand-edited file stores nothing Mongo rejects', () => {
    const raw = valid();
    const rules = raw.referenceRules as Record<string, unknown>[];
    rules[0] = { ...rules[0], projection: ['', ' a ', 'a', 'b'], displayTemplate: '   ' };
    const file = parseFamilyExport(JSON.stringify(raw));
    expect(file.referenceRules[0]!.projection).toEqual(['a', 'b']);
    expect(file.referenceRules[0]!.displayTemplate).toBeUndefined();
  });

  it.each(['$where', '$expr', 'a.$where', '.a', 'a.', 'a..b'])(
    'refuses a rule whose target field %j cannot be a filter key',
    (field) => {
      const raw = valid();
      const rules = raw.referenceRules as Record<string, unknown>[];
      rules[0] = { ...rules[0], targetField: field };
      expect(refusal(JSON.stringify(raw))).toMatch(/target field/);
    },
  );
});
