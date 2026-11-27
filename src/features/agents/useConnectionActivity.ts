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
 * the renderer from `list-calls` and kept current by `call-event`.
 */
export function useConnectionActivity(connectionIds: readonly string[]): ReadonlyMap<string, ConnectionActivity> {
  const [activity, setActivity] = React.useState<ReadonlyMap<string, ConnectionActivity>>(new Map());
  const idsKey = [...connectionIds].sort((a, b) => a.localeCompare(b)).join('\u0000');

  React.useEffect(() => {
    let live = true;
    const ids = idsKey === '' ? [] : idsKey.split('\u0000');
    const now = Date.now();
    for (const id of ids) {
      readRecentCalls(id, now).then(
        (rows) => {
          if (live) setActivity((prev) => foldActivity(rows, prev));
        },
        (err: unknown) => logFailure('reading recent Agent calls', err),
      );
    }
    return () => {
      live = false;
    };
  }, [idsKey]);

  React.useEffect(() => {
    try {
      return api.agentAccess.onCall((row) => setActivity((prev) => foldActivity([row], prev)));
    } catch (err) {
      logFailure('subscribing to Agent calls', err);
      return undefined;
    }
  }, []);

  return activity;
}
