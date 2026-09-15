import React from 'react';
import { SettingsModal } from './SettingsModal';

interface SettingsApi {
  open: () => void;
}

const Ctx = React.createContext<SettingsApi>({ open: () => {} });

// eslint-disable-next-line react-refresh/only-export-components
export function useSettings(): SettingsApi {
  return React.useContext(Ctx);
}

/**
 * Mounts the settings modal at App level so any route — including the
 * command palette — can open it without owning local state.
 */
export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const api = React.useMemo<SettingsApi>(() => ({ open: () => setOpen(true) }), []);
  return (
    <Ctx.Provider value={api}>
      {children}
      {open && <SettingsModal onClose={() => setOpen(false)} />}
    </Ctx.Provider>
  );
}
