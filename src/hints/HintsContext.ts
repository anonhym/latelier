import React from 'react';
import type { FeatureHintId } from '@shared/types';

export interface HintsContextValue {
  loaded: boolean;
  settled: boolean;
  isDismissed: (id: FeatureHintId) => boolean;
  dismiss: (id: FeatureHintId) => void;
  reset: () => void;
  registerCandidate: (id: FeatureHintId) => void;
  unregisterCandidate: (id: FeatureHintId) => void;
  visibleId: FeatureHintId | null;
  recordSessionEvent: (kind: string, key: string) => void;
  getSessionEventCount: (kind: string, key: string) => number;
}

export const HintsContext = React.createContext<HintsContextValue | null>(null);

// Inert defaults used when no provider is mounted (e.g. component tests that
// render Workspace standalone). Hints stay invisible; sessions counters
// always read 0; dismiss/reset are no-ops.
const NULL_HINTS: HintsContextValue = {
  loaded: false,
  settled: false,
  isDismissed: () => true,
  dismiss: () => {},
  reset: () => {},
  registerCandidate: () => {},
  unregisterCandidate: () => {},
  visibleId: null,
  recordSessionEvent: () => {},
  getSessionEventCount: () => 0,
};

export function useHints(): HintsContextValue {
  return React.useContext(HintsContext) ?? NULL_HINTS;
}
