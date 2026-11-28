import type { AgentCallRow, AgentCallSummary, AgentCallsQuery, AgentSessionEndReason, Stage } from '@shared/types';
import { ejsonParse, ejsonStringifyReadable, isPlainDocument } from '../../utils/ejson';
import { prettyPrintJsonKeepingBigInts } from '../../utils/bigIntJson';
import { humanBytes } from '../../utils/humanBytes';
import { isWriteStage } from '../../pages/Workspace/Aggregation/pipeline';
import type { LegacySavedFindPayload } from '../../pages/Workspace/legacyBuilder';
import { isRefusedOutcome } from './homeModel';

/**
 * One Agent Read Log row as Activity and History show it (X30 §5.2, §9).
 * Everything in a row that came from an Agent or the data (names, the request)
 * is untrusted text.
 */

/** Each refusal code in words. Mirrors X27 §9.4's codes; an unknown code is shown as it is. */
const REFUSAL_WORDS: Readonly<Record<string, string>> = {
  NOT_SHARED: 'not shared',
  NOT_OPEN: 'not open',
  ACCESS_OFF: 'Agent Access off',
  NAMESPACE_DENIED: 'database or collection not allowed',
  STAGE_NOT_ALLOWED: 'stage not allowed',
  JS_NOT_ALLOWED: 'server-side JavaScript',
  INVALID_INPUT: 'invalid input',
  BUSY: 'busy',
  TIMEOUT: 'timed out',
  CANCELLED: 'cancelled',
  DB_ERROR: 'database error',
  PROPOSAL_DECLINED: 'pair declined',
  ALREADY_CONFIGURED: 'already configured',
  PROPOSAL_LIMIT: 'too many open Proposals',
};

/** A refusal code in words: `NOT_OPEN` → "not open". */
export function outcomeWords(outcome: string): string {
  return Object.hasOwn(REFUSAL_WORDS, outcome) ? REFUSAL_WORDS[outcome]! : outcome;
}

/** X27 §16.5's refused bucket: anything but `ok` and a paused call's asking round. */
export function isRefusedRow(row: Pick<AgentCallSummary, 'outcome'>): boolean {
  return isRefusedOutcome(row.outcome);
}

/** `shop.orders`, `shop`, or the Connection's name for a call that names no database. */
export function targetText(row: Pick<AgentCallSummary, 'database' | 'collection' | 'connectionName'>): string {
  if (row.database && row.collection) return `${row.database}.${row.collection}`;
  return row.database ?? row.collection ?? row.connectionName ?? '';
}

/**
 * The result column: `50 docs · 38 ms`, `truncated · 1.0 MB`,
 * `refused · not open`, or `asked you to open Shop` for a paused call's
 * asking round (X29 §5).
 */
export function resultText(
  row: Pick<AgentCallSummary, 'outcome' | 'docCount' | 'durationMs' | 'truncated' | 'bytes' | 'connectionName'>,
): string {
  if (row.outcome === 'INPUT_REQUIRED') return `asked you to open ${row.connectionName ?? 'the Connection'}`;
  if (isRefusedOutcome(row.outcome)) return `refused · ${outcomeWords(row.outcome)}`;
  if (row.truncated) return `truncated · ${humanBytes(row.bytes)}`;
  return `${row.docCount} ${row.docCount === 1 ? 'doc' : 'docs'} · ${row.durationMs} ms`;
}

/** The request as sent, indented, numbers kept as written; the stored text itself when it is not JSON. */
export function requestText(row: Pick<AgentCallRow, 'request'>): string | null {
  if (row.request === null) return null;
  try {
    return prettyPrintJsonKeepingBigInts(row.request, 2);
  } catch {
    // A request cut at the size cap is still stored as a JSON marker; anything else is shown raw.
    return row.request;
  }
}

/** Where a query opened from a row runs: the row's own Connection, database and collection. */
export interface QueryTarget {
  connectionId: string;
  database: string;
  collection: string;
}

/** What a find or count opens as: the filter, sort and projection as the Filter Bar holds them. */
export interface FindSeed extends QueryTarget {
  kind: 'find';
  queryRaw: string;
  /** Blank when the Agent sent none. */
  sort: string;
  /** Blank when the Agent sent none. */
  projectionRaw: string;
}

/** What an aggregate opens as: its stages. */
export interface PipelineSeed extends QueryTarget {
  kind: 'aggregate';
  stages: Stage[];
}

export type QuerySeed = FindSeed | PipelineSeed;

const OPENABLE_TOOLS = new Set(['find', 'count', 'aggregate']);

function readable(value: unknown): string {
  return ejsonStringifyReadable(value);
}

/** A document the Agent sent, as Filter Bar text; `fallback` when it sent none; null when it is not a document. */
function documentText(value: unknown, fallback: string): string | null {
  if (value === undefined) return fallback;
  return isPlainDocument(value) ? readable(value) : null;
}

function pipelineStages(value: unknown): Stage[] | null {
  if (!Array.isArray(value)) return null;
  const stages: Stage[] = [];
  for (const [i, stage] of value.entries()) {
    if (!isPlainDocument(stage)) return null;
    const keys = Object.keys(stage as Record<string, unknown>);
    if (keys.length !== 1) return null;
    const op = keys[0]!;
    // A document can steer an Agent into asking for one: never one click from running.
    if (isWriteStage(op)) return null;
    stages.push({ id: i + 1, op, body: readable((stage as Record<string, unknown>)[op]), enabled: true });
  }
  return stages;
}

/**
 * What Open as query (and History's Load) fills a tab with, or null when the
 * row offers Copy only: anything but an `ok` find, count or aggregate, a
 * request cut at the size cap, a request that does not parse into that
 * tool's shape, or a row with no Connection, database or collection.
 */
export function querySeed(row: AgentCallRow): QuerySeed | null {
  if (row.outcome !== 'ok' || !OPENABLE_TOOLS.has(row.tool)) return null;
  if (row.requestTruncated || row.request === null) return null;
  if (!row.connectionId || !row.database || !row.collection) return null;
  let request: unknown;
  try {
    request = ejsonParse(row.request);
  } catch {
    return null;
  }
  if (!isPlainDocument(request)) return null;
  const args = request as Record<string, unknown>;
  const target: QueryTarget = { connectionId: row.connectionId, database: row.database, collection: row.collection };
  if (row.tool === 'aggregate') {
    const stages = pipelineStages(Object.hasOwn(args, 'pipeline') ? args.pipeline : undefined);
    return stages ? { kind: 'aggregate', ...target, stages } : null;
  }
  const own = (key: string) => (Object.hasOwn(args, key) ? args[key] : undefined);
  const queryRaw = documentText(own('filter'), '{}');
  // A count takes a filter only.
  const sort = row.tool === 'find' ? documentText(own('sort'), '') : '';
  const projectionRaw = row.tool === 'find' ? documentText(own('projection'), '') : '';
  if (queryRaw === null || sort === null || projectionRaw === null) return null;
  return { kind: 'find', ...target, queryRaw, sort, projectionRaw };
}

/** Open as query is offered only where `querySeed` has something to open. */
export function canOpenAsQuery(row: AgentCallRow): boolean {
  return querySeed(row) !== null;
}

/**
 * A find seed as a saved find, so it loads through the one path a saved
 * query takes (`hydrateFindPayload`): the filter, sort and projection, and
 * nothing else of the tab's builder kept, since the Agent sent nothing else.
 */
export function findSeedPayload(seed: FindSeed): LegacySavedFindPayload {
  return {
    kind: 'find',
    queryRaw: seed.queryRaw,
    builder: {
      conditions: [],
      logic: 'AND',
      sort: seed.sort,
      limit: '',
      projection: [],
      projectionRaw: seed.projectionRaw,
    } as LegacySavedFindPayload['builder'],
  };
}

/** A short session id for display: the first eight characters. */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : '';
}

/** What an Activity list shows: the `list-calls` filter without its paging. */
export type ActivityFilter = Omit<AgentCallsQuery, 'before' | 'limit'>;

/** Whether a call pushed live belongs in a list read with `filter`, as main's own filter would answer. */
export function callMatches(call: AgentCallSummary, filter: ActivityFilter): boolean {
  if (filter.outcome === 'ok' && call.outcome !== 'ok') return false;
  if (filter.outcome === 'refused' && !isRefusedOutcome(call.outcome)) return false;
  const keys = ['sessionId', 'tokenId', 'connectionId', 'database', 'collection', 'tool'] as const;
  return keys.every((k) => filter[k] === undefined || filter[k] === call[k]);
}

/** One Connection a session called, as a pill: reached, or refused with the code in words. */
export interface ReachedConnection {
  connectionId: string;
  label: string;
  tone: 'ok' | 'warn';
}

/**
 * The Connections a session reached (X30 §5.2), by name: one an `ok` call
 * reached is a plain pill; one only refused reads "refused, not open" from
 * its newest refusal; one only asked about reads "asked to open". Sorted by
 * name.
 */
export function reachedConnections(
  calls: ReadonlyArray<Pick<AgentCallSummary, 'connectionId' | 'connectionName' | 'outcome' | 'ts'>>,
): ReachedConnection[] {
  const by = new Map<string, { name: string; ok: boolean; refusal: { ts: string; outcome: string } | null }>();
  for (const c of calls) {
    if (!c.connectionId) continue;
    const seen = by.get(c.connectionId) ?? { name: c.connectionName ?? 'Connection', ok: false, refusal: null };
    if (c.outcome === 'ok') seen.ok = true;
    else if (isRefusedOutcome(c.outcome) && (seen.refusal === null || c.ts > seen.refusal.ts)) seen.refusal = { ts: c.ts, outcome: c.outcome };
    by.set(c.connectionId, seen);
  }
  return [...by.entries()]
    .map(([connectionId, s]): ReachedConnection => {
      if (s.ok) return { connectionId, label: s.name, tone: 'ok' };
      if (s.refusal) return { connectionId, label: `${s.name} · refused, ${outcomeWords(s.refusal.outcome)}`, tone: 'warn' };
      return { connectionId, label: `${s.name} · asked to open`, tone: 'warn' };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

const END_REASON_WORDS: Readonly<Record<AgentSessionEndReason, string>> = {
  'client-closed': 'the client closed it',
  'user-ended': 'you ended it',
  'token-revoked': 'its token was revoked',
  'access-off': 'Agent Access was turned off',
  'app-quit': "L'Atelier quit",
  unknown: 'reason not known',
};

/** Why a session ended, in words. */
export function endReasonWords(reason: AgentSessionEndReason | null): string {
  return END_REASON_WORDS[reason ?? 'unknown'];
}
