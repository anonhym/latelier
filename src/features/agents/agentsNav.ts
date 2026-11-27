import type { AgentsPage } from './agentsPage';

/**
 * A request to show an Agents page from outside the Workspace: Settings →
 * Agent Access is mounted above the routes and cannot reach the Workspace's
 * state. The request waits here until the Workspace takes it, so one made
 * while the Workspace is not mounted is still honoured when it mounts.
 */
let pending: AgentsPage | null = null;
const listeners = new Set<() => void>();

export function requestAgentsPage(page: AgentsPage): void {
  pending = page;
  for (const fn of listeners) fn();
}

/** Takes the waiting request, if any; a request is answered once. */
export function takeAgentsPageRequest(): AgentsPage | null {
  const page = pending;
  pending = null;
  return page;
}

/** Calls `fn` on each new request; returns the unsubscribe. */
export function onAgentsPageRequest(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
