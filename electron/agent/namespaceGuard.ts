import { AgentToolError } from './errorMap.ts';
import { isRecord, walkStages } from './pipelineGuard.ts';

/** X27 §7.4: databases no Agent may read. Compared case-insensitively, since a server may fold the case of a database name. */
const DENIED_DATABASES: ReadonlySet<string> = new Set(['admin', 'local', 'config']);
const SYSTEM_PREFIX = 'system.';
const MAX_NAME = 256;

/** Names come from the server and can be chosen by whoever controls the data. */
export function cutName(name: string, max = MAX_NAME): string {
  return name.slice(0, max);
}

export function isDeniedDatabase(name: string): boolean {
  return DENIED_DATABASES.has(name.toLowerCase());
}

export function isDeniedCollection(name: string): boolean {
  return name.startsWith(SYSTEM_PREFIX);
}

/** Throws NAMESPACE_DENIED for a database or collection an Agent may not read. */
export function assertTargetAllowed(database: string, collection?: string): void {
  if (isDeniedDatabase(database)) throw new AgentToolError('NAMESPACE_DENIED');
  if (collection !== undefined && isDeniedCollection(collection)) throw new AgentToolError('NAMESPACE_DENIED');
}

/** A `from` or `coll` must be a plain collection name: the object form (`{ db, coll }`) is refused outright. */
function assertSourceName(source: unknown): void {
  if (typeof source !== 'string' || isDeniedCollection(source)) throw new AgentToolError('NAMESPACE_DENIED');
}

/**
 * Checks the collection every cross-collection stage reads, at any depth:
 * `$lookup.from`, `$graphLookup.from` and `$unionWith` (a string, or `.coll`).
 * A `$lookup` joins within its own database, so the names cover what is reachable.
 */
export function assertPipelineNamespaces(pipeline: unknown): void {
  walkStages(pipeline, (op, body) => {
    if (op === '$lookup' || op === '$graphLookup') {
      if (!isRecord(body)) throw new AgentToolError('INVALID_INPUT', `${op} takes an object.`);
      if (Object.hasOwn(body, 'from')) assertSourceName(body.from);
    } else if (op === '$unionWith') {
      if (typeof body === 'string') assertSourceName(body);
      else if (!isRecord(body)) throw new AgentToolError('INVALID_INPUT', '$unionWith takes a collection name or an object.');
      else if (Object.hasOwn(body, 'coll')) assertSourceName(body.coll);
    }
  });
}

/** `list_databases` shows only what an Agent may read. */
export function filterDatabases(names: readonly string[]): string[] {
  return names.filter((name) => !isDeniedDatabase(name));
}

/** `list_collections` shows only what an Agent may read. */
export function filterCollections(names: readonly string[]): string[] {
  return names.filter((name) => !isDeniedCollection(name));
}

/** What a listing may say about a collection's kind; anything else a server invents is shown as `collection`. */
const COLLECTION_TYPES: ReadonlySet<string> = new Set(['collection', 'view', 'timeseries']);

/** `list_databases` as the Agent sees it: nothing denied, sorted, each name cut. */
export function visibleDatabaseNames(names: readonly string[]): string[] {
  return filterDatabases(names)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => cutName(name));
}

/** `list_collections` as the Agent sees it: nothing denied, sorted by name, each name cut, with the kind. */
export function visibleCollections(rows: ReadonlyArray<{ name: string; type?: unknown }>): Array<{ name: string; type: string }> {
  return rows
    .filter((row) => !isDeniedCollection(row.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((row) => ({
      name: cutName(row.name),
      type: typeof row.type === 'string' && COLLECTION_TYPES.has(row.type) ? row.type : 'collection',
    }));
}
