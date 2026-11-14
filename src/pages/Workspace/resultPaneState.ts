import type { CollectionTabState, ConnectionSummary, LastQuery } from '@shared/types';
import { findProblem, isUnfilteredFirstPage, resultQueryKey } from './builder';

export type ResultPaneKind =
  | 'rows'
  | 'never-run'
  | 'empty-collection'
  | 'no-match'
  | 'query-error'
  | 'failed';

// The query is not what these are about, so going back to another query would
// not help. Anything else that fails a find is the server's answer to the query.
const NOT_THE_QUERYS_FAULT = new Set(['NETWORK', 'UNAUTHORIZED', 'DB_ERROR', 'INTERNAL']);

/** What the results pane shows for the last run. */
export function resultPaneKind(state: CollectionTabState): ResultPaneKind {
  const run = state.lastRun;
  if (!run) return 'never-run';
  // A run the client refused keeps its rows: they stay, marked as not current, until the text can run.
  if (run.documents.length > 0) return 'rows';
  if (run.error) return NOT_THE_QUERYS_FAULT.has(run.error.code) ? 'failed' : 'query-error';
  // An empty result only says the collection is empty if `{}` is what ran, not
  // merely what the box says now.
  const editedSince =
    state.lastRunQueryKey !== undefined && resultQueryKey(state) !== state.lastRunQueryKey;
  return isUnfilteredFirstPage(state) && !editedSince ? 'empty-collection' : 'no-match';
}

/**
 * The query "Revert to last valid query" would load, or null when there is
 * nothing to go back to: none has succeeded in this tab, or the one that did is
 * the query that just failed (a dropped index, say), so reverting would only
 * fail again.
 */
export function revertTarget(state: CollectionTabState): LastQuery | null {
  const last = state.lastValidQuery;
  if (!last) return null;
  const same =
    last.queryRaw === state.queryRaw && JSON.stringify(last.builder) === JSON.stringify(state.builder);
  return same ? null : last;
}

/**
 * Whether the rows on screen answer another query than the one in the bar
 * (W06 §8.2): it was edited since they arrived, or it cannot run as written.
 * A run from before `lastRunQueryKey` existed has nothing to compare against.
 */
export function isResultStale(state: CollectionTabState): boolean {
  if (!state.lastRun) return false;
  if (findProblem(state) !== null) return true;
  return state.lastRunQueryKey !== undefined && resultQueryKey(state) !== state.lastRunQueryKey;
}

export type BandOccupant = 'lost' | 'running' | 'cancelled' | 'stale' | 'selection' | 'none';

/**
 * Who holds the fixed band above the rows. Losing the connection outranks a
 * find that cannot finish; a find about to replace the rows, then one just
 * cancelled, outrank saying the rows are not current; and all of them outrank
 * a selection.
 */
export function bandOccupant(state: {
  lost: boolean;
  running: boolean;
  cancelled: boolean;
  stale: boolean;
  selected: boolean;
}): BandOccupant {
  if (state.lost) return 'lost';
  if (state.running) return 'running';
  if (state.cancelled) return 'cancelled';
  if (state.stale) return 'stale';
  return state.selected ? 'selection' : 'none';
}

/**
 * The connection whose failure the empty workspace explains: the latest to
 * fail. `connectErrors` gains its key on each failure and loses it on the next
 * attempt, so its last key is the most recent. A connection already failed when
 * the list loaded may have no entry yet, and still counts.
 */
export function latestFailedConnection(
  connections: readonly ConnectionSummary[],
  connectErrors: Record<string, unknown>,
): ConnectionSummary | null {
  const failed = connections.filter((c) => c.status === 'error');
  const latestId = Object.keys(connectErrors).at(-1);
  return failed.find((c) => c.id === latestId) ?? failed[0] ?? null;
}
