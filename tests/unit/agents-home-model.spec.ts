import { describe, it, expect } from 'vitest';
import {
  USED_NOW_WINDOW_MS,
  connectionRows,
  foldActivity,
  homeStatusLine,
  isRefusedOutcome,
  lastCallText,
  privilegePill,
  setupSteps,
  showSetup,
  usedNowText,
} from '../../src/features/agents/homeModel';
import { needsYouBySession, needsYouCount, needsYouItems, needsYouLabel, requestMeta } from '../../src/features/agents/needsYou';
import { ago, clock, dayWord, elapsedShort } from '../../src/features/agents/agentsTime';
import { backer, proposal } from '../helpers/agentProposalFixture';
import type { AgentConnectionRequest, AgentSessionInfo } from '@shared/types';

const NOW = Date.parse('2026-11-27T12:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const session = (over: Partial<AgentSessionInfo>): AgentSessionInfo => ({
  id: 's1',
  tokenId: 't1',
  tokenName: 'laptop-claude',
  clientName: 'claude-code',
  clientVersion: '2.0.1',
  folder: '~/Projects/shop-api',
  startedAt: minutesAgo(30),
  callCount: 0,
  refusedCount: 0,
  lastCallAt: null,
  ...over,
});

const request = (over: Partial<AgentConnectionRequest> = {}): AgentConnectionRequest => ({
  sessionId: 's1',
  tokenName: 'laptop-claude',
  clientName: 'claude-code',
  folder: '~/Projects/shop-api',
  connectionId: 'c-shop',
  connectionName: 'Shop (prod)',
  firstAt: minutesAgo(3),
  lastAt: minutesAgo(2),
  count: 1,
  lastTool: 'find',
  database: 'shop',
  collection: 'orders',
  lastOutcome: 'refused',
  ...over,
});

describe('agentsTime', () => {
  it('ago steps from just now through minutes, hours, days and weeks to a date', () => {
    expect(ago(minutesAgo(0.5), NOW)).toBe('just now');
    expect(ago(minutesAgo(1), NOW)).toBe('1m ago');
    expect(ago(minutesAgo(59), NOW)).toBe('59m ago');
    expect(ago(minutesAgo(60), NOW)).toBe('1h ago');
    expect(ago(minutesAgo(60 * 23), NOW)).toBe('23h ago');
    expect(ago(minutesAgo(60 * 24), NOW)).toBe('1d ago');
    expect(ago(minutesAgo(60 * 24 * 6), NOW)).toBe('6d ago');
    expect(ago(minutesAgo(60 * 24 * 7), NOW)).toBe('1w ago');
    expect(ago(minutesAgo(60 * 24 * 34), NOW)).toBe('4w ago');
    expect(ago(minutesAgo(60 * 24 * 35), NOW)).toBe('2026-10-23');
    expect(ago(new Date(NOW + 60_000).toISOString(), NOW)).toBe('just now');
  });

  it('ago and the others give the fallback or nothing for a missing or bad time', () => {
    expect(ago(null, NOW, '—')).toBe('—');
    expect(ago('nope', NOW, '—')).toBe('—');
    expect(ago(undefined, NOW)).toBe('');
    expect(elapsedShort(null, NOW)).toBe('');
    expect(clock('nope')).toBe('');
    expect(dayWord(undefined, NOW)).toBe('');
  });

  it('elapsedShort reads minutes, hours and days', () => {
    expect(elapsedShort(minutesAgo(0.9), NOW)).toBe('just now');
    expect(elapsedShort(minutesAgo(1), NOW)).toBe('1 min');
    expect(elapsedShort(minutesAgo(34), NOW)).toBe('34 min');
    expect(elapsedShort(minutesAgo(60), NOW)).toBe('1 h');
    expect(elapsedShort(minutesAgo(60 * 24 - 1), NOW)).toBe('23 h');
    expect(elapsedShort(minutesAgo(60 * 24), NOW)).toBe('1 d');
  });

  it('clock and dayWord read local calendar time', () => {
    const local = (d: number, h: number, m: number) => new Date(2026, 10, d, h, m).toISOString();
    const now = new Date(2026, 10, 27, 15, 0).getTime();
    expect(clock(local(27, 9, 5))).toBe('09:05');
    expect(clock(local(27, 23, 40))).toBe('23:40');
    expect(dayWord(local(27, 0, 1), now)).toBe('today');
    expect(dayWord(local(26, 23, 59), now)).toBe('yesterday');
    expect(dayWord(local(25, 12, 0), now)).toBe('Nov 25');
    expect(dayWord(new Date(2026, 0, 3, 12).toISOString(), now)).toBe('Jan 3');
  });
});

describe('homeStatusLine', () => {
  const base = { enabled: true, bridgeInstalled: true, sessions: [] as AgentSessionInfo[] };

  it('reads off, then bridge, then the live count', () => {
    expect(homeStatusLine({ ...base, enabled: false })).toBe('Agent Access is off');
    expect(homeStatusLine({ ...base, enabled: false, bridgeInstalled: false })).toBe('Agent Access is off');
    expect(homeStatusLine({ ...base, bridgeInstalled: false })).toBe('Bridge not installed');
    expect(homeStatusLine(base)).toBe('Agent Access is on · no live sessions');
  });

  it('counts sessions and distinct Agents', () => {
    expect(homeStatusLine({ ...base, sessions: [session({})] })).toBe('Agent Access is on · 1 live session from 1 Agent');
    expect(
      homeStatusLine({
        ...base,
        sessions: [session({ id: 'a' }), session({ id: 'b' }), session({ id: 'c', tokenId: 't2' })],
      }),
    ).toBe('Agent Access is on · 3 live sessions from 2 Agents');
  });
});

describe('setupSteps', () => {
  it('ticks each step from its own input, and shows while any is open', () => {
    const steps = setupSteps({ enabled: true, anyShared: false, anySessionEver: true });
    expect(steps.map((s) => [s.id, s.label, s.done])).toEqual([
      ['enable', 'Turn on Agent Access', true],
      ['share', 'Share a Connection', false],
      ['connect', 'Connect an Agent', true],
    ]);
    expect(showSetup(steps)).toBe(true);
    expect(showSetup(setupSteps({ enabled: true, anyShared: true, anySessionEver: true }))).toBe(false);
    expect(showSetup(setupSteps({ enabled: false, anyShared: true, anySessionEver: true }))).toBe(true);
  });
});

describe('isRefusedOutcome', () => {
  it('counts every outcome but ok and INPUT_REQUIRED as refused', () => {
    expect(isRefusedOutcome('ok')).toBe(false);
    expect(isRefusedOutcome('INPUT_REQUIRED')).toBe(false);
    expect(isRefusedOutcome('NOT_OPEN')).toBe(true);
    expect(isRefusedOutcome('BUSY')).toBe(true);
  });
});

describe('foldActivity', () => {
  it('keeps the newest call per Connection and per session, in any row order', () => {
    const a = foldActivity([
      { connectionId: 'c1', sessionId: 's1', ts: minutesAgo(10), outcome: 'ok' },
      { connectionId: 'c1', sessionId: 's1', ts: minutesAgo(1), outcome: 'NOT_OPEN' },
      { connectionId: 'c1', sessionId: 's2', ts: minutesAgo(4), outcome: 'ok' },
      { connectionId: 'c1', sessionId: 's1', ts: minutesAgo(8), outcome: 'ok' },
      { connectionId: null, sessionId: 's9', ts: minutesAgo(0), outcome: 'ok' },
      { connectionId: 'c2', sessionId: null, ts: minutesAgo(3), outcome: 'ok' },
    ]);
    expect([...a.keys()]).toEqual(['c1', 'c2']);
    const c1 = a.get('c1')!;
    expect(c1.lastAt).toBe(minutesAgo(1));
    expect(c1.lastOutcome).toBe('NOT_OPEN');
    expect(c1.recent.get('s1')).toBe(minutesAgo(1));
    expect(c1.recent.get('s2')).toBe(minutesAgo(4));
    expect(a.get('c2')!.recent.size).toBe(0);
  });

  it('keeps the first of two calls at the same instant', () => {
    const a = foldActivity([
      { connectionId: 'c1', sessionId: 's1', ts: minutesAgo(2), outcome: 'ok' },
      { connectionId: 'c1', sessionId: 's1', ts: minutesAgo(2), outcome: 'BUSY' },
    ]);
    expect(a.get('c1')!.lastOutcome).toBe('ok');
    const later = foldActivity([{ connectionId: 'c1', sessionId: 's1', ts: minutesAgo(2), outcome: 'BUSY' }], a);
    expect(later.get('c1')!.lastOutcome).toBe('ok');
  });

  it('folds into an earlier map without changing it, and an older row never wins', () => {
    const first = foldActivity([{ connectionId: 'c1', sessionId: 's1', ts: minutesAgo(2), outcome: 'ok' }]);
    const next = foldActivity([{ connectionId: 'c1', sessionId: 's1', ts: minutesAgo(9), outcome: 'BUSY' }], first);
    expect(next.get('c1')!.lastAt).toBe(minutesAgo(2));
    expect(next.get('c1')!.lastOutcome).toBe('ok');
    expect(next.get('c1')!.recent.get('s1')).toBe(minutesAgo(2));
    const newer = foldActivity([{ connectionId: 'c1', sessionId: 's3', ts: minutesAgo(0), outcome: 'BUSY' }], first);
    expect(newer.get('c1')!.lastOutcome).toBe('BUSY');
    expect(first.get('c1')!.recent.has('s3')).toBe(false);
    expect(first.get('c1')!.lastOutcome).toBe('ok');
  });
});

describe('usedNowText and lastCallText', () => {
  const live = [
    { id: 's1', tokenName: 'laptop-claude' },
    { id: 's2', tokenName: 'cursor-work' },
    { id: 's3', tokenName: 'laptop-claude' },
  ];

  it('lists the live sessions that called within five minutes, names sorted and distinct', () => {
    const activity = foldActivity([
      { connectionId: 'c', sessionId: 's1', ts: minutesAgo(1), outcome: 'ok' },
      { connectionId: 'c', sessionId: 's2', ts: new Date(NOW - USED_NOW_WINDOW_MS).toISOString(), outcome: 'ok' },
      { connectionId: 'c', sessionId: 's3', ts: new Date(NOW - USED_NOW_WINDOW_MS - 1).toISOString(), outcome: 'ok' },
      { connectionId: 'c', sessionId: 'ended', ts: minutesAgo(0), outcome: 'ok' },
    ]).get('c');
    expect(usedNowText(activity, live, NOW)).toBe('2 sessions · cursor-work, laptop-claude');
    expect(usedNowText(activity, live.slice(0, 1), NOW)).toBe('1 session · laptop-claude');
    expect(usedNowText(activity, [], NOW)).toBe('—');
    expect(usedNowText(undefined, live, NOW)).toBe('—');
  });

  it('reads the last call, refused or not, or never', () => {
    expect(lastCallText(undefined, NOW)).toBe('never');
    const ok = foldActivity([{ connectionId: 'c', sessionId: null, ts: minutesAgo(2), outcome: 'ok' }]).get('c');
    expect(lastCallText(ok, NOW)).toBe('2m ago');
    const paused = foldActivity([{ connectionId: 'c', sessionId: null, ts: minutesAgo(2), outcome: 'INPUT_REQUIRED' }]).get('c');
    expect(lastCallText(paused, NOW)).toBe('2m ago');
    const refused = foldActivity([{ connectionId: 'c', sessionId: null, ts: minutesAgo(2), outcome: 'NOT_OPEN' }]).get('c');
    expect(lastCallText(refused, NOW)).toBe('refused · 2m ago');
  });
});

describe('connectionRows', () => {
  const connections = [
    { id: 'c-arch', name: 'Archive 2023', status: 'disconnected' as const, shareWithAgents: false },
    { id: 'c-rep', name: 'Reports replica', status: 'connected' as const, shareWithAgents: false },
    { id: 'c-shop', name: 'Shop (prod)', status: 'disconnected' as const, shareWithAgents: true },
    { id: 'c-local', name: 'Local dev', status: 'connected' as const, shareWithAgents: true },
    { id: 'c-ana', name: 'analytics', status: 'connecting' as const },
  ];

  it('lists shared first, then by name, with each status', () => {
    const rows = connectionRows({
      connections,
      state: { privilege: {}, sessions: [], connectionRequests: [] },
      activity: new Map(),
      now: NOW,
    });
    expect(rows.map((r) => [r.name, r.shared, r.open, r.status, r.tone, r.showOpen])).toEqual([
      ['Local dev', true, true, 'Open · reachable', 'ok', false],
      ['Shop (prod)', true, false, 'Not open', 'warn', true],
      ['analytics', false, false, 'Closed · not shared', 'neutral', false],
      ['Archive 2023', false, false, 'Closed · not shared', 'neutral', false],
      ['Reports replica', false, true, 'Open · not shared', 'neutral', false],
    ]);
    expect(rows.every((r) => r.askedBy.length === 0 && r.usedNowBy === '—' && r.lastCall === 'never')).toBe(true);
  });

  it('names the Agents that asked for a Connection, and carries privilege and activity', () => {
    const rows = connectionRows({
      connections,
      state: {
        privilege: { 'c-local': { kind: 'read-only', roles: [] } },
        sessions: [session({ id: 's1' })],
        connectionRequests: [request(), request({ sessionId: 's2', tokenName: null }), request({ sessionId: 's3' })],
      },
      activity: foldActivity([{ connectionId: 'c-local', sessionId: 's1', ts: minutesAgo(1), outcome: 'ok' }]),
      now: NOW,
    });
    const shop = rows.find((r) => r.id === 'c-shop')!;
    expect(shop.askedBy).toEqual(['laptop-claude', 'an Agent']);
    const local = rows.find((r) => r.id === 'c-local')!;
    expect(local.privilege).toEqual({ kind: 'read-only', roles: [] });
    expect(local.usedNowBy).toBe('1 session · laptop-claude');
    expect(local.lastCall).toBe('1m ago');
    expect(local.askedBy).toEqual([]);
  });
});

describe('privilegePill', () => {
  it('reads each privilege result as a pill', () => {
    expect(privilegePill(undefined)).toBeNull();
    expect(privilegePill({ kind: 'read-only', roles: [] })).toEqual({ label: 'read-only', tone: 'ok' });
    expect(privilegePill({ kind: 'beyond-read', roles: ['readWrite'] })).toEqual({ label: 'can write', tone: 'warn' });
    expect(privilegePill({ kind: 'no-auth', roles: [] })).toEqual({ label: 'cannot verify', tone: 'warn' });
    expect(privilegePill({ kind: 'failed', roles: [] })).toEqual({ label: 'cannot verify', tone: 'warn' });
  });
});

describe('needsYou', () => {
  it('counts open Connection requests for the badge, with its accessible text', () => {
    expect(needsYouCount(null, [])).toBe(0);
    expect(needsYouCount({ connectionRequests: [request(), request({ sessionId: 's2' })] }, [])).toBe(2);
    expect(needsYouLabel(1)).toBe('1 Agent request');
    expect(needsYouLabel(3)).toBe('3 Agent requests');
  });

  it('builds the meta line from what was reported', () => {
    expect(requestMeta(request(), NOW)).toBe('claude-code · ~/Projects/shop-api · 2m ago · find on shop.orders');
    expect(requestMeta(request({ clientName: null, folder: null, collection: null }), NOW)).toBe('2m ago · find on shop');
    expect(requestMeta(request({ database: null, collection: null }), NOW)).toBe(
      'claude-code · ~/Projects/shop-api · 2m ago · find',
    );
    expect(requestMeta(request({ database: null }), NOW)).toBe('claude-code · ~/Projects/shop-api · 2m ago · find on orders');
  });

  it('lists every request newest first, naming an unnamed Agent', () => {
    const items = needsYouItems(
      {
        connectionRequests: [
          request({ sessionId: 'old', lastAt: minutesAgo(9) }),
          request({ sessionId: 'new', lastAt: minutesAgo(1), tokenName: null, lastOutcome: 'waiting' }),
        ],
      },
      NOW,
      [],
      [],
    );
    expect(items.map((i) => [i.sessionId, i.agent, i.kind === 'connection-request' ? i.outcome : null])).toEqual([
      ['new', 'An Agent', 'waiting'],
      ['old', 'laptop-claude', 'refused'],
    ]);
    expect(items[0]).toMatchObject({
      kind: 'connection-request',
      key: 'new\u0000c-shop',
      connectionId: 'c-shop',
      connectionName: 'Shop (prod)',
      client: 'claude-code',
      at: minutesAgo(1),
      meta: 'claude-code · ~/Projects/shop-api · 1m ago · find on shop.orders',
    });
    expect(needsYouItems(null, NOW, [], [])).toEqual([]);
  });

  it('counts requests per session', () => {
    const by = needsYouBySession(
      { connectionRequests: [request(), request({ connectionId: 'c2' }), request({ sessionId: 's2' })] },
      [],
    );
    expect(by.get('s1')).toBe(2);
    expect(by.get('s2')).toBe(1);
    expect(needsYouBySession(null, []).size).toBe(0);
  });

  it('counts the pending Proposals each session backs, beside its requests', () => {
    const by = needsYouBySession({ connectionRequests: [request()] }, [
      proposal({ id: 'p1', backers: [backer({ sessionId: 's1' }), backer({ tokenId: 't2', sessionId: 's2' }), backer({ tokenId: 't3', sessionId: null })] }),
      proposal({ id: 'p2', status: 'later', backers: [backer({ sessionId: 's1' })] }),
    ]);
    expect([...by.entries()]).toEqual([
      ['s1', 2],
      ['s2', 1],
    ]);
  });
});
