import React from 'react';
import { api } from '../../api/atelier';
import { logFailure } from '../../utils/rendererLog';

export type SidebarMode = 'databases' | 'agents';

export const SIDEBAR_MODE_KEY = 'sidebar.mode';

function isSidebarMode(v: unknown): v is SidebarMode {
  return v === 'databases' || v === 'agents';
}

/**
 * The sidebar's mode (X30 §2), kept in `app_state` so it survives a relaunch.
 * Databases until the stored value is read; anything unreadable stays there.
 */
export function useSidebarMode(): [SidebarMode, (mode: SidebarMode) => void] {
  const [mode, setModeState] = React.useState<SidebarMode>('databases');
  // A choice made before the stored value arrives wins over it.
  const chosen = React.useRef(false);
  React.useEffect(() => {
    let live = true;
    api.prefs
      .get(SIDEBAR_MODE_KEY)
      .then((v) => {
        if (live && !chosen.current && isSidebarMode(v)) setModeState(v);
      })
      .catch((err: unknown) => logFailure('reading the sidebar mode', err));
    return () => {
      live = false;
    };
  }, []);
  const setMode = React.useCallback((next: SidebarMode) => {
    chosen.current = true;
    setModeState(next);
    api.prefs.set(SIDEBAR_MODE_KEY, next).catch((err: unknown) => logFailure('saving the sidebar mode', err));
  }, []);
  return [mode, setMode];
}
