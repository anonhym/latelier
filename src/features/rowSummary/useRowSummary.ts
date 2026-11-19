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
  const [summary, setSummary] = React.useState<EffectiveRowSummary | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  const reload = React.useCallback(async () => {
    if (!connectionId || !dbName || !collection) {
      setSummary(null);
      setLoaded(true);
      return;
    }
    try {
      setSummary(await api.rowSummary.get({ connectionId, dbName, collection }));
    } catch (err) {
      // The row keeps today's behaviour; the reason goes to the log, not the screen.
      logFailure('row summary read', err);
      setSummary(null);
    } finally {
      setLoaded(true);
    }
  }, [connectionId, dbName, collection]);

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
