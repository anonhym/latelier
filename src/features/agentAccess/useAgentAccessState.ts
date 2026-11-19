import React from 'react';
import { api } from '../../api/atelier';
import { logFailure } from '../../utils/rendererLog';
import type { AgentAccessState } from '@shared/types';

/**
 * Agent Access state, read once and kept current by main's push. A hook with
 * local state, not a context: each caller is cheap and event-driven. `null`
 * until the first read lands, or when it failed (the failure is logged).
 */
export function useAgentAccessState(): AgentAccessState | null {
  const [state, setState] = React.useState<AgentAccessState | null>(null);
  React.useEffect(() => {
    let active = true;
    let off: (() => void) | undefined;
    try {
      off = api.agentAccess.onState((s) => {
        if (active) setState(s);
      });
      api.agentAccess
        .getState()
        .then((s) => {
          if (active) setState((cur) => cur ?? s);
        })
        .catch((err: unknown) => logFailure('reading Agent Access state', err));
    } catch (err) {
      logFailure('subscribing to Agent Access state', err);
    }
    return () => {
      active = false;
      off?.();
    };
  }, []);
  return state;
}
