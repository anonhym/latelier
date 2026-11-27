import React from 'react';
import { HOME_PAGE, type AgentsPage } from './agentsPage';

/**
 * The one Agents tab (X30 §4, W01 §15). Renderer-only: it is never sent to
 * `tabs:*` and never stored, so the stored tabs' focus (`tabs.activeId`) is
 * left as it was while this tab is in front. That is what restores the last
 * focused stored tab after a quit with this one focused.
 */
export interface AgentsTabState {
  open: boolean;
  focused: boolean;
  /** The page it shows, or showed last in this run. */
  page: AgentsPage;
}

export interface AgentsTabApi extends AgentsTabState {
  /** Opens it, or brings it forward, on `page`, or on the page it last showed. */
  show: (page?: AgentsPage) => void;
  /** Lets a stored tab come forward; the Agents tab stays in the strip. */
  unfocus: () => void;
  close: () => void;
}

const CLOSED: AgentsTabState = { open: false, focused: false, page: HOME_PAGE };

export function useAgentsTab(): AgentsTabApi {
  const [state, setState] = React.useState<AgentsTabState>(CLOSED);
  const show = React.useCallback((page?: AgentsPage) => {
    setState((s) => ({ open: true, focused: true, page: page ?? s.page }));
  }, []);
  const unfocus = React.useCallback(() => {
    setState((s) => (s.focused ? { ...s, focused: false } : s));
  }, []);
  const close = React.useCallback(() => {
    // The page it showed is kept: the next switch to Agents opens it there.
    setState((s) => ({ ...s, open: false, focused: false }));
  }, []);
  return React.useMemo(() => ({ ...state, show, unfocus, close }), [state, show, unfocus, close]);
}
