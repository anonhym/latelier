import type { AgentSessionInfo, AgentSessionRow, AgentTokenInfo } from '@shared/types';
import { folderLastSegment } from './agentsPage';
import { ago, clock, dayWord, elapsedShort } from './agentsTime';

/** The ended sessions an Agent row lists before **Show all** (X30 §3). */
export const ENDED_SHOWN = 5;

export interface AgentRow {
  id: string;
  name: string;
  /** Its live sessions, newest first. */
  live: AgentSessionInfo[];
  /** "2 live", "last seen 2d ago" or "never connected". */
  meta: string;
}

/** One row per Agent Token, by name, with its live sessions (X30 §3). */
export function agentRows(
  tokens: ReadonlyArray<AgentTokenInfo>,
  sessions: ReadonlyArray<AgentSessionInfo>,
  now: number,
): AgentRow[] {
  return [...tokens]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => {
      const live = sessions
        .filter((s) => s.tokenId === t.id)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      const meta =
        live.length > 0
          ? `${live.length} live`
          : t.lastUsedAt
            ? `last seen ${ago(t.lastUsedAt, now)}`
            : 'never connected';
      return { id: t.id, name: t.name, live, meta };
    });
}

/** A live session's second line: "shop-api · 34 min", or the client's version when no folder was reported. */
export function liveSessionLine(session: Pick<AgentSessionInfo, 'folder' | 'clientVersion' | 'startedAt'>, now: number): string {
  const where = folderLastSegment(session.folder) ?? session.clientVersion;
  const since = elapsedShort(session.startedAt, now);
  return where ? `${where} · ${since}` : since;
}

/** "ended · today 09:12–09:40". */
export function endedSessionLine(session: Pick<AgentSessionRow, 'startedAt' | 'endedAt'>, now: number): string {
  const end = session.endedAt ? `–${clock(session.endedAt)}` : '';
  return `ended · ${dayWord(session.startedAt, now)} ${clock(session.startedAt)}${end}`;
}

/** The ended rows to draw under an Agent and whether **Show all** is needed. */
export function endedSlice(rows: ReadonlyArray<AgentSessionRow>): { shown: AgentSessionRow[]; more: boolean } {
  const ended = rows.filter((r) => r.endedAt !== null);
  return { shown: ended.slice(0, ENDED_SHOWN), more: ended.length > ENDED_SHOWN };
}

/**
 * Whether an Agent row is expanded: the user's own choice this run, else
 * expanded while it has a live session (X30 §3).
 */
export function isExpanded(row: Pick<AgentRow, 'id' | 'live'>, choices: ReadonlyMap<string, boolean>): boolean {
  return choices.get(row.id) ?? row.live.length > 0;
}
