// X30 §8: one Needs you list for Home, a session page and the toasts —
// Connection requests and pending Proposals merged, Later apart and uncounted.
import { describe, expect, it } from 'vitest';
import type { AgentConnectionRequest } from '@shared/types';
import { forSession, laterItems, needsYouCount, needsYouItems, proposalItem } from '../../src/features/agents/needsYou';
import { backer, proposal } from '../helpers/agentProposalFixture';

const NOW = Date.parse('2026-11-27T12:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

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

describe('needsYouCount', () => {
  it('counts Connection requests and pending Proposals, never Later or decided ones', () => {
    const proposals = [
      proposal({ id: 'a' }),
      proposal({ id: 'b' }),
      proposal({ id: 'l', status: 'later' }),
      proposal({ id: 'x', status: 'accepted' }),
    ];
    expect(needsYouCount({ connectionRequests: [request()] }, proposals)).toBe(3);
    expect(needsYouCount(null, proposals)).toBe(2);
    expect(needsYouCount(null, [...proposals, proposal({ id: 'd', status: 'declined' })])).toBe(2);
    expect(needsYouCount({ connectionRequests: [request()] }, [])).toBe(1);
    expect(needsYouCount(null, [])).toBe(0);
  });
});

describe('needsYouItems', () => {
  it('merges requests and pending Proposals newest first', () => {
    const items = needsYouItems(
      { connectionRequests: [request({ sessionId: 's-old', lastAt: minutesAgo(9) }), request({ sessionId: 's-new', lastAt: minutesAgo(1) })] },
      NOW,
      [proposal({ id: 'mid', createdAt: minutesAgo(5) }), proposal({ id: 'later', status: 'later', createdAt: minutesAgo(0) })],
      [],
    );
    expect(items.map((i) => i.key)).toEqual(['s-new\u0000c-shop', 'proposal:mid', 's-old\u0000c-shop']);
  });

  it('breaks a tie in time by key, so the order never flickers', () => {
    const at = minutesAgo(4);
    const items = needsYouItems(null, NOW, [proposal({ id: 'b', createdAt: at }), proposal({ id: 'a', createdAt: at })], []);
    expect(items.map((i) => i.key)).toEqual(['proposal:a', 'proposal:b']);
  });

  it('builds a Proposal item: who, the pair, the session Review opens, and its meta', () => {
    const [item] = needsYouItems(null, NOW, [proposal({ createdAt: minutesAgo(2), backers: [backer(), backer({ tokenId: 't2', sessionId: 's2' })] })], [
      { id: 's1', folder: '~/Projects/shop-api' },
    ]);
    expect(item).toMatchObject({
      kind: 'proposal',
      key: 'proposal:p1',
      status: 'pending',
      agent: 'laptop-claude',
      rest: ' and 1 other Agent propose',
      pair: 'orders.customerId → customers._id',
      sessionId: 's1',
      at: minutesAgo(2),
      meta: 'claude-code · ~/Projects/shop-api · 2m ago',
    });
  });

  it('leaves out of the meta what was not reported or is not known', () => {
    const item = proposalItem(proposal({ createdAt: minutesAgo(2), backers: [backer({ clientName: null, sessionId: null })] }), NOW, [
      { id: 's1', folder: '~/x' },
    ]);
    expect(item?.meta).toBe('2m ago');
    // An ended session's folder is not in the live list.
    expect(proposalItem(proposal({ createdAt: minutesAgo(2) }), NOW, [])?.meta).toBe('claude-code · 2m ago');
    expect(proposalItem(proposal({ createdAt: minutesAgo(2), backers: [] }), NOW, [])?.meta).toBe('2m ago');
    // Another session's folder is not this one's.
    expect(proposalItem(proposal({ createdAt: minutesAgo(2) }), NOW, [{ id: 's9', folder: '~/elsewhere' }])?.meta).toBe('claude-code · 2m ago');
  });

  it('makes no item of a decided Proposal', () => {
    for (const status of ['accepted', 'declined', 'expired', 'obsolete'] as const) {
      expect(proposalItem(proposal({ status }), NOW, [])).toBeNull();
    }
    expect(proposalItem(proposal({ status: 'later' }), NOW, [])?.status).toBe('later');
    expect(proposalItem(proposal({ status: 'pending' }), NOW, [])?.status).toBe('pending');
  });
});

describe('laterItems', () => {
  it('lists Later Proposals only, newest first', () => {
    const items = laterItems(
      [
        proposal({ id: 'p', status: 'pending' }),
        proposal({ id: 'l-old', status: 'later', createdAt: minutesAgo(9) }),
        proposal({ id: 'l-new', status: 'later', createdAt: minutesAgo(1) }),
        proposal({ id: 'd', status: 'declined' }),
      ],
      NOW,
      [{ id: 's1', folder: '~/Projects/shop-api' }],
    );
    expect(items[0]?.meta).toContain('~/Projects/shop-api');
    expect(items.map((i) => i.key)).toEqual(['proposal:l-new', 'proposal:l-old']);
  });
});

describe('forSession', () => {
  it("keeps a session's requests, and Proposals any of its backers filed in it", () => {
    const items = needsYouItems(
      { connectionRequests: [request({ sessionId: 's1' }), request({ sessionId: 's2', connectionId: 'c2' })] },
      NOW,
      [
        proposal({ id: 'mine', backers: [backer({ sessionId: 's9' }), backer({ tokenId: 't2', sessionId: 's1' })] }),
        proposal({ id: 'theirs', backers: [backer({ sessionId: 's2' })] }),
      ],
      [],
    );
    expect(forSession(items, 's1').map((i) => i.key).sort((a, b) => a.localeCompare(b))).toEqual(['proposal:mine', 's1\u0000c-shop']);
  });
});
