import { ejsonStringify, ejsonStringifyReadable } from './ejson';

/**
 * The three spellings a copied document can take (W06 §8.6). bson's own
 * relaxed mode is deliberately absent: it rounds a 64-bit integer, so what was
 * pasted back would not be what was copied.
 */
export type CopyFormat = 'readable' | 'canonical' | 'mongosh';

export const COPY_FORMATS: readonly CopyFormat[] = ['readable', 'canonical', 'mongosh'];

export const DEFAULT_COPY_FORMAT: CopyFormat = 'readable';

export const COPY_FORMAT_LABELS: Record<CopyFormat, string> = {
  readable: 'EJSON (readable)',
  canonical: 'Canonical EJSON',
  mongosh: 'mongosh',
};

/**
 * `docs` as clipboard text: a bare object for one document, an array for
 * several (the shape the per-card copy always had).
 */
export function formatDocsForCopy(docs: readonly unknown[], format: CopyFormat): string {
  const value = docs.length === 1 ? docs[0] : docs;
  if (format === 'canonical') return ejsonStringify(value, 2);
  if (format === 'mongosh') return toMongoshLiteral(value);
  return ejsonStringifyReadable(value, 2);
}

const SAFE_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Regex flags Shell Syntax accepts, in the order it writes them back. */
const SHELL_REGEX_OPTIONS = /^i?m?s?u?$/;

// Pattern text a `/…/` literal cannot carry: an unescaped slash ends it, a
// line terminator is not allowed in one.
const UNLITERAL_PATTERN = /[/\n\r\u2028\u2029]/;

/**
 * `value` as mongosh source text: unquoted keys, `ObjectId("…")`,
 * `ISODate("…")`, `NumberLong("…")`, `NumberDecimal("…")` and regex literals.
 *
 * Every other sentinel (Binary, Timestamp, MinKey, …) stays its EJSON object,
 * because Shell Syntax (ADR 0004) has no constructor for it. A regex whose
 * text a literal cannot carry unchanged stays an object too: escaping the
 * slash would paste back as a different pattern.
 *
 * Starts from the readable form, which already unwraps the plain ints,
 * fractional doubles and dates, so this module keeps no second copy of those
 * rules.
 */
export function toMongoshLiteral(value: unknown): string {
  return printNode(JSON.parse(ejsonStringifyReadable(value)) as unknown, '');
}

function printNode(node: unknown, indent: string): string {
  if (node === null || typeof node !== 'object') return JSON.stringify(node);
  const inner = `${indent}  `;
  if (Array.isArray(node)) {
    if (node.length === 0) return '[]';
    return `[\n${node.map((n) => `${inner}${printNode(n, inner)}`).join(',\n')}\n${indent}]`;
  }
  const obj = node as Record<string, unknown>;
  const constructed = printConstructor(obj);
  if (constructed !== null) return constructed;
  const entries = Object.entries(obj);
  if (entries.length === 0) return '{}';
  const lines = entries.map(([k, v]) => `${inner}${SAFE_KEY.test(k) ? k : JSON.stringify(k)}: ${printNode(v, inner)}`);
  return `{\n${lines.join(',\n')}\n${indent}}`;
}

function printConstructor(obj: Record<string, unknown>): string | null {
  const keys = Object.keys(obj);
  if (keys.length !== 1) return null;
  const v = obj[keys[0]];
  switch (keys[0]) {
    case '$oid':
      return typeof v === 'string' ? `ObjectId(${JSON.stringify(v)})` : null;
    case '$numberLong':
      return typeof v === 'string' ? `NumberLong(${JSON.stringify(v)})` : null;
    case '$numberDecimal':
      return typeof v === 'string' ? `NumberDecimal(${JSON.stringify(v)})` : null;
    case '$date':
      return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? `ISODate(${JSON.stringify(v)})` : null;
    case '$regularExpression':
      return printRegex(v);
    default:
      return null;
  }
}

function printRegex(v: unknown): string | null {
  // A non-object has no `pattern`, so the check below refuses it as well.
  const { pattern, options } = (v ?? {}) as { pattern?: unknown; options?: unknown };
  if (typeof pattern !== 'string' || typeof options !== 'string') return null;
  if (pattern === '' || UNLITERAL_PATTERN.test(pattern) || !SHELL_REGEX_OPTIONS.test(options)) return null;
  try {
    new RegExp(pattern, options);
  } catch {
    // Not a pattern JavaScript can read (a PCRE-only construct): the literal
    // would be refused on the way back in, so keep the EJSON object.
    return null;
  }
  return `/${pattern}/${options}`;
}
