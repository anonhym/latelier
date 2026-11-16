import React from 'react';

export interface WhatsNewControls {
  /** Shows the current version's release only, as Settings and the palette do. */
  open: () => void;
}

export const WhatsNewContext = React.createContext<WhatsNewControls | null>(null);

export function useWhatsNew(): WhatsNewControls {
  const ctx = React.useContext(WhatsNewContext);
  if (!ctx) throw new Error('useWhatsNew must be used inside <WhatsNewProvider>');
  return ctx;
}
