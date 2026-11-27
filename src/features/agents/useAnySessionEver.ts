import React from 'react';
import { api } from '../../api/atelier';
import { logFailure } from '../../utils/rendererLog';

/**
 * Whether any Agent session has ever been recorded: the checklist's last step
 * (X30 §5.1). A live session answers at once; otherwise the stored sessions
 * are asked, again each time the live count changes.
 */
export function useAnySessionEver(liveCount: number): boolean {
  const [stored, setStored] = React.useState(false);
  React.useEffect(() => {
    if (liveCount > 0) return undefined;
    let live = true;
    api.agentAccess.listSessions({ includeEnded: true, limit: 1 }).then(
      (rows) => {
        if (live) setStored(rows.length > 0);
      },
      (err: unknown) => logFailure('listing Agent sessions', err),
    );
    return () => {
      live = false;
    };
  }, [liveCount]);
  return liveCount > 0 || stored;
}
