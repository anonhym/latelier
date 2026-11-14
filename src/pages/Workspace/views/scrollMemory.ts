/**
 * Remembers each result view's vertical scroll offset per tab, for the life of
 * the window: switching Table → Tree → Table, or to another tab and back,
 * lands where the reader left off. Not persisted; a reload starts at the top.
 */
const offsets = new Map<string, number>();

const keyOf = (tabId: string, view: string) => `${tabId}:${view}`;

export function rememberScroll(tabId: string, view: string, offset: number): void {
  if (!Number.isFinite(offset) || offset < 0) {
    throw new RangeError(`scroll offset must be a finite number >= 0, got ${offset}`);
  }
  offsets.set(keyOf(tabId, view), offset);
}

export function recallScroll(tabId: string, view: string): number {
  return offsets.get(keyOf(tabId, view)) ?? 0;
}

/** A closed tab's offsets are dead weight. */
export function forgetScroll(tabId: string): void {
  const prefix = `${tabId}:`;
  for (const key of [...offsets.keys()]) {
    if (key.startsWith(prefix)) offsets.delete(key);
  }
}
