import React from 'react';
import { api } from '../../api/atelier';
import { logFailure } from '../../utils/rendererLog';
import type { AgentCallSummary } from '@shared/types';
import { USED_NOW_WINDOW_MS, foldActivity, type ConnectionActivity } from './homeModel';

const PAGE = 50;

/**
 * One Connection's recent Agent Read Log: the newest row (its last call) and
 * every row inside the "used now" window. Reads page after page while the
 * rows are still inside the window; only an empty page, or a row past it,
 * ends the read. A short page is not the end.
 */
export async function readRecentCalls(connectionId: string, now: number): Promise<AgentCallSummary[]> {
  const out: AgentCallSummary[] = [];
  const cutoff = now - USED_NOW_WINDOW_MS;
  let before: { ts: string; id: string } | undefined;
  for (;;) {
    const page = await api.agentAccess.listCalls({ connectionId, outcome: 'all', limit: PAGE, ...(before ? { before } : {}) });
    if (page.length === 0) return out;
    const last = page[page.length - 1]!;
    // A page that does not move past the last one would loop forever.
    if (before && last.id === before.id) return out;
    out.push(...page);
    if (new Date(last.ts).getTime() < cutoff) return out;
    before = { ts: last.ts, id: last.id };
  }
}

/**
 * Last Agent call and recent callers per Connection (X30 §5.1), derived in
 * the renderer from `list-calls` and kept current by `call-event`. Held above
 * the Agents tab for the run: each Connection's log is read once, the first
 * time `active` is true with it listed, and new calls are folded in as they
 * come, so Home never re-reads on mount.
 */
export function useConnectionActivity(connectionIds: readonly string[], active: boolean): ReadonlyMap<string, ConnectionActivity> {
  const [activity, setActivity] = React.useState<ReadonlyMap<string, ConnectionActivity>>(new Map());
  const read = React.useRef(new Set<string>());
  const idsKey = [...connectionIds].sort((a, b) => a.localeCompare(b)).join('\u0000');

  React.useEffect(() => {
    if (!active) return;
    const now = Date.now();
    for (const id of idsKey === '' ? [] : idsKey.split('\u0000')) {
      if (read.current.has(id)) continue;
      read.current.add(id);
      readRecentCalls(id, now).then(
        (rows) => setActivity((prev) => foldActivity(rows, prev)),
        (err: unknown) => {
          // Read again the next time the list or the tab changes.
          read.current.delete(id);
          logFailure('reading recent Agent calls', err);
        },
      );
    }
  }, [idsKey, active]);

  React.useEffect(() => {
    if (!active) return undefined;
    try {
      return api.agentAccess.onCall((row) => setActivity((prev) => foldActivity([row], prev)));
    } catch (err) {
      logFailure('subscribing to Agent calls', err);
      return undefined;
    }
  }, [active]);

  return activity;
}
