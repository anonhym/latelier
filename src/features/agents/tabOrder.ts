/**
 * The Agents tab in the strip's keyboard order (X30 §4). It is never stored,
 * so it has no id of its own in `workspace_tabs`: this sentinel stands for it.
 * It is drawn last, so ⌘1–⌘9 and ⌘⌥←/→ count it last.
 */
export const AGENTS_TAB_ID = '\u0000agents-tab';

/** The strip's ids in on-screen order, with the Agents tab at the end while it is open. */
export function stripOrder(storedIds: readonly string[], agentsOpen: boolean): string[] {
  return agentsOpen ? [...storedIds, AGENTS_TAB_ID] : [...storedIds];
}

/**
 * The tab ⌘⌥→ (`step` 1) or ⌘⌥← (`step` -1) moves to, wrapping at both ends.
 * With no focused tab it starts from the first; a focused id that is not in
 * the order moves nowhere.
 */
export function steppedTab(order: readonly string[], focusedId: string | null, step: 1 | -1): string | null {
  if (order.length === 0) return null;
  const at = focusedId === null ? 0 : order.indexOf(focusedId);
  if (at === -1) return null;
  return order[(at + step + order.length) % order.length]!;
}

/** The tab ⌘{n} focuses, 1-based; null past the end. */
export function nthTab(order: readonly string[], n: number): string | null {
  // Zero, negative and fractional n index nothing in an array, so they land on null too.
  return order[n - 1] ?? null;
}
