import type { ConnectionSummary, WorkspaceTab } from '@shared/types';
import { tabLabel } from './tabActions';

// What the title bar's breadcrumb states: the Focused Tab's identity, once.

export type LocationSegment =
  | { kind: 'database'; label: string }
  | { kind: 'collection'; label: string }
  | { kind: 'script'; label: string }
  /** A Connection is open with no tab in front; opens the palette on Collections. */
  | { kind: 'choose'; label: string };

export interface LocationModel {
  /** The first segment's subject; null reads `Select a connection`. */
  connection: ConnectionSummary | null;
  segments: LocationSegment[];
}

/**
 * The Open Connection connected last. A Connection with no connect time (the
 * list was read before its status event) sorts first, so a timed one wins.
 */
export function mostRecentlyConnected(connections: readonly ConnectionSummary[]): ConnectionSummary | null {
  let best: ConnectionSummary | null = null;
  for (const c of connections) {
    if (c.status !== 'connected') continue;
    if (!best || (c.connectedAt ?? '') > (best.connectedAt ?? '')) best = c;
  }
  return best;
}

/** Null when no Connection is saved: the bar draws no breadcrumb at all. */
export function locationModel(
  active: WorkspaceTab | null,
  connections: readonly ConnectionSummary[],
): LocationModel | null {
  if (connections.length === 0) return null;
  if (!active) {
    const connection = mostRecentlyConnected(connections);
    return {
      connection,
      segments: connection ? [{ kind: 'choose', label: 'Choose a collection…' }] : [],
    };
  }
  const connection = connections.find((c) => c.id === active.connectionId) ?? null;
  if (active.kind === 'script') {
    return { connection, segments: [{ kind: 'script', label: tabLabel(active) }] };
  }
  return {
    connection,
    segments: [
      { kind: 'database', label: active.dbName },
      { kind: 'collection', label: tabLabel(active) },
    ],
  };
}
