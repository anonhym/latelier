import { describe, it, expect } from 'vitest';
import {
  ENDED_SHOWN,
  agentRows,
  endedSessionLine,
  endedSlice,
  isExpanded,
  liveSessionLine,
} from '../../src/features/agents/sidebarModel';
import type { AgentSessionInfo, AgentSessionRow, AgentTokenInfo } from '@shared/types';

const NOW = new Date(2026, 10, 27, 12, 0).getTime();
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const token = (id: string, name: string, lastUsedAt?: string): AgentTokenInfo => ({
  id,
  name,
  createdAt: minutesAgo(60 * 24 * 30),
  ...(lastUsedAt ? { lastUsedAt } : {}),
});

const live = (over: Partial<AgentSessionInfo>): AgentSessionInfo => ({
  id: 's',
  tokenId: 't1',
  tokenName: 'x',
  clientName: 'claude-code',
  clientVersion: '2.0.1',
  folder: null,
  startedAt: minutesAgo(10),
  callCount: 0,
  refusedCount: 0,
  lastCallAt: null,
  ...over,
});

const row = (over: Partial<AgentSessionRow>): AgentSessionRow => ({
  id: 'r',
  tokenId: 't1',
  tokenName: 'x',
  clientName: 'claude-code',
  clientVersion: null,
  folder: null,
  startedAt: minutesAgo(60),
  endedAt: minutesAgo(30),
  endReason: 'client-closed',
  callCount: 0,
  refusedCount: 0,
  lastCallAt: null,
  ...over,
});

describe('agentRows', () => {
  it('sorts Agents by name and lists each one live sessions, newest first', () => {
    const rows = agentRows(
      [token('t3', 'desktop', minutesAgo(60 * 24 * 2)), token('t1', 'laptop-claude'), token('t2', 'cursor-work'), token('t4', 'Zeta')],
      [
        live({ id: 'a', tokenId: 't1', startedAt: minutesAgo(34) }),
        live({ id: 'b', tokenId: 't1', startedAt: minutesAgo(5) }),
        live({ id: 'c', tokenId: 't2' }),
      ],
      NOW,
    );
    expect(rows.map((r) => [r.name, r.meta])).toEqual([
      ['cursor-work', '1 live'],
      ['desktop', 'last seen 2d ago'],
      ['laptop-claude', '2 live'],
      ['Zeta', 'never connected'],
    ]);
    expect(rows[2]!.live.map((s) => s.id)).toEqual(['b', 'a']);
    expect(rows[2]!.id).toBe('t1');
  });
});

describe('liveSessionLine', () => {
  it("shows the folder's last segment and the time since it connected", () => {
    expect(liveSessionLine(live({ folder: '~/Projects/shop-api', startedAt: minutesAgo(34) }), NOW)).toBe('shop-api · 34 min');
  });

  it("falls back to the client's version, then to the time alone", () => {
    expect(liveSessionLine(live({ folder: null, clientVersion: '2.0.1', startedAt: minutesAgo(5) }), NOW)).toBe('2.0.1 · 5 min');
    expect(liveSessionLine(live({ folder: null, clientVersion: null, startedAt: minutesAgo(5) }), NOW)).toBe('5 min');
  });
});

describe('endedSessionLine', () => {
  it('reads the day and the span', () => {
    const at = (h: number, m: number, d = 27) => new Date(2026, 10, d, h, m).toISOString();
    expect(endedSessionLine({ startedAt: at(9, 12), endedAt: at(9, 40) }, NOW)).toBe('ended · today 09:12–09:40');
    expect(endedSessionLine({ startedAt: at(18, 0, 26), endedAt: at(18, 5, 26) }, NOW)).toBe('ended · yesterday 18:00–18:05');
    expect(endedSessionLine({ startedAt: at(9, 12), endedAt: null }, NOW)).toBe('ended · today 09:12');
  });
});

describe('endedSlice', () => {
  it('keeps ended rows only, at most five, and says when there are more', () => {
    const ended = Array.from({ length: ENDED_SHOWN }, (_, i) => row({ id: `e${i}` }));
    const withLive = [row({ id: 'live', endedAt: null }), ...ended];
    expect(endedSlice(withLive)).toEqual({ shown: ended, more: false });
    const six = [...ended, row({ id: 'e5' })];
    const slice = endedSlice(six);
    expect(slice.shown.map((r) => r.id)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4']);
    expect(slice.more).toBe(true);
    expect(endedSlice([])).toEqual({ shown: [], more: false });
  });
});

describe('isExpanded', () => {
  it("follows the user's choice, else expands while there is a live session", () => {
    const withLive = { id: 't1', live: [live({})] };
    const none = { id: 't2', live: [] };
    expect(isExpanded(withLive, new Map())).toBe(true);
    expect(isExpanded(none, new Map())).toBe(false);
    expect(isExpanded(withLive, new Map([['t1', false]]))).toBe(false);
    expect(isExpanded(none, new Map([['t2', true]]))).toBe(true);
  });
});
