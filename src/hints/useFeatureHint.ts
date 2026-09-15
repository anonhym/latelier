import React from 'react';
import type { FeatureHintId } from '@shared/types';
import { useHints } from './HintsContext';

export interface UseFeatureHintResult {
  visible: boolean;
  dismiss: () => void;
}

// Suppress all feature hints under the e2e harness. Hints are floating
// popovers that race against test clicks (palette.discover, saved.create,
// etc.) and add no value to assertions.
const isTestEnv =
  typeof window !== 'undefined' &&
  (window as unknown as { __atelierEnv__?: { isTest?: boolean } }).__atelierEnv__?.isTest === true;

export function useFeatureHint(
  id: FeatureHintId,
  when: boolean,
): UseFeatureHintResult {
  const {
    loaded,
    settled,
    isDismissed,
    visibleId,
    registerCandidate,
    unregisterCandidate,
    dismiss: hintsDismiss,
  } = useHints();

  const eligible = !isTestEnv && loaded && when && !isDismissed(id);

  React.useEffect(() => {
    if (!eligible) return;
    registerCandidate(id);
    return () => unregisterCandidate(id);
  }, [eligible, id, registerCandidate, unregisterCandidate]);

  const visible = eligible && settled && visibleId === id;
  const dismiss = React.useCallback(() => hintsDismiss(id), [hintsDismiss, id]);

  return { visible, dismiss };
}
