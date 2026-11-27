// X30 §9: a collection's History with its Agent finds and counts, merged by
// time, filtered All · Mine · Agents.
import { describe, expect, it } from 'vitest';
import type { RecentQuery } from '@shared/types';
import {
  DOCUMENTS_HISTORY_TOOLS,
  HISTORY_FILTERS,
  agentChip,
  agentChipTooltip,
  agentHistoryRow,
  historyRowText,
  mergeHistory,
  rowAction,
  searchHistory,
} from '../../src/features/agents/historyMerge';
import type { MergedRecentQuery } from '../../src/pages/Workspace/views/recentRuns';
import { callRow } from '../helpers/agentProposalFixture';

const mine = (id: string, ranAt: string, queryRaw = '{"mine":1}'): MergedRecentQuery => ({
  id,
  ids: [id],
  connectionId: 'c-shop',
  dbName: 'shop',
  collection: 'orders',
  kind: 'find',
  payload: { kind: 'find', queryRaw, builder: { projection: [], sort: '', limit: '' } },
  ranAt,
  durationMs: 4,
}) as RecentQuery & { ids: string[] };

const T = (h: number) => `2026-11-27T${String(h).padStart(2, '0')}:00:00.000Z`;

describe('mergeHistory', () => {
  const rows = [mine('m-old', T(8)), mine('m-new', T(11))];
  const calls = [callRow({ id: 'a-mid', ts: T(10) }), callRow({ id: 'a-oldest', ts: T(7), tool: 'count' })];

  it('merges both by time, newest first', () => {
    expect(mergeHistory(rows, calls, 'all').map((r) => r.key)).toEqual(['mine:m-new', 'agent:a-mid', 'mine:m-old', 'agent:a-oldest']);
  });

  it('keeps only the user’s rows for Mine and only the Agent’s for Agents', () => {
    expect(mergeHistory(rows, calls, 'mine').map((r) => r.kind)).toEqual(['mine', 'mine']);
    expect(mergeHistory(rows, calls, 'agents').map((r) => r.kind)).toEqual(['agent', 'agent']);
  });

  it('lists only finds and counts, each Agent call once', () => {
    expect(DOCUMENTS_HISTORY_TOOLS).toEqual(['find', 'count']);
    const merged = mergeHistory(
      [],
      [callRow({ id: 'x' }), callRow({ id: 'x' }), callRow({ id: 'agg', tool: 'aggregate' }), callRow({ id: 'e', tool: 'explain_find' })],
      'agents',
    );
    expect(merged.map((r) => r.key)).toEqual(['agent:x']);
  });

  it('keeps rows at the same instant in their own order, and sorts a bad time last', () => {
    const merged = mergeHistory([mine('m', T(9)), mine('bad', 'not a time')], [callRow({ id: 'a', ts: T(9) })], 'all');
    expect(merged.map((r) => r.key)).toEqual(['mine:m', 'agent:a', 'mine:bad']);
  });

  it('offers the three filters, All first', () => {
    expect(HISTORY_FILTERS.map((f) => f.label)).toEqual(['All', 'Mine', 'Agents']);
    expect(HISTORY_FILTERS.map((f) => f.value)).toEqual(['all', 'mine', 'agents']);
  });
});

describe('Agent rows', () => {
  it('previews the filter a find ran, and loads it', () => {
    const row = agentHistoryRow(callRow())!;
    expect(row).toMatchObject({ kind: 'agent', key: 'agent:k1', at: callRow().ts, preview: '{"status":"shipped"}' });
    expect(row.seed?.queryRaw).toBe('{"status":"shipped"}');
    expect(rowAction(row)).toBe('load');
  });

  it('offers Copy only on a refused or cut row, previewing the request as stored', () => {
    const refused = agentHistoryRow(callRow({ outcome: 'JS_NOT_ALLOWED', request: '{"filter":{"$where":"1"}}' }))!;
    expect(refused.seed).toBeNull();
    expect(refused.preview).toBe('{"filter":{"$where":"1"}}');
    expect(rowAction(refused)).toBe('none');
    const cut = agentHistoryRow(callRow({ requestTruncated: true, request: '{"truncated":true}' }))!;
    expect(rowAction(cut)).toBe('none');
    expect(agentHistoryRow(callRow({ outcome: 'NOT_OPEN', request: null }))!.preview).toBe('');
  });

  it('makes no row of a tool the Documents history does not list', () => {
    expect(agentHistoryRow(callRow({ tool: 'aggregate' }))).toBeNull();
  });

  it('runs the user’s own rows', () => {
    expect(rowAction({ kind: 'mine', key: 'mine:m', at: T(1), item: mine('m', T(1)) })).toBe('run');
  });

  it('chips the client, and names the Agent and session in the tooltip', () => {
    expect(agentChip(callRow())).toBe('Agent · claude-code');
    expect(agentChip(callRow({ clientName: null }))).toBe('Agent · unknown client');
    expect(agentChipTooltip(callRow({ sessionId: '0123456789abcdef' }))).toBe('laptop-claude · session 01234567');
    expect(agentChipTooltip(callRow({ tokenName: null, sessionId: null }))).toBe('An Agent');
  });
});

describe('searchHistory', () => {
  const merged = mergeHistory([mine('m', T(9), '{"Mine":1}')], [callRow({ id: 'a', ts: T(10) })], 'all');

  it('finds rows by their text, ignoring case and surrounding space', () => {
    expect(searchHistory(merged, '  SHIPPED ').map((r) => r.key)).toEqual(['agent:a']);
    expect(searchHistory(merged, 'mine').map((r) => r.key)).toEqual(['mine:m']);
  });

  it('keeps every row for a blank search', () => {
    expect(searchHistory(merged, '   ')).toEqual(merged);
  });

  it('reads a user row with no stored query as empty', () => {
    const legacy = { ...mine('l', T(1)), payload: { kind: 'find', builder: { projection: [], sort: '', limit: '' } } } as unknown as MergedRecentQuery;
    expect(historyRowText({ kind: 'mine', key: 'mine:l', at: T(1), item: legacy })).toBe('');
  });
});
