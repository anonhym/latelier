import React from 'react';
import { api } from '../../api/atelier';
import { logFailure } from '../../utils/rendererLog';
import { UpdatePillPresenceContext, UpdateStateContext } from './updateStateContext';
import type { UpdateState } from '@shared/types';

/**
 * Reads the updater's state once and follows its pushes, so every surface that
 * shows it (status-bar pill, Settings, palette, toast) shares one subscription.
 */
export function UpdateStateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<UpdateState>({ status: 'idle' });

  React.useEffect(() => {
    // A push that lands before the first read answers is newer than that read.
    let pushed = false;
    let cancelled = false;
    const unsubscribe = api.updates.onState((s) => {
      pushed = true;
      setState(s);
    });
    api.updates
      .getState()
      .then((s) => {
        if (!cancelled && !pushed) setState(s);
      })
      // Every surface is optional: a failed read leaves them quiet, and an
      // update that is ready still installs on quit.
      .catch((err) => logFailure('reading the update state', err));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // A count, not a flag: a remount mounts the new pill before the old one unmounts.
  const [pills, setPills] = React.useState(0);
  const register = React.useCallback(() => {
    setPills((n) => n + 1);
    return () => setPills((n) => n - 1);
  }, []);
  const presence = React.useMemo(() => ({ mounted: pills > 0, register }), [pills, register]);

  return (
    <UpdateStateContext.Provider value={state}>
      <UpdatePillPresenceContext.Provider value={presence}>{children}</UpdatePillPresenceContext.Provider>
    </UpdateStateContext.Provider>
  );
}
