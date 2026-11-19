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
  const [family, setFamily] = React.useState<{ id: string; name: string } | null>(null);
  React.useEffect(() => {
    let live = true;
    api.families
      .list()
      .then((all) => {
        if (!live) return;
        const mine = all.find((f) => f.memberIds.includes(connectionId));
        setFamily(mine ? { id: mine.id, name: mine.name } : null);
      })
      .catch((err) => logFailure('family list', err));
    return () => {
      live = false;
    };
  }, [connectionId]);
  return family;
}
