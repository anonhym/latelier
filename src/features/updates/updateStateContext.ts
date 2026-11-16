import React from 'react';
import type { UpdateState } from '@shared/types';

/** Outside a provider the app reads as "nothing to report", so a bare screen in a test needs no wrapper. */
export const UpdateStateContext = React.createContext<UpdateState>({ status: 'idle' });

/** The one renderer-side copy of the updater's state, shared by the pill, Settings, the palette and the toast. */
export function useUpdateState(): UpdateState {
  return React.useContext(UpdateStateContext);
}

/** A clock that ticks once a minute while mounted, so "last checked N min ago" stays true. */
export function useMinuteClock(): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
