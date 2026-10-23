import React from 'react';
import { api } from '../api/atelier';
import { notify } from '../theme/notifications';
import { PINNED_PREF_KEY, parsePinned, togglePinned } from './connectionPins';

// The switcher popover and the Connections table can be mounted together, so a
// pin toggled in one has to reach the other without a re-read.
const listeners = new Set<(ids: string[]) => void>();

/**
 * The pinned connection ids, read from `ui.connections.pinned`. Ids of
 * connections that no longer exist are dropped when read.
 */
export function usePinnedConnections(connections: readonly { id: string }[]): {
  pinnedIds: ReadonlySet<string>;
  togglePin: (id: string) => Promise<void>;
} {
  const [stored, setStored] = React.useState<string[]>([]);
  // Mirrors `stored` so a toggle reads the latest list even before a re-render.
  const storedRef = React.useRef(stored);
  const apply = React.useCallback((ids: string[]) => {
    storedRef.current = ids;
    setStored(ids);
  }, []);
  const ready = React.useRef<Promise<void>>(Promise.resolve());

  React.useEffect(() => {
    let active = true;
    ready.current = api.prefs
      .get<unknown>(PINNED_PREF_KEY)
      .then((value) => {
        if (active) apply(parsePinned(value));
      })
      .catch(() => {
        notify.error('Could not load pinned connections', { id: 'pins-load-failed' });
      });
    listeners.add(apply);
    return () => {
      active = false;
      listeners.delete(apply);
    };
  }, [apply]);

  const liveIds = React.useMemo(() => new Set(connections.map((c) => c.id)), [connections]);
  const pinnedIds = React.useMemo(
    () => new Set(stored.filter((id) => liveIds.has(id))),
    [stored, liveIds],
  );

  const togglePin = React.useCallback(
    async (id: string) => {
      // A toggle before the first read lands would overwrite what is stored.
      await ready.current;
      const before = storedRef.current;
      const next = togglePinned(before, id, liveIds);
      const publish = (ids: string[]) => listeners.forEach((fn) => fn(ids));
      publish(next);
      try {
        await api.prefs.set(PINNED_PREF_KEY, next);
      } catch {
        publish(before);
        notify.error('Could not save pinned connections', { id: 'pins-save-failed' });
      }
    },
    [liveIds],
  );

  return { pinnedIds, togglePin };
}
