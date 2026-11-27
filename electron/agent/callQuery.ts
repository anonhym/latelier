import type { AgentCallsQuery, AgentSessionsQuery } from '@shared/types';

/**
 * The SQL filters behind `agentAccess:list-calls` and `list-sessions`
 * (X27 §16.5), kept apart from the repositories so the mapping from a
 * validated query to clauses can be tested without a database. Every value is
 * bound by name; only column names and fixed literals are written into the SQL.
 */
export interface SqlFilter {
  /** Empty, or `WHERE …`. */
  where: string;
  params: Record<string, string | number>;
}

/** Outcomes that are neither a success nor the asking round of a paused call. */
export const REFUSED_OUTCOME_SQL = "outcome NOT IN ('ok', 'INPUT_REQUIRED')";

const CALL_COLUMNS = [
  ['sessionId', 'session_id'],
  ['tokenId', 'token_id'],
  ['connectionId', 'connection_id'],
  ['database', 'database'],
  ['collection', 'collection'],
  ['tool', 'tool'],
] as const;

function filter(clauses: string[], params: Record<string, string | number>): SqlFilter {
  return { where: clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`, params };
}

/** Newest first on `(ts, id)`: `before` is the last row of the previous page, and the next page starts strictly after it. */
export function callsFilter(query: AgentCallsQuery): SqlFilter {
  const clauses: string[] = [];
  const params: Record<string, string | number> = {};
  for (const [key, column] of CALL_COLUMNS) {
    const value = query[key];
    if (value === undefined) continue;
    clauses.push(`${column} = @${key}`);
    params[key] = value;
  }
  if (query.outcome === 'ok') clauses.push("outcome = 'ok'");
  else if (query.outcome === 'refused') clauses.push(REFUSED_OUTCOME_SQL);
  if (query.before) {
    clauses.push('(ts < @beforeTs OR (ts = @beforeTs AND id < @beforeId))');
    params.beforeTs = query.before.ts;
    params.beforeId = query.before.id;
  }
  return filter(clauses, params);
}

/** Newest first on `(started_at, id)`, paged the same way as the calls. */
export function sessionsFilter(query: AgentSessionsQuery): SqlFilter {
  const clauses: string[] = [];
  const params: Record<string, string | number> = {};
  if (query.tokenId !== undefined) {
    clauses.push('token_id = @tokenId');
    params.tokenId = query.tokenId;
  }
  if (!query.includeEnded) clauses.push('ended_at IS NULL');
  if (query.before) {
    clauses.push('(started_at < @beforeStartedAt OR (started_at = @beforeStartedAt AND id < @beforeId))');
    params.beforeStartedAt = query.before.startedAt;
    params.beforeId = query.before.id;
  }
  return filter(clauses, params);
}

/**
 * Whether a stored request is the marker `capRequestJson` writes in place of
 * one over the cap. An Agent can send `{"truncated":true}` itself, so only the
 * marker's whole shape counts: exactly those three keys, and a size over the cap.
 */
export function isTruncatedMarker(text: string, capBytes: number): boolean {
  if (!text.startsWith('{"truncated":true,')) return false;
  let value: Record<string, unknown>;
  try {
    // Text that opens with `{` parses to an object or not at all.
    value = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Not JSON, so not the marker, which is always written by JSON.stringify.
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.length === 3 &&
    value.truncated === true &&
    typeof value.bytes === 'number' &&
    value.bytes > capBytes &&
    typeof value.head === 'string'
  );
}
