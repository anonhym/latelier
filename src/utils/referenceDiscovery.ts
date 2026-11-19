import { containsDistinctive, matchesDistinctive, MAX_SCAN_CHARS } from './distinctiveValues';

/** How deep into a document a match is looked for; a top-level field is depth 1. */
export const MAX_MATCH_DEPTH = 8;
/** How many pairs the Never list keeps; the oldest goes first. */
export const MAX_NEVER_PAIRS = 500;

/**
 * The longest key the `refs.discovery.never` preference accepts (see
 * `electron/ipc/prefKeys.ts`); one longer fails the whole write, so Never would
 * error every time for that pair.
 */
export const MAX_PAIR_KEY_LENGTH = 1024;

/** A field of a Collection. */
export interface FieldRef {
  dbName: string;
  collection: string;
  field: string;
}

/** A Reference Rule as the suggestion would create it. */
export interface RulePair {
  source: FieldRef;
  target: FieldRef;
}

/** What a paste decision needs to know about the Copy Origin. */
export interface DiscoveryOrigin {
  connectionId: string;
  dbName: string;
  collection: string;
  fieldPath?: string;
  distinctive: readonly string[];
}

export interface DiscoveryTab {
  connectionId: string;
  dbName: string;
  collection: string;
}

/**
 * The distinctive values of the Copy Origin that `pasted` carries, when the
 * paste starts a discovery: the copy came from one field, on this tab's
 * Connection but another Collection. Null otherwise.
 */
export function pendingValuesFor(
  origin: DiscoveryOrigin | null,
  tab: DiscoveryTab,
  pasted: string,
): string[] | null {
  if (origin === null || origin.fieldPath === undefined) return null;
  if (origin.connectionId !== tab.connectionId) return null;
  if (origin.dbName === tab.dbName && origin.collection === tab.collection) return null;
  const scanned = pasted.slice(0, MAX_SCAN_CHARS);
  const found = origin.distinctive.filter((value) => containsDistinctive(scanned, value));
  return found.length === 0 ? null : found;
}

const SCALAR_SENTINELS = new Set(['$oid', '$numberInt', '$numberLong', '$numberDouble', '$numberDecimal']);
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const UUID_SUBTYPE = '04';
const UUID_BYTES = 16;

/** The canonical text of a 16-byte Binary, or null when `base64` is not one. */
function uuidOfBase64(base64: string): string | null {
  if (!BASE64.test(base64)) return null;
  const bytes = atob(base64);
  if (bytes.length !== UUID_BYTES) return null;
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) hex += bytes.charCodeAt(i).toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The texts a value in a document can be copied as; empty when `node` holds no scalar. */
function leafForms(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (typeof node === 'number') return [String(node)];
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return [];
  const entries = Object.entries(node);
  if (entries.length !== 1) return [];
  const [key, inner] = entries[0]!;
  if (SCALAR_SENTINELS.has(key)) return typeof inner === 'string' ? [inner] : [];
  if (key !== '$binary' || typeof inner !== 'object' || inner === null) return [];
  const { base64, subType } = inner as { base64?: unknown; subType?: unknown };
  if (typeof base64 !== 'string') return [];
  const uuid = subType === UUID_SUBTYPE ? uuidOfBase64(base64) : null;
  return uuid === null ? [base64] : [base64, uuid];
}

/** A value wrapper (`{$date}`, `{$oid}`, `{$binary}`…): a leaf, never a sub-document to search. */
function isSentinel(node: object): boolean {
  return Object.keys(node).some((key) => key.startsWith('$'));
}

function holds(node: unknown, values: readonly string[]): boolean {
  return leafForms(node).some((form) => values.some((value) => matchesDistinctive(form, value)));
}

function findInNode(node: unknown, path: string, depth: number, values: readonly string[]): string | null {
  if (holds(node, values)) return path;
  if (node === null || typeof node !== 'object' || depth >= MAX_MATCH_DEPTH) return null;
  if (Array.isArray(node)) {
    for (const element of node) {
      const hit = findInNode(element, path, depth + 1, values);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (isSentinel(node)) return null;
  for (const [key, child] of Object.entries(node)) {
    const hit = findInNode(child, path === '' ? key : `${path}.${key}`, depth + 1, values);
    if (hit !== null) return hit;
  }
  return null;
}

/**
 * The path of the field, in the first document that holds one of `values`,
 * where it sits: `_id` when that holds it, otherwise the first field in
 * document order. Array elements share the array field's path. Null when no
 * document holds a value.
 *
 * The documents are the wire's canonical EJSON, so an ObjectId is `{$oid}`, an
 * integer `{$numberInt}`, a UUID a subtype 4 `{$binary}`.
 */
export function findValueMatch(documents: readonly unknown[], values: readonly string[]): string | null {
  if (values.length === 0) return null;
  for (const doc of documents) {
    if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) continue;
    if (holds((doc as Record<string, unknown>)._id, values)) return '_id';
    const hit = findInNode(doc, '', 0, values);
    if (hit !== null) return hit;
  }
  return null;
}

/**
 * The rule a copy from `origin` and a match at `matched` suggest. A rule points
 * at the key of the Collection it references, so a copy of an `_id` that turns
 * up in some other field reads the other way round. Two `_id`s suggest nothing.
 */
export function orientPair(origin: FieldRef, matched: FieldRef): RulePair | null {
  const originIsId = origin.field === '_id';
  if (originIsId && matched.field === '_id') return null;
  return originIsId ? { source: matched, target: origin } : { source: origin, target: matched };
}

/** A 53-bit string hash (cyrb53): enough that two different long pairs never share a key in practice. */
function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * What Never and Not now are recorded against. The sides are a JSON array, not
 * dotted text: a Collection `a.b` with field `c` and a Collection `a` with
 * field `b.c` must not be the same pair. A pair too long for the preference is
 * keyed by a hash of that text instead.
 */
export function pairKey(connectionId: string, { source, target }: RulePair): string {
  const side = (f: FieldRef) => [f.dbName, f.collection, f.field];
  const text = JSON.stringify([...side(source), ...side(target)]);
  const full = `${connectionId}|${text}`;
  if (full.length <= MAX_PAIR_KEY_LENGTH) return full;
  return `${connectionId}|#${text.length.toString(36)}.${hashText(text)}`;
}

/** The rule's text as the strip shows it, without the Database. */
export function pairLabel({ source, target }: RulePair): string {
  return `${source.collection}.${source.field} → ${target.collection}.${target.field}`;
}

export interface SuppressionInput {
  key: string;
  source: FieldRef;
  /** The pair keys marked Never. */
  never: readonly string[];
  /** The Not now choice for this pair on this copy. */
  declined: boolean;
  /** The Connection's effective rules for the source Collection. */
  rules: readonly { sourceDb: string; sourceCollection: string; sourceField: string }[];
}

/** Whether a suggestion stays unshown: Never, Not now, or a rule that already covers the source field. */
export function isSuppressed({ key, source, never, declined, rules }: SuppressionInput): boolean {
  if (declined || never.includes(key)) return true;
  return rules.some(
    (r) => r.sourceDb === source.dbName && r.sourceCollection === source.collection && r.sourceField === source.field,
  );
}

/** The stored Never list, with anything that is not a string dropped. */
export function readNeverList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

/** `list` with `key` last, once, and no more than `MAX_NEVER_PAIRS` long. */
export function withNeverPair(list: readonly string[], key: string): string[] {
  return [...list.filter((k) => k !== key), key].slice(-MAX_NEVER_PAIRS);
}
