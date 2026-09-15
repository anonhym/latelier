import React from 'react';
import { TroubleshootingCtx, type TroubleshootingApi } from './TroubleshootingContext';
import { TroubleshootingDrawer } from './TroubleshootingDrawer';
import type { RecipeActionHandlers, RecipeMatchInput } from './types';

interface DrawerState {
  open: boolean;
  input: RecipeMatchInput;
  actions: RecipeActionHandlers;
}

/**
 * Focus return used to live here, as a `previousFocus` element captured in
 * `open()` and re-focused from a `queueMicrotask` in `close()`. It later moved
 * into `useDialogFocusReturn`, which the drawer itself calls: one mechanism for
 * every dialog in the app instead of a third private one here, and the shared
 * version additionally declines to reclaim focus a control elsewhere has taken.
 * The capture point is unchanged in practice — `open()` and the drawer's first
 * render happen in the same commit, with nothing in between to move focus.
 */
export function TroubleshootingProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<DrawerState>({
    open: false,
    input: {},
    actions: {},
  });

  const api = React.useMemo<TroubleshootingApi>(
    () => ({
      isOpen: state.open,
      open: (input?: RecipeMatchInput, actions?: RecipeActionHandlers) => {
        setState({ open: true, input: input ?? {}, actions: actions ?? {} });
      },
      close: () => {
        setState({ open: false, input: {}, actions: {} });
      },
    }),
    [state.open],
  );

  return (
    <TroubleshootingCtx.Provider value={api}>
      {children}
      {state.open && (
        <TroubleshootingDrawer
          input={state.input}
          actions={state.actions}
          onClose={api.close}
        />
      )}
    </TroubleshootingCtx.Provider>
  );
}
