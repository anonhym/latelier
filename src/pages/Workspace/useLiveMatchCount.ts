import * as React from 'react';
import { api, isIpcError } from '../../api/atelier';

/** How long the filter has to sit still before it is counted. */
export const LIVE_COUNT_DEBOUNCE_MS = 500;

export type LiveMatchCount =
  | { state: 'idle' }
  | { state: 'counting' }
  | { state: 'ok'; count: number }
  | { state: 'unavailable' };

interface Target {
  connectionId: string;
  dbName: string;
  collection: string;
  /** The committed filter text, never an uncommitted tree: rows that did not print are not counted. */
  queryRaw: string;
  /** True while the tree cannot be trusted to match `queryRaw` (print problems, unparseable text). */
  paused: boolean;
}

/**
 * A debounced `api.query.count` of the committed filter, so the drawer can
 * show "≈1,240 match" before Run. Nothing is asked for an empty filter or
 * while `paused`. After a count times out it stays unavailable until the
 * drawer remounts: a collection that is too big to count in the probe budget
 * should not be asked again on every keystroke. Any other failure (a regex
 * the server rejects, say) belongs to that filter text alone, so the next
 * edit asks again.
 */
export function useLiveMatchCount({
  connectionId,
  dbName,
  collection,
  queryRaw,
  paused,
}: Target): LiveMatchCount {
  const key = `${connectionId}\0${dbName}\0${collection}\0${queryRaw}`;
  const [settled, setSettled] = React.useState<{ key: string; count: number } | null>(null);
  const [failedKey, setFailedKey] = React.useState<string | null>(null);
  const [timedOut, setTimedOut] = React.useState(false);
  const idle = paused || queryRaw.trim() === '{}' || !connectionId || !collection;

  React.useEffect(() => {
    if (idle || timedOut || failedKey === key) return;
    let current = true;
    const timer = setTimeout(() => {
      api.query
        .count({ connectionId, dbName, collection, filter: queryRaw })
        .then(({ count }) => {
          if (current) setSettled({ key, count });
        })
        .catch((e: unknown) => {
          if (!current) return;
          if (isIpcError(e) && e.code === 'TIMEOUT') setTimedOut(true);
          else setFailedKey(key);
        });
    }, LIVE_COUNT_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [idle, timedOut, failedKey, key, connectionId, dbName, collection, queryRaw]);

  if (idle) return { state: 'idle' };
  if (timedOut || failedKey === key) return { state: 'unavailable' };
  if (settled?.key === key) return { state: 'ok', count: settled.count };
  return { state: 'counting' };
}
