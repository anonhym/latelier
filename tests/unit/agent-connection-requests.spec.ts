import { describe, it, expect, beforeEach } from 'vitest';
import { ConnectionRequests, REQUEST_QUIET_MS, type RequestSourceRow } from '../../electron/agent/connectionRequests';

const T0 = Date.parse('2026-11-27T10:00:00.000Z');

function row(over: Partial<RequestSourceRow> = {}): RequestSourceRow {
  return {
    sessionId: 's1',
    tokenName: 'Claude Code',
    clientName: 'claude-code',
    connectionId: 'c1',
    connectionName: 'prod',
    database: 'shop',
    collection: 'orders',
    tool: 'find',
    outcome: 'NOT_OPEN',
    ...over,
  };
}

describe('ConnectionRequests', () => {
  let now: number;
  let reqs: ConnectionRequests;

  beforeEach(() => {
    now = T0;
    reqs = new ConnectionRequests(() => now);
  });

  it('makes one request from a NOT_OPEN row, with every field the renderer shows', () => {
    expect(reqs.observe(row(), '~/Projects/shop')).toBe('added');
    expect(reqs.list()).toEqual([
      {
        sessionId: 's1',
        tokenName: 'Claude Code',
        clientName: 'claude-code',
        folder: '~/Projects/shop',
        connectionId: 'c1',
        connectionName: 'prod',
        firstAt: '2026-11-27T10:00:00.000Z',
        lastAt: '2026-11-27T10:00:00.000Z',
        count: 1,
        lastTool: 'find',
        database: 'shop',
        collection: 'orders',
        lastOutcome: 'refused',
      },
    ]);
    expect(reqs.size).toBe(1);
  });

  it('makes one from an INPUT_REQUIRED row, marked waiting', () => {
    expect(reqs.observe(row({ outcome: 'INPUT_REQUIRED' }), null)).toBe('added');
    expect(reqs.list()[0]).toMatchObject({ lastOutcome: 'waiting', count: 1, folder: null });
  });

  it.each(['ok', 'NOT_SHARED', 'ACCESS_OFF', 'BUSY', 'DB_ERROR', 'not_open'])('makes none from %s', (outcome) => {
    expect(reqs.observe(row({ outcome }), null)).toBe('ignored');
    expect(reqs.list()).toEqual([]);
  });

  it.each([
    ['no session', { sessionId: null }],
    ['no Connection id', { connectionId: null }],
    ['no Connection name', { connectionName: null }],
  ])('makes none for a row with %s', (_name, over) => {
    expect(reqs.observe(row(over), null)).toBe('ignored');
    expect(reqs.list()).toEqual([]);
  });

  it("makes one request of a paused call's two rows, which counts as one call", () => {
    reqs.observe(row({ outcome: 'INPUT_REQUIRED' }), null);
    now += 1000;
    expect(reqs.observe(row({ outcome: 'NOT_OPEN' }), null)).toBe('updated');
    expect(reqs.list()).toHaveLength(1);
    expect(reqs.list()[0]).toMatchObject({ count: 1, lastOutcome: 'refused', lastAt: '2026-11-27T10:00:01.000Z' });
  });

  it('bumps the count, time, target, tool and outcome on a repeat, and keeps the first time and folder', () => {
    reqs.observe(row(), '~/a');
    now += 5000;
    reqs.observe(row({ tool: 'count', database: 'crm', collection: 'leads', connectionName: 'prod (renamed)' }), '~/b');
    now += 5000;
    reqs.observe(row({ outcome: 'INPUT_REQUIRED', tool: 'aggregate' }), null);
    expect(reqs.list()).toEqual([
      expect.objectContaining({
        firstAt: '2026-11-27T10:00:00.000Z',
        lastAt: '2026-11-27T10:00:10.000Z',
        count: 3,
        lastTool: 'aggregate',
        database: 'shop',
        collection: 'orders',
        connectionName: 'prod',
        folder: '~/a',
        lastOutcome: 'waiting',
      }),
    ]);
    now += 1000;
    reqs.observe(row({ outcome: 'NOT_OPEN', tool: 'aggregate', connectionName: 'prod 2' }), null);
    expect(reqs.list()[0]).toMatchObject({ count: 3, lastOutcome: 'refused', connectionName: 'prod 2' });
    reqs.observe(row({ outcome: 'NOT_OPEN' }), null);
    expect(reqs.list()[0]).toMatchObject({ count: 4, lastOutcome: 'refused' });
  });

  it('keeps one request per session and per Connection, newest first', () => {
    reqs.observe(row(), null);
    now += 1;
    reqs.observe(row({ sessionId: 's2' }), null);
    now += 1;
    reqs.observe(row({ connectionId: 'c2', connectionName: 'stage' }), null);
    expect(reqs.list().map((r) => [r.sessionId, r.connectionId])).toEqual([
      ['s1', 'c2'],
      ['s2', 'c1'],
      ['s1', 'c1'],
    ]);
  });

  it('orders requests touched in the same millisecond by session, then Connection', () => {
    reqs.observe(row({ sessionId: 'b', connectionId: 'y' }), null);
    reqs.observe(row({ sessionId: 'a', connectionId: 'z' }), null);
    reqs.observe(row({ sessionId: 'b', connectionId: 'x' }), null);
    expect(reqs.list().map((r) => `${r.sessionId}/${r.connectionId}`)).toEqual(['a/z', 'b/x', 'b/y']);
  });

  it('hands out copies', () => {
    reqs.observe(row(), null);
    reqs.list()[0]!.count = 99;
    expect(reqs.list()[0]!.count).toBe(1);
  });

  it('ends a request when its Connection opens, is unshared or deleted', () => {
    reqs.observe(row(), null);
    reqs.observe(row({ sessionId: 's2' }), null);
    reqs.observe(row({ connectionId: 'c2' }), null);
    expect(reqs.endConnection('c1')).toBe(true);
    expect(reqs.list().map((r) => r.connectionId)).toEqual(['c2']);
    expect(reqs.endConnection('c1')).toBe(false);
  });

  it('ends a request when its session ends, and the session ending clears its dismissals', () => {
    reqs.observe(row(), null);
    reqs.observe(row({ sessionId: 's2' }), null);
    reqs.dismiss('s1', 'c2');
    expect(reqs.endSession('s1')).toBe(true);
    expect(reqs.list().map((r) => r.sessionId)).toEqual(['s2']);
    expect(reqs.endSession('s1')).toBe(false);
    // The id is reused only in a test, but the dismissal must not outlive its session.
    expect(reqs.observe(row({ connectionId: 'c2' }), null)).toBe('added');
  });

  it('ends a dismissed request, and the pair makes no new one for the rest of the session', () => {
    reqs.observe(row(), null);
    expect(reqs.dismiss('s1', 'c1')).toBe(true);
    expect(reqs.list()).toEqual([]);
    expect(reqs.observe(row(), null)).toBe('ignored');
    expect(reqs.observe(row({ outcome: 'INPUT_REQUIRED' }), null)).toBe('ignored');
    expect(reqs.list()).toEqual([]);
    expect(reqs.observe(row({ sessionId: 's2' }), null)).toBe('added');
    expect(reqs.observe(row({ connectionId: 'c2' }), null)).toBe('added');
  });

  it('holds a dismissal made before any request, and a second one on the same session', () => {
    expect(reqs.dismiss('s1', 'c1')).toBe(false);
    expect(reqs.dismiss('s1', 'c2')).toBe(false);
    expect(reqs.observe(row(), null)).toBe('ignored');
    expect(reqs.observe(row({ connectionId: 'c2' }), null)).toBe('ignored');
  });

  it('expires a request 30 minutes after its last refusal, and not a moment before', () => {
    expect(REQUEST_QUIET_MS).toBe(30 * 60 * 1000);
    reqs.observe(row(), null);
    reqs.observe(row({ sessionId: 's2' }), null);
    now += 10 * 60 * 1000;
    reqs.observe(row({ sessionId: 's2' }), null);
    now = T0 + REQUEST_QUIET_MS - 1;
    expect(reqs.expire()).toBe(false);
    expect(reqs.list()).toHaveLength(2);
    now = T0 + REQUEST_QUIET_MS;
    expect(reqs.expire()).toBe(true);
    expect(reqs.list().map((r) => r.sessionId)).toEqual(['s2']);
    expect(reqs.expire()).toBe(false);
  });

  it('uses the real clock by default', () => {
    const real = new ConnectionRequests();
    const before = Date.now();
    real.observe(row(), null);
    const at = Date.parse(real.list()[0]!.firstAt);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });
});
