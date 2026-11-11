// A one-shot request to open a collection tab's Export dialog, raised from
// outside the tab (the palette's Export… action) and honoured by that tab's
// own ResultBar, so the dialog is the one its Export… menu item opens.

let pendingTabId: string | null = null;
const listeners = new Set<() => void>();

/** Asks the ResultBar of tab `tabId` to open its Export dialog once. */
export function requestExport(tabId: string): void {
  pendingTabId = tabId;
  for (const l of listeners) l();
}

/** Whether tab `tabId` has an export request waiting. */
export function exportRequested(tabId: string): boolean {
  return pendingTabId === tabId;
}

/** Clears tab `tabId`'s request, so it cannot fire twice. */
export function consumeExport(tabId: string): void {
  if (pendingTabId === tabId) pendingTabId = null;
}

export function subscribeExport(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Test-only. */
export function _resetExportRequestForTests(): void {
  pendingTabId = null;
}
