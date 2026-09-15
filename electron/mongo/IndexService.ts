import type {
  IndexCreateInput,
  IndexDropInput,
  IndexFieldDirection,
  IndexInfo,
} from '@shared/types';
import { ejsonParse, ejsonStringify } from './ejson.ts';
import { classifyMongoOpError } from './errors.ts';
import { ValidationError } from '../errors.ts';
import { ownSet } from '../ownProperty.ts';
import type { MongoPool } from './MongoPool.ts';
import { ADMIN_LONG_TIMEOUT_MS, STATS_TIMEOUT_MS } from './timeouts.ts';

const VALID_DIRECTIONS = new Set<IndexFieldDirection>([
  1,
  -1,
  'text',
  'hashed',
  '2d',
  '2dsphere',
  'geoHaystack',
]);

interface IndexStatsRow {
  name: string;
  accesses?: { ops?: number | bigint; since?: Date | string };
}

interface CollStatsRow {
  storageStats?: { indexSizes?: Record<string, number> };
}

interface RawIndexSpec {
  name?: string;
  v?: number;
  key: Record<string, unknown>;
  unique?: boolean;
  sparse?: boolean;
  hidden?: boolean;
  expireAfterSeconds?: number;
  partialFilterExpression?: unknown;
  collation?: unknown;
}

export class IndexService {
  private pool: MongoPool;

  constructor(pool: MongoPool) {
    this.pool = pool;
  }

  async list(input: {
    connectionId: string;
    dbName: string;
    collection: string;
  }): Promise<IndexInfo[]> {
    const db = await this.pool.readDb(input.connectionId, input.dbName);
    const coll = db.collection(input.collection);

    let raw: RawIndexSpec[];
    try {
      raw = (await coll.indexes()) as unknown as RawIndexSpec[];
    } catch (err) {
      throw classifyMongoOpError(err);
    }

    const [statsResult, sizesResult] = await Promise.allSettled([
      coll
        .aggregate([{ $indexStats: {} }], { maxTimeMS: STATS_TIMEOUT_MS })
        .toArray() as Promise<IndexStatsRow[]>,
      coll
        .aggregate([{ $collStats: { storageStats: {} } }], { maxTimeMS: STATS_TIMEOUT_MS })
        .next() as Promise<CollStatsRow | null>,
    ]);

    const stats = statsResult.status === 'fulfilled' ? statsResult.value : null;
    const sizes =
      sizesResult.status === 'fulfilled'
        ? sizesResult.value?.storageStats?.indexSizes ?? null
        : null;

    return raw.map((spec) => buildIndexInfo(spec, stats, sizes));
  }

  async create(input: IndexCreateInput): Promise<{ name: string }> {
    const w = this.pool.write(input.connectionId);
    validateCreateInput(input);
    const opts = buildCreateOpts(input.options);
    // A foreground build on a large collection legitimately runs for
    // minutes, so this needs the admin-long budget rather than the stats
    // one — verified empirically (probe against mongodb-memory-server):
    // createIndex's maxTimeMS is honoured server-side (aborts with
    // MongoServerError code 50 / MaxTimeMSExpired, index rolled back
    // cleanly, nothing partial left behind), and this codebase never sets
    // `background` so the build is foreground, not fire-and-forget.
    opts.maxTimeMS = ADMIN_LONG_TIMEOUT_MS;
    const keySpec = buildKeySpec(input.fields);
    const db = await w.db(input.dbName);
    try {
      const name = await db.collection(input.collection).createIndex(keySpec, opts);
      return { name };
    } catch (err) {
      throw classifyMongoOpError(err);
    }
  }

  async drop(input: IndexDropInput): Promise<{ dropped: true }> {
    const w = this.pool.write(input.connectionId);
    if (input.name === '_id_') {
      throw new ValidationError('cannot drop the default _id index', { name: input.name });
    }
    const db = await w.db(input.dbName);
    try {
      await db.collection(input.collection).dropIndex(input.name, { maxTimeMS: STATS_TIMEOUT_MS });
      return { dropped: true };
    } catch (err) {
      throw classifyMongoOpError(err);
    }
  }
}

export function validateCreateInput(input: IndexCreateInput): void {
  if (!input.fields.length) {
    throw new ValidationError('at least one field is required', { fields: input.fields });
  }
  for (const f of input.fields) {
    if (!f.field) {
      throw new ValidationError('field name cannot be empty', { fields: input.fields });
    }
    if (!VALID_DIRECTIONS.has(f.direction)) {
      throw new ValidationError(`invalid direction: ${String(f.direction)}`, {
        field: f.field,
        direction: f.direction,
      });
    }
  }
  if (typeof input.options.expireAfterSeconds === 'number') {
    if (input.fields.length !== 1) {
      throw new ValidationError(
        'TTL indexes require exactly one field',
        { fields: input.fields },
      );
    }
    const dir = input.fields[0]!.direction;
    if (dir !== 1 && dir !== -1) {
      throw new ValidationError(
        'TTL indexes require an ascending or descending key',
        { direction: dir },
      );
    }
    if (input.options.expireAfterSeconds < 0) {
      throw new ValidationError('expireAfterSeconds must be non-negative', {
        expireAfterSeconds: input.options.expireAfterSeconds,
      });
    }
  }
}

export function buildKeySpec(
  fields: IndexCreateInput['fields'],
): Record<string, IndexFieldDirection> {
  const out: Record<string, IndexFieldDirection> = {};
  for (const f of fields) {
    ownSet(out, f.field, f.direction);
  }
  return out;
}

export function buildCreateOpts(
  options: IndexCreateInput['options'],
): Record<string, unknown> {
  const opts: Record<string, unknown> = {};
  if (options.name) opts.name = options.name;
  if (options.unique) opts.unique = true;
  if (options.sparse) opts.sparse = true;
  if (typeof options.expireAfterSeconds === 'number') {
    opts.expireAfterSeconds = options.expireAfterSeconds;
  }
  if (options.partialFilterExpression) {
    try {
      opts.partialFilterExpression = ejsonParse(options.partialFilterExpression);
    } catch (err) {
      throw new ValidationError('partialFilterExpression: invalid EJSON', {
        field: 'partialFilterExpression',
        reason: (err as Error).message,
      });
    }
  }
  if (options.collation) {
    try {
      opts.collation = ejsonParse(options.collation);
    } catch (err) {
      throw new ValidationError('collation: invalid EJSON', {
        field: 'collation',
        reason: (err as Error).message,
      });
    }
  }
  return opts;
}

export function buildIndexInfo(
  spec: RawIndexSpec,
  stats: IndexStatsRow[] | null,
  indexSizes: Record<string, number> | null,
): IndexInfo {
  const name = spec.name ?? '';
  // Driver types `key` as required, but a malformed server reply could omit it,
  // and Object.entries(undefined) throws — default to {} instead.
  const key = Object.entries(spec.key ?? {}).map(([field, direction]) => ({
    field,
    direction: direction as IndexFieldDirection,
  }));
  const isIdIndex =
    name === '_id_' || (key.length === 1 && key[0]!.field === '_id' && key[0]!.direction === 1);

  const info: IndexInfo = {
    name,
    key,
    isIdIndex,
    unique: Boolean(spec.unique),
    sparse: Boolean(spec.sparse),
    hidden: Boolean(spec.hidden),
    version: typeof spec.v === 'number' ? spec.v : 2,
  };

  if (typeof spec.expireAfterSeconds === 'number') {
    info.expireAfterSeconds = spec.expireAfterSeconds;
  }
  if (spec.partialFilterExpression !== undefined) {
    info.partialFilterExpression = ejsonStringify(spec.partialFilterExpression);
  }
  if (spec.collation !== undefined) {
    info.collation = ejsonStringify(spec.collation);
  }

  if (indexSizes && typeof indexSizes[name] === 'number') {
    info.sizeBytes = indexSizes[name];
  }

  if (stats) {
    const row = stats.find((r) => r.name === name);
    const ops = row?.accesses?.ops;
    const since = row?.accesses?.since;
    if (ops !== undefined && since !== undefined) {
      info.usage = {
        ops: typeof ops === 'bigint' ? Number(ops) : ops,
        since: since instanceof Date ? since.toISOString() : String(since),
      };
    }
  }

  return info;
}
