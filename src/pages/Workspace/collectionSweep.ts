import type { ConnectionSummary } from '@shared/types';
import { ownGet } from '../../utils/ownProperty';
import { mostRecentlyConnected } from './locationModel';
import type { ConnectionCache } from './navigatorTreeReducer';

/**
 * The Connection whose collections the palette sweeps and lists (X07 §14.5):
 * the Focused Tab's, or with no tab the most recently connected Open
 * Connection. Null when neither exists. A Focused Tab on a Dormant Connection
 * names that Connection even though nothing of it is listed: the palette's
 * "Collections in this connection" is then absent, not another Connection's,
 * since the group names whose collections it holds.
 */
export function sweepConnectionId(
  focusedConnectionId: string | null,
  connections: readonly ConnectionSummary[],
): string | null {
  return focusedConnectionId ?? mostRecentlyConnected(connections)?.id ?? null;
}

/**
 * Whether a sweep of `cache` still has something to list: the database list is
 * on its way, or a database has no collection list and none failed. A listing
 * that finished without a list (collsLoading false) is a failure, not a wait,
 * and so is a failed database list.
 */
export function isSweepPending(cache: ConnectionCache | undefined): boolean {
  if (!cache) return true;
  if (cache.err) return false;
  if (!cache.dbs) return true;
  return cache.dbs.some((d) => !ownGet(cache.colls, d.name) && ownGet(cache.collsLoading, d.name) !== false);
}
