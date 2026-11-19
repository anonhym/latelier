import React from 'react';
import type { EffectiveRowSummary } from '@shared/types';
import { api } from '../../api/atelier';
import { logFailure } from '../../utils/rendererLog';

// The picker and the Tree view are separate components with no common parent
// state, so a save announces itself here and every mounted reader re-asks.
const changed = new EventTarget();

export function notifyRowSummaryChanged(): void {
  changed.dispatchEvent(new Event('changed'));
}

/**
 * The Row Summary a Connection uses for one Collection: its own, else its
 * Family's, else `null` (the Tree row then falls back to the Fields list).
 * A blank id reads nothing, for the providers that have no Connection.
 */
export function useRowSummary(
  connectionId: string | null,
  dbName: string | null,
  collection: string | null,
): { summary: EffectiveRowSummary | null; loaded: boolean; reload: () => Promise<void> } {
  // Held with the namespace it was read for: another Collection's summary is not this one's while its own is read.
  const key = `${connectionId}\u0000${dbName}\u0000${collection}`;
  const [read, setRead] = React.useState<{ key: string; summary: EffectiveRowSummary | null } | null>(null);
  const summary = read?.key === key ? read.summary : null;
  const loaded = read?.key === key;

  // Only the newest read may settle: a slower answer for the previous Collection must not overwrite this one's.
  const latest = React.useRef(0);

  const reload = React.useCallback(async () => {
    const mine = ++latest.current;
    if (!connectionId || !dbName || !collection) {
      setRead({ key, summary: null });
      return;
    }
    try {
      const next = await api.rowSummary.get({ connectionId, dbName, collection });
      if (mine === latest.current) setRead({ key, summary: next });
    } catch (err) {
      // The row keeps today's behaviour; the reason goes to the log, not the screen.
      logFailure('row summary read', err);
      if (mine === latest.current) setRead({ key, summary: null });
    }
  }, [connectionId, dbName, collection, key]);


  React.useEffect(() => {
    queueMicrotask(() => void reload());
  }, [reload]);

  React.useEffect(() => {
    const onChanged = () => void reload();
    changed.addEventListener('changed', onChanged);
    return () => changed.removeEventListener('changed', onChanged);
  }, [reload]);

  return { summary, loaded, reload };
}
