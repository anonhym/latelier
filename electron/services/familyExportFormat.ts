import { z } from 'zod';
import type { FamilySettings } from '@shared/types';
import { ValidationError } from '../errors.ts';
import { EXPORT_FORMAT as CONNECTION_EXPORT_FORMAT } from './connectionExportFormat.ts';
import { ruleKey, rowSummaryKey } from './effectiveRules.ts';
import { rowSummaryFieldsProblem } from './rowSummaryValidate.ts';

/**
 * The Family Export file (X24): pure writing, parsing and validation. It
 * carries a Family's shared Reference Rules and Row Summaries and nothing
 * else, so there are no ids, timestamps per item, Connections or secrets.
 */

export const FAMILY_EXPORT_FORMAT = 'latelier-family-export';
export const FAMILY_EXPORT_VERSION = 1;
export const FAMILY_EXPORT_MAX_BYTES = 5 * 1024 * 1024;
export const FAMILY_FILE_SUFFIX = '.latelier-family.json';

export interface FamilyExportRule {
  sourceDb: string;
  sourceCollection: string;
  sourceField: string;
  targetDb: string;
  targetCollection: string;
  targetField: string;
  projection: string[];
  displayTemplate?: string;
  enabled: boolean;
}

export interface FamilyExportRowSummary {
  dbName: string;
  collection: string;
  fields: string[];
}

export interface FamilyExportFile {
  format: typeof FAMILY_EXPORT_FORMAT;
  version: typeof FAMILY_EXPORT_VERSION;
  exportedAt: string;
  familyName: string;
  referenceRules: FamilyExportRule[];
  rowSummaries: FamilyExportRowSummary[];
}

// The rule handlers enforce the same bounds on what they save, so a saved rule always fits a file this reads back.
export const MAX_NAME = 255;
const MAX_ITEMS = 5000;
export const MAX_TEMPLATE = 2000;
export const MAX_PATHS = 200;

const Name = z.string().min(1).max(MAX_NAME);

/**
 * Why a rule's target field cannot be used as a filter key, or null when it can.
 * The field becomes the key of a Mongo filter, so a `$`-led segment would turn
 * a chip click into an operator query (`$where` runs server-side script) built
 * from document data, and an empty segment is a path Mongo rejects.
 */
export function targetFieldProblem(field: string): string | null {
  for (const segment of field.split('.')) {
    if (segment === '') return 'target field has an empty path segment';
    if (segment.startsWith('$')) return 'target field cannot start a path segment with "$"';
  }
  return null;
}

export const TargetField = Name.superRefine((field, ctx) => {
  const problem = targetFieldProblem(field);
  if (problem !== null) ctx.addIssue({ code: 'custom', message: problem });
});
const Paths = z.array(z.string().max(MAX_NAME)).max(MAX_PATHS);
// A rule's projection is cleaned as the rule service cleans its own input (trimmed, no blanks, no repeats, order kept), so a hand-edited file cannot store a path Mongo rejects.
const Projection = Paths.transform((paths) => Array.from(new Set(paths.map((p) => p.trim()).filter((p) => p.length > 0))));

const RuleSchema = z.strictObject({
  sourceDb: Name,
  sourceCollection: Name,
  sourceField: Name,
  targetDb: Name,
  targetCollection: Name,
  targetField: TargetField,
  projection: Projection,
  // A blank template is no template, as the rule service stores it.
  displayTemplate: z
    .string()
    .max(MAX_TEMPLATE)
    .optional()
    .transform((t) => (t === undefined || t.trim() === '' ? undefined : t)),
  enabled: z.boolean(),
});

const RowSummarySchema = z.strictObject({
  dbName: Name,
  collection: Name,
  fields: Paths,
});

const FileSchema = z.strictObject({
  format: z.literal(FAMILY_EXPORT_FORMAT),
  version: z.literal(FAMILY_EXPORT_VERSION),
  exportedAt: z.string().min(1).max(64),
  familyName: z.string().trim().min(1).max(80),
  referenceRules: z.array(RuleSchema).max(MAX_ITEMS),
  rowSummaries: z.array(RowSummarySchema).max(MAX_ITEMS),
});

const NOT_A_FAMILY_EXPORT = "This file isn't a L'Atelier Family Export.";
const CONNECTION_EXPORT_MESSAGE =
  'This is a Connection Export. Use Import in the Connections table.';
const NEWER_VERSION_MESSAGE =
  "This file was made by a newer version of L'Atelier. Update to apply it.";
const UNKNOWN_VERSION_MESSAGE = "This Family Export has a version L'Atelier doesn't know.";

/** `name` as a file name stem: path separators and other characters a file system refuses become `-`. */
export function familyFileName(name: string): string {
  const stem = Array.from(name, (ch) => (ch.charCodeAt(0) < 0x20 ? '-' : ch))
    .join('')
    .replace(/[\\/:*?"<>|]/g, '-')
    .trim()
    .replace(/^\.+/, '');
  return `${stem === '' ? 'family' : stem}${FAMILY_FILE_SUFFIX}`;
}

/** The file text for a Family's shared settings. Items are in key order, so the same settings write the same bytes. */
export function writeFamilyExport(input: {
  familyName: string;
  settings: FamilySettings;
  now: Date;
}): string {
  const referenceRules: FamilyExportRule[] = input.settings.rules
    .map((r) => {
      const rule: FamilyExportRule = {
        sourceDb: r.sourceDb,
        sourceCollection: r.sourceCollection,
        sourceField: r.sourceField,
        targetDb: r.targetDb,
        targetCollection: r.targetCollection,
        targetField: r.targetField,
        projection: [...r.projection],
        enabled: r.enabled,
      };
      if (r.displayTemplate !== undefined) rule.displayTemplate = r.displayTemplate;
      return rule;
    })
    .sort((a, b) => ruleKey(a).localeCompare(ruleKey(b)));
  const rowSummaries: FamilyExportRowSummary[] = input.settings.rowSummaries
    .map((s) => ({ dbName: s.dbName, collection: s.collection, fields: [...s.fields] }))
    .sort((a, b) => rowSummaryKey(a).localeCompare(rowSummaryKey(b)));
  const file: FamilyExportFile = {
    format: FAMILY_EXPORT_FORMAT,
    version: FAMILY_EXPORT_VERSION,
    exportedAt: input.now.toISOString(),
    familyName: input.familyName,
    referenceRules,
    rowSummaries,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/**
 * Reads a Family Export. Throws `ValidationError` with a reason for anything
 * else: malformed JSON, a Connection Export, a version it doesn't know,
 * unknown or missing fields, a repeated natural key, a Row Summary outside
 * X23's limits, or a file over 5 MB.
 */
export function parseFamilyExport(text: string): FamilyExportFile {
  if (Buffer.byteLength(text) > FAMILY_EXPORT_MAX_BYTES) {
    throw new ValidationError(
      `This file is too large to apply (${FAMILY_EXPORT_MAX_BYTES / 1024 / 1024} MB limit).`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ValidationError("This isn't a JSON file.");
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError(NOT_A_FAMILY_EXPORT);
  }
  const head = value as { format?: unknown; version?: unknown };
  if (head.format === CONNECTION_EXPORT_FORMAT) throw new ValidationError(CONNECTION_EXPORT_MESSAGE);
  if (head.format !== FAMILY_EXPORT_FORMAT) throw new ValidationError(NOT_A_FAMILY_EXPORT);
  if (head.version !== FAMILY_EXPORT_VERSION) {
    throw new ValidationError(
      typeof head.version === 'number' && head.version > FAMILY_EXPORT_VERSION
        ? NEWER_VERSION_MESSAGE
        : UNKNOWN_VERSION_MESSAGE,
    );
  }
  const parsed = FileSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const where = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
    throw new ValidationError(`This Family Export is damaged${where}: ${issue.message}.`);
  }
  const file = parsed.data as FamilyExportFile;
  assertNoDuplicates(file.referenceRules.map(ruleKey), 'reference rule');
  assertNoDuplicates(file.rowSummaries.map(rowSummaryKey), 'row summary');
  for (const s of file.rowSummaries) {
    const problem = rowSummaryFieldsProblem(s.fields);
    if (problem !== null) {
      throw new ValidationError(`This Family Export is damaged: ${s.dbName}.${s.collection}: ${problem}.`);
    }
  }
  return file;
}

function assertNoDuplicates(keys: string[], what: string): void {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) {
      throw new ValidationError(`This Family Export is damaged: the same ${what} appears twice (${key}).`);
    }
    seen.add(key);
  }
}
