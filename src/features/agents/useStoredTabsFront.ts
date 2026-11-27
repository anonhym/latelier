import React from 'react';
import type { WorkspaceTabsState } from '../../state/workspaceTabs';

function first<F extends (...args: never[]) => unknown>(before: () => void, f: F): F {
  return ((...args: Parameters<F>) => {
    before();
    return f(...args);
  }) as F;
}

/**
 * The stored tabs, where every way a person brings one forward (opening or
 * reusing a tab, choosing one, reopening a closed one) first steps the Agents
 * tab back (X30 §4). Only these: a stored tab that comes forward on its own
 * (the list loading, a neighbour taking over from a closed tab) leaves the
 * Agents tab in front.
 */
export function useStoredTabsFront(tabs: WorkspaceTabsState, unfocusAgents: () => void): WorkspaceTabsState {
  const { openCollection, openAggregation, openScript, openServer, setActive, reopenClosed } = tabs;
  const wrapped = React.useMemo(
    () => ({
      openCollection: first(unfocusAgents, openCollection),
      openAggregation: first(unfocusAgents, openAggregation),
      openScript: first(unfocusAgents, openScript),
      openServer: first(unfocusAgents, openServer),
      setActive: first(unfocusAgents, setActive),
      // Only once a tab did come back: with nothing to reopen, the Agents tab stays.
      reopenClosed: async (isLive: (connectionId: string) => boolean) => {
        const reopened = await reopenClosed(isLive);
        if (reopened) unfocusAgents();
        return reopened;
      },
    }),
    [unfocusAgents, openCollection, openAggregation, openScript, openServer, setActive, reopenClosed],
  );
  return { ...tabs, ...wrapped };
}
