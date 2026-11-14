import { ejsonStringify, ejsonStringifyReadable } from './ejson';

/**
 * The three spellings a copied document can take (W06 §8.6). bson's own
 * relaxed mode is deliberately absent: it rounds a 64-bit integer, so what was
 * pasted back would not be what was copied.
 */
export type CopyFormat = 'readable' | 'canonical' | 'mongosh';

export const COPY_FORMATS: readonly CopyFormat[] = ['readable', 'canonical', 'mongosh'];

/** The name of a one-document copy button: what the clipboard will hold. */
export const COPY_ACTION_LABELS: Record<CopyFormat, string> = {
  readable: 'Copy JSON',
  canonical: 'Copy canonical EJSON',
  mongosh: 'Copy as mongosh',
};

export const DEFAULT_COPY_FORMAT: CopyFormat = 'readable';

export const COPY_FORMAT_LABELS: Record<CopyFormat, string> = {
  readable: 'EJSON (readable)',
  canonical: 'Canonical EJSON',
  mongosh: 'mongosh',
};

/** The BSON types the mongosh spelling cannot construct; they stay EJSON objects. */
export const MONGOSH_HINT = 'Code, Symbol, DBRef and undefined stay EJSON objects.';

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
 * `ISODate("…")`, `NumberLong("…")`, `NumberDecimal("…")`, `Double(…)`,
 * `BinData(…)`, `Timestamp({ t, i })`, `MinKey()`, `MaxKey()` and regex
 * literals: what mongosh evaluates back to the same document.
 *
 * Every other sentinel (`MONGOSH_HINT`) stays its EJSON object, because mongosh
 * has no literal this module can print for it. A regex whose
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
  const lines = entries.map(([k, v]) => `${inner}${printKey(k)}: ${printNode(v, inner)}`);
  return `{\n${lines.join(',\n')}\n${indent}}`;
}

// A plain `__proto__:` in an object literal sets the prototype and drops the
// field; only the computed form creates an own property.
function printKey(k: string): string {
  if (k === '__proto__') return '["__proto__"]';
  return SAFE_KEY.test(k) ? k : JSON.stringify(k);
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
    case '$numberDouble':
      return printDouble(v);
    case '$binary':
      return printBinary(v);
    case '$timestamp':
      return printTimestamp(v);
    case '$minKey':
      return intOf(v) === 1 ? 'MinKey()' : null;
    case '$maxKey':
      return intOf(v) === 1 ? 'MaxKey()' : null;
    default:
      return null;
  }
}

function printDouble(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  if (v === 'NaN' || v === 'Infinity' || v === '-Infinity') return `Double(${v})`;
  if (!/^-?[0-9.e+-]+$/i.test(v) || !Number.isFinite(Number(v))) return null;
  const n = Number(v);
  return `Double(${Object.is(n, -0) ? '-0' : String(n)})`;
}

function printBinary(v: unknown): string | null {
  if (!isPlainObject(v) || Object.keys(v).length !== 2) return null;
  const { base64, subType } = v;
  if (typeof base64 !== 'string' || typeof subType !== 'string') return null;
  if (!/^[0-9a-f]{1,2}$/i.test(subType) || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return null;
  return `BinData(${Number.parseInt(subType, 16)}, ${JSON.stringify(base64)})`;
}

function printTimestamp(v: unknown): string | null {
  if (!isPlainObject(v) || Object.keys(v).length !== 2) return null;
  const t = intOf(v.t);
  const i = intOf(v.i);
  const isUint32 = (n: number | null): n is number => n !== null && n >= 0 && n <= 0xffffffff;
  return isUint32(t) && isUint32(i) ? `Timestamp({ t: ${t}, i: ${i} })` : null;
}

/**
 * An integer slot inside a sentinel. A document straight from the wire is a
 * plain tree, and stringifying it wraps these slots as `{"$numberInt":"5"}`
 * (`$numberLong` past 32 bits).
 */
function intOf(v: unknown): number | null {
  let n = v;
  if (isPlainObject(v) && Object.keys(v).length === 1) {
    const wrapped = v.$numberInt ?? v.$numberLong;
    n = typeof wrapped === 'string' ? Number(wrapped) : null;
  }
  return typeof n === 'number' && Number.isSafeInteger(n) ? n : null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
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
