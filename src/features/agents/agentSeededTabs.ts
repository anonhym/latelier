/**
 * The collection tabs an Agent's query was loaded into, by Open as query
 * (X30 §5.2) or a History Load (§9). Such a tab never runs by itself: not on
 * landing, not as the launch-restored tab, not when its Connection connects.
 * It runs on the user's own Run, which sets its last run and ends the question.
 * Kept for the app's run: a reload starts from the stored tabs, Agent-free.
 */
const seeded = new Set<string>();

export function markAgentSeeded(tabId: string): void {
  seeded.add(tabId);
}

export function isAgentSeeded(tabId: string): boolean {
  return seeded.has(tabId);
}

/** Tests only. */
export function resetAgentSeeded(): void {
  seeded.clear();
}
