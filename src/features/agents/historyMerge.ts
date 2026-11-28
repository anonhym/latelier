import type { AgentCallRow } from '@shared/types';
import type { MergedRecentQuery } from '../../pages/Workspace/views/recentRuns';
import { queryPreview } from '../../pages/Workspace/views/recentRuns';
import { querySeed, shortId, type FindSeed } from './activityRow';

/**
 * A collection's History with the Agent calls on it (X30 §9): the user's own
 * runs and the Agent's finds and counts, merged by time. Agent rows are read
 * from the Agent Read Log; nothing is written to the user's history.
 */

export type HistoryFilter = 'all' | 'mine' | 'agents';

export const HISTORY_FILTERS: ReadonlyArray<{ value: HistoryFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'agents', label: 'Agents' },
];

/** The Agent tools a Documents history lists. An aggregation waits for an Aggregation history. */
export const DOCUMENTS_HISTORY_TOOLS: readonly string[] = ['find', 'count'];

export interface AgentHistoryRow {
  kind: 'agent';
  key: string;
  at: string;
  call: AgentCallRow;
  /** What Load fills the Filter Bar with; null when the row offers Copy only. */
  seed: FindSeed | null;
  /** The row's one line: the filter it ran, else the request as stored. Untrusted text. */
  preview: string;
}

export interface MineHistoryRow {
  kind: 'mine';
  key: string;
  at: string;
  item: MergedRecentQuery;
}

export type HistoryRow = MineHistoryRow | AgentHistoryRow;

/** One Agent call as a History row, or null for a tool a Documents history does not list. */
export function agentHistoryRow(call: AgentCallRow): AgentHistoryRow | null {
  if (!DOCUMENTS_HISTORY_TOOLS.includes(call.tool)) return null;
  // A find or a count seeds a find, never a pipeline.
  const seed = querySeed(call) as FindSeed | null;
  return { kind: 'agent', key: `agent:${call.id}`, at: call.ts, call, seed, preview: seed?.queryRaw ?? call.request ?? '' };
}

function time(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * The rows the filter keeps, newest first. Agent calls are deduplicated by
 * id, so a page read twice never shows a call twice.
 */
export function mergeHistory(mine: readonly MergedRecentQuery[], calls: readonly AgentCallRow[], filter: HistoryFilter): HistoryRow[] {
  const rows: HistoryRow[] = [];
  if (filter !== 'agents') for (const item of mine) rows.push({ kind: 'mine', key: `mine:${item.id}`, at: item.ranAt, item });
  if (filter !== 'mine') {
    const ids = new Set<string>();
    for (const call of calls) {
      if (ids.has(call.id)) continue;
      ids.add(call.id);
      const row = agentHistoryRow(call);
      if (row) rows.push(row);
    }
  }
  // The sort is stable: rows at the same instant keep their own order.
  return rows.sort((a, b) => time(b.at) - time(a.at));
}

/** The text a History search looks in. */
export function historyRowText(row: HistoryRow): string {
  return row.kind === 'mine' ? (queryPreview(row.item.payload) ?? '') : row.preview;
}

/** Rows whose text holds the search, ignoring case; every row for a blank search. */
export function searchHistory(rows: readonly HistoryRow[], search: string): HistoryRow[] {
  // A blank search is in every text.
  const needle = search.trim().toLowerCase();
  return rows.filter((row) => historyRowText(row).toLowerCase().includes(needle));
}

/** The chip on an Agent row: "Agent · claude-code". */
export function agentChip(call: Pick<AgentCallRow, 'clientName'>): string {
  return `Agent · ${call.clientName ?? 'unknown client'}`;
}

/** The chip's tooltip: the Agent and its session. */
export function agentChipTooltip(call: Pick<AgentCallRow, 'tokenName' | 'sessionId'>): string {
  const agent = call.tokenName ?? 'An Agent';
  return call.sessionId ? `${agent} · session ${shortId(call.sessionId)}` : agent;
}

/** What Enter or a click does on a row: run a run of the user's, load an Agent's, or nothing for Copy only. */
export function rowAction(row: HistoryRow): 'run' | 'load' | 'none' {
  if (row.kind === 'mine') return 'run';
  // A seed exists only for an `ok`, uncut find or count: a refused or cut row has none.
  return row.seed ? 'load' : 'none';
}
