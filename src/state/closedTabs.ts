import type { CollectionTabState, ScriptTabState, WorkspaceTab } from '@shared/types';

/**
 * The tabs closed this session, newest first (W01 §14.8). Renderer memory
 * only: a relaunch starts empty. Pure so the cap and the reopen order stay
 * testable without the tab hook.
 */
export const CLOSED_TAB_CAP = 10;

interface ClosedBase {
  connectionId: string;
  pinned: boolean;
}
export type ClosedTab =
  | (ClosedBase & { kind: 'collection'; dbName: string; collection: string; state: CollectionTabState })
  | (ClosedBase & { kind: 'script'; state: ScriptTabState });

/**
 * What reopening needs from `tab`. A run's result is left behind: it is never
 * persisted, can be large, and the reopened tab re-runs for a fresh one.
 */
export function closedTabOf(tab: WorkspaceTab): ClosedTab {
  if (tab.kind === 'script') {
    const state: ScriptTabState = { ...tab.state };
    delete state.lastResult;
    delete state.lastError;
    return { kind: 'script', connectionId: tab.connectionId, pinned: tab.pinned, state };
  }
  const state: CollectionTabState = { ...tab.state };
  delete state.lastRun;
  if (state.aggregation) {
    state.aggregation = { ...state.aggregation };
    delete state.aggregation.lastRun;
  }
  return {
    kind: 'collection',
    connectionId: tab.connectionId,
    dbName: tab.dbName,
    collection: tab.collection,
    pinned: tab.pinned,
    state,
  };
}

/** `entry` becomes the newest; the oldest past the cap fall off. */
export function pushClosed(list: readonly ClosedTab[], entry: ClosedTab): ClosedTab[] {
  return [entry, ...list].slice(0, CLOSED_TAB_CAP);
}

/**
 * The newest entry whose Connection still exists, and the list without it.
 * Entries of a Connection that is gone are dropped on the way, newer or older:
 * there is nowhere to reopen them.
 */
export function takeClosed(
  list: readonly ClosedTab[],
  isLive: (connectionId: string) => boolean,
): { entry: ClosedTab | null; rest: ClosedTab[] } {
  const live = list.filter((e) => isLive(e.connectionId));
  const [entry, ...rest] = live;
  return { entry: entry ?? null, rest };
}

/** `list` without `entry` (by identity): an Undo reopens that one, not the newest. */
export function withoutClosed(list: readonly ClosedTab[], entry: ClosedTab): ClosedTab[] {
  return list.filter((e) => e !== entry);
}
