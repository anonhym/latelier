import { toDisplayValue, type DisplayType } from '../../../utils/displayValue';
import type { FieldSource, FieldSuggestion } from '../types';

const MAX_DEPTH = 2;
const MAX_DOCS = 50;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function walk(
  doc: Record<string, unknown>,
  prefix: string,
  depth: number,
  out: Map<string, { type?: DisplayType; count: number }>,
): void {
  for (const [key, value] of Object.entries(doc)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const dv = toDisplayValue(value);
    const existing = out.get(path);
    if (existing) {
      existing.count += 1;
      if (!existing.type) existing.type = dv.type;
    } else {
      out.set(path, { type: dv.type, count: 1 });
    }
    if (depth < MAX_DEPTH && dv.type === 'object' && isRecord(value)) {
      walk(value, path, depth + 1, out);
    }
  }
}

export const lastRunSource: FieldSource = (ctx) => {
  const docs = ctx.recentDocs;
  if (!docs || docs.length === 0) return [];
  const accum = new Map<string, { type?: DisplayType; count: number }>();
  for (const doc of docs.slice(0, MAX_DOCS)) {
    if (isRecord(doc)) walk(doc, '', 0, accum);
  }
  const out: FieldSuggestion[] = [];
  for (const [path, info] of accum) {
    out.push({ kind: 'field', path, type: info.type, source: 'lastRun', frequency: info.count });
  }
  return out;
};
