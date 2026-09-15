import { useMemo, type ReactNode } from 'react';
import {
  CollectionWorkspaceContext,
  type CollectionWorkspaceActions,
  type CollectionWorkspaceContextValue,
  type CollectionWorkspaceMeta,
} from './context';
import type { CollectionTabState } from '@shared/types';

interface CollectionWorkspaceProviderProps {
  state: CollectionTabState;
  actions: CollectionWorkspaceActions;
  meta: CollectionWorkspaceMeta;
  children: ReactNode;
}

/**
 * Scopes the active-collection slice — state, actions, identity — to a
 * subtree without forcing a second `useWorkspaceTabs()` call. The parent
 * (Workspace page, saved-query preview, etc.) owns the real state and wires
 * the actions/meta on the way in.
 *
 * Memoises the context value so unrelated parent re-renders don't churn
 * consumer identity. Callers MUST supply already-stable `actions` and
 * `meta` references (i.e. memoise them upstream) — this provider does not
 * re-stabilise them.
 */
export function CollectionWorkspaceProvider({
  state,
  actions,
  meta,
  children,
}: CollectionWorkspaceProviderProps) {
  const value = useMemo<CollectionWorkspaceContextValue>(
    () => ({ state, actions, meta }),
    [state, actions, meta],
  );
  return (
    <CollectionWorkspaceContext.Provider value={value}>
      {children}
    </CollectionWorkspaceContext.Provider>
  );
}
