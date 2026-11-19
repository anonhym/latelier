import React from 'react';
import { api } from '../../api/atelier';
import { logFailure } from '../../utils/rendererLog';

/**
 * The Connection Family a Connection belongs to, or `null` for none. Surfaces
 * that save a setting use it to decide whether the setting is shared by default.
 * `null` while loading and when the read fails: a surface then saves locally,
 * the same as for a Connection with no Family.
 */
export function useConnectionFamily(connectionId: string): { id: string; name: string } | null {
  // Held with the Connection it was read for, so another Connection's Family never stands in for this one's while it loads or if the read fails.
  const [read, setRead] = React.useState<{ connectionId: string; family: { id: string; name: string } | null } | null>(null);
  React.useEffect(() => {
    let live = true;
    api.families
      .list()
      .then((all) => {
        if (!live) return;
        const mine = all.find((f) => f.memberIds.includes(connectionId));
        setRead({ connectionId, family: mine ? { id: mine.id, name: mine.name } : null });
      })
      .catch((err) => {
        if (live) setRead({ connectionId, family: null });
        logFailure('family list', err);
      });
    return () => {
      live = false;
    };
  }, [connectionId]);
  return read?.connectionId === connectionId ? read.family : null;
}
