// One-shot requests to a collection tab, raised from outside it (the palette)
// and honoured by the tab's own control, so the dialog or run is the one that
// control opens: the ResultBar's Export dialog, the QueryBar's Explain, the
// Aggregation tab's Run.

export type TabRequestKind = 'export' | 'explain' | 'runPipeline';

const pending: Record<TabRequestKind, string | null> = { export: null, explain: null, runPipeline: null };
const listeners = new Set<() => void>();

/** Asks tab `tabId` to act on `kind` once; replaces an older request of that kind. */
export function requestTab(kind: TabRequestKind, tabId: string): void {
  pending[kind] = tabId;
  for (const l of listeners) l();
}

/** Whether tab `tabId` has a `kind` request waiting. */
export function tabRequested(kind: TabRequestKind, tabId: string): boolean {
  return pending[kind] === tabId;
}

/** Clears tab `tabId`'s `kind` request, so it cannot fire twice. */
export function consumeTabRequest(kind: TabRequestKind, tabId: string): void {
  if (pending[kind] === tabId) pending[kind] = null;
}

export function subscribeTabRequests(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Test-only. */
export function _resetTabRequestsForTests(): void {
  pending.export = null;
  pending.explain = null;
  pending.runPipeline = null;
}
