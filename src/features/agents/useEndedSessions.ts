import React from 'react';
import { api } from '../../api/atelier';
import { logFailure } from '../../utils/rendererLog';
import type { AgentSessionRow } from '@shared/types';
import { ENDED_SHOWN } from './sidebarModel';

const PAGE = 20;

/**
 * Reads an Agent's stored sessions until it has one more ended session than
 * the sidebar shows (which says whether Show all is needed), or the log runs
 * out. A short page is not the end: only an empty page is.
 */
export async function readEndedSessions(tokenId: string): Promise<AgentSessionRow[]> {
  const ended: AgentSessionRow[] = [];
  let before: { startedAt: string; id: string } | undefined;
  for (;;) {
    const page = await api.agentAccess.listSessions({ tokenId, includeEnded: true, limit: PAGE, ...(before ? { before } : {}) });
    if (page.length === 0) return ended;
    const last = page[page.length - 1]!;
    // A page that does not move past the last one would loop forever.
    if (before && last.id === before.id) return ended;
    for (const row of page) if (row.endedAt !== null) ended.push(row);
    if (ended.length > ENDED_SHOWN) return ended;
    before = { startedAt: last.startedAt, id: last.id };
  }
}

/**
 * The ended sessions of each expanded Agent, re-read whenever `refreshKey`
 * changes (a session starting or ending changes it).
 */
export function useEndedSessions(tokenIds: readonly string[], refreshKey: string): ReadonlyMap<string, AgentSessionRow[]> {
  const [byToken, setByToken] = React.useState<ReadonlyMap<string, AgentSessionRow[]>>(new Map());
  const idsKey = [...tokenIds].sort((a, b) => a.localeCompare(b)).join('\u0000');
  React.useEffect(() => {
    let live = true;
    const ids = idsKey === '' ? [] : idsKey.split('\u0000');
    for (const id of ids) {
      readEndedSessions(id).then(
        (rows) => {
          if (!live) return;
          setByToken((prev) => new Map(prev).set(id, rows));
        },
        (err: unknown) => logFailure('listing ended Agent sessions', err),
      );
    }
    return () => {
      live = false;
    };
  }, [idsKey, refreshKey]);
  return byToken;
}
