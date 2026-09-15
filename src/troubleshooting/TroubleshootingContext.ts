import React from 'react';
import type { RecipeActionHandlers, RecipeMatchInput } from './types';

export interface TroubleshootingApi {
  open: (input?: RecipeMatchInput, actions?: RecipeActionHandlers) => void;
  close: () => void;
  isOpen: boolean;
}

export const TroubleshootingCtx = React.createContext<TroubleshootingApi>({
  open: () => {},
  close: () => {},
  isOpen: false,
});

export function useTroubleshooting(): TroubleshootingApi {
  return React.useContext(TroubleshootingCtx);
}
