/**
 * Field paths, BSON types and how often each appears, inferred from a sample
 * of documents (X27 §8, `collection_schema`). Pure, and by construction it
 * never emits a value: the only strings that leave are field names, cut to
 * MAX_SEGMENT, and a fixed vocabulary of type names.
 *
 * Documents are expected as read with `EXACT_BSON` (`promoteValues: false`),
 * so an Int32, a Long and a Double are distinct wrapper objects. A plain JS
 * number, which a caller cannot tell apart, counts as `double`.
 */

export const MAX_PATHS = 2_000;
export const MAX_DEPTH = 32;
export const MAX_SEGMENT = 256;
/** Appended to a path for the elements of an array: `tags.[]`, `items.[].sku`. */
export const ARRAY_SEGMENT = '[]';

/** What `_bsontype` names map to, in the vocabulary of MongoDB's `$type`. */
const BSON_TYPE_NAMES: Readonly<Record<string, string>> = {
  Int32: 'int',
  Long: 'long',
  Double: 'double',
  Decimal128: 'decimal',
  ObjectId: 'objectId',
  Binary: 'binData',
  BSONRegExp: 'regex',
  Timestamp: 'timestamp',
  MinKey: 'minKey',
  MaxKey: 'maxKey',
  Code: 'javascript',
  BSONSymbol: 'symbol',
  DBRef: 'object',
};

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * The `$type` name of one value. A plain object is always `object`, whatever
 * keys it holds: a document with a field called `_bsontype` must not pass for
 * a BSON value.
 */
export function bsonTypeOf(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'undefined':
      return 'undefined';
    case 'string':
      return 'string';
    case 'boolean':
      return 'bool';
    case 'number':
      return 'double';
    case 'bigint':
      return 'long';
    case 'object':
      break;
    default:
      return 'unknown';
  }
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'date';
  if (isPlainObject(value)) return 'object';
  const tag = (value as { _bsontype?: unknown })._bsontype;
  // Own keys only: a tag of `constructor` or `__proto__` must not resolve through the table's prototype.
  return typeof tag === 'string' && Object.hasOwn(BSON_TYPE_NAMES, tag) ? BSON_TYPE_NAMES[tag]! : 'unknown';
}

export interface SchemaField {
  path: string;
  /** Occurrences of each type: an array element counts once per element. */
  types: Record<string, number>;
  /** Sampled documents that hold the path at least once. */
  docs: number;
  /** `docs` over the number of sampled documents, 0 to 1 at four places. */
  frequency: number;
}

export interface SchemaResult {
  sampled: number;
  fields: SchemaField[];
  /** True when the sample held more distinct paths than MAX_PATHS and the rest were not tracked. */
  pathsTruncated: boolean;
}

interface PathStats {
  types: Map<string, number>;
  docs: number;
  /** The document that last counted toward `docs`, so a repeated path counts once per document. */
  lastDoc: number;
}

function cutSegment(key: string): string {
  return key.length > MAX_SEGMENT ? key.slice(0, MAX_SEGMENT) : key;
}

/** Feed it documents one at a time, so a large sample is never held in memory. */
export class SchemaAccumulator {
  private paths = new Map<string, PathStats>();
  private sampled = 0;
  private pathsTruncated = false;

  add(doc: unknown): void {
    if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return;
    this.sampled += 1;
    this.visitKeys(doc as Record<string, unknown>, '', 1);
  }

  private visitKeys(obj: Record<string, unknown>, prefix: string, depth: number): void {
    for (const key of Object.keys(obj)) {
      this.visit(prefix === '' ? cutSegment(key) : `${prefix}.${cutSegment(key)}`, obj[key], depth);
    }
  }

  private visit(path: string, value: unknown, depth: number): void {
    let stats = this.paths.get(path);
    if (!stats) {
      if (this.paths.size >= MAX_PATHS) {
        this.pathsTruncated = true;
        return;
      }
      stats = { types: new Map(), docs: 0, lastDoc: 0 };
      this.paths.set(path, stats);
    }
    const type = bsonTypeOf(value);
    stats.types.set(type, (stats.types.get(type) ?? 0) + 1);
    if (stats.lastDoc !== this.sampled) {
      stats.lastDoc = this.sampled;
      stats.docs += 1;
    }
    if (depth >= MAX_DEPTH) return;
    if (type === 'object') {
      this.visitKeys(value as Record<string, unknown>, path, depth + 1);
    } else if (type === 'array') {
      for (const element of value as unknown[]) this.visit(`${path}.${ARRAY_SEGMENT}`, element, depth + 1);
    }
  }

  result(): SchemaResult {
    const fields = [...this.paths.entries()]
      .map(([path, stats]): SchemaField => ({
        path,
        types: Object.fromEntries([...stats.types.entries()].sort(([a], [b]) => a.localeCompare(b))),
        docs: stats.docs,
        frequency: Math.round((stats.docs / this.sampled) * 10_000) / 10_000,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
    return { sampled: this.sampled, fields, pathsTruncated: this.pathsTruncated };
  }
}

export function inferSchema(docs: Iterable<unknown>): SchemaResult {
  const acc = new SchemaAccumulator();
  for (const doc of docs) acc.add(doc);
  return acc.result();
}
