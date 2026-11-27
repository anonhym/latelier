// X30 §10.1: a toast per new Needs you item in Databases mode, updated in
// place, folded from the fourth request, none in Agents mode.
import { describe, expect, it } from 'vitest';
import type { AgentConnectionRequest } from '@shared/types';
import {
  FOLD_AT,
  INITIAL_TOASTS,
  foldTitle,
  hideRequestToasts,
  hideToast,
  stepToasts,
  toastCards,
  type ToastState,
} from '../../src/features/agents/agentToasts';
import { needsYouItems, type NeedsYouItem } from '../../src/features/agents/needsYou';
import { proposal } from '../helpers/agentProposalFixture';

const NOW = Date.parse('2026-11-27T12:00:00.000Z');
const at = (m: number) => new Date(NOW - m * 60_000).toISOString();

const request = (sessionId: string, over: Partial<AgentConnectionRequest> = {}): AgentConnectionRequest => ({
  sessionId,
  tokenName: 'laptop-claude',
  clientName: 'claude-code',
  folder: null,
  connectionId: 'c-shop',
  connectionName: 'Shop (prod)',
  firstAt: at(5),
  lastAt: at(5),
  count: 1,
  lastTool: 'find',
  database: 'shop',
  collection: 'orders',
  lastOutcome: 'refused',
  ...over,
});

const items = (requests: AgentConnectionRequest[], proposals = [] as ReturnType<typeof proposal>[]): NeedsYouItem[] =>
  needsYouItems({ connectionRequests: requests }, NOW, proposals, []);

const step = (prev: ToastState, list: NeedsYouItem[], over: { agentsMode?: boolean; proposalsLoaded?: boolean } = {}) =>
  stepToasts(prev, { items: list, agentsMode: over.agentsMode ?? false, proposalsLoaded: over.proposalsLoaded ?? true });

const keysOf = (state: ToastState, list: NeedsYouItem[], agentsMode = false) => toastCards(state, list, agentsMode).map((c) => c.key);

describe('stepToasts', () => {
  it('starts with no toast up, nothing seen, and no Proposal baseline', () => {
    expect(INITIAL_TOASTS.open).toEqual([]);
    expect(INITIAL_TOASTS.seen.size).toBe(0);
    expect(INITIAL_TOASTS.proposalsBaselined).toBe(false);
  });

  it('toasts each new request once, newest on top', () => {
    const one = items([request('s1')]);
    let s = step(INITIAL_TOASTS, one);
    expect(s.open).toEqual(['s1\u0000c-shop']);
    const two = items([request('s1'), request('s2', { lastAt: at(1) })]);
    s = step(s, two);
    expect(keysOf(s, two)).toEqual(['s2\u0000c-shop', 's1\u0000c-shop']);
    // The same items again change nothing, down to the state's identity.
    expect(step(s, two)).toBe(s);
  });

  it('updates a request in place on a later refusal of the same pair, never adding one', () => {
    let s = step(INITIAL_TOASTS, items([request('s1'), request('s2', { lastAt: at(4) })]));
    const refusedAgain = items([request('s1', { lastAt: at(0), count: 2, lastTool: 'count' }), request('s2', { lastAt: at(4) })]);
    s = step(s, refusedAgain);
    const cards = toastCards(s, refusedAgain, false);
    expect(cards.map((c) => c.key)).toEqual(['s2\u0000c-shop', 's1\u0000c-shop']);
    expect(cards[1]?.kind === 'request' && cards[1].item.meta).toContain('count on shop.orders');
  });

  it('forgets an item that left Needs you, so a fresh request for the pair toasts again', () => {
    const one = items([request('s1')]);
    let s = step(INITIAL_TOASTS, one);
    s = step(s, []);
    // Its toast goes with it, without a dismiss.
    expect(s.open).toEqual([]);
    expect(s.seen.size).toBe(0);
    s = step(s, one);
    expect(keysOf(s, one)).toEqual(['s1\u0000c-shop']);
  });

  it('keeps a dismissed toast hidden while its request stays open and updates', () => {
    let s = step(INITIAL_TOASTS, items([request('s1')]));
    s = hideToast(s, 's1\u0000c-shop');
    const updated = items([request('s1', { lastAt: at(0), count: 3 })]);
    s = step(s, updated);
    expect(keysOf(s, updated)).toEqual([]);
    // The badge still counts it: the item is still in Needs you.
    expect(updated).toHaveLength(1);
  });

  it('shows nothing in Agents mode, and an item that arrived there never toasts afterwards', () => {
    const one = items([request('s1')]);
    let s = step(INITIAL_TOASTS, one, { agentsMode: true });
    expect(keysOf(s, one, true)).toEqual([]);
    expect(s.seen.has('s1\u0000c-shop')).toBe(true);
    s = step(s, one, { agentsMode: false });
    expect(keysOf(s, one)).toEqual([]);
  });

  it('hides open toasts in Agents mode and shows them again back in Databases mode', () => {
    const one = items([request('s1')]);
    const s = step(INITIAL_TOASTS, one);
    expect(toastCards(s, one, true)).toEqual([]);
    expect(keysOf(s, one, false)).toEqual(['s1\u0000c-shop']);
  });

  it('keeps an item forgotten in Agents mode when it leaves there too', () => {
    const one = items([request('s1')]);
    let s = step(INITIAL_TOASTS, one, { agentsMode: true });
    // One leaves and another arrives in the same step: the state still changes.
    const other = items([request('s2')]);
    s = step(s, other, { agentsMode: true });
    expect([...s.seen]).toEqual(['s2\u0000c-shop']);
  });

  it('toasts a new pending Proposal, but not the ones already open when the first list lands', () => {
    const old = proposal({ id: 'old', createdAt: at(30) });
    let s = step(INITIAL_TOASTS, items([], []), { proposalsLoaded: false });
    expect(s.proposalsBaselined).toBe(false);
    // Before the first list, a Proposal is neither toasted nor seen.
    const early = items([], [old]);
    s = step(s, early, { proposalsLoaded: false });
    expect(s.seen.has('proposal:old')).toBe(false);
    s = step(s, early, { proposalsLoaded: true });
    expect(s.proposalsBaselined).toBe(true);
    expect(keysOf(s, early)).toEqual([]);
    const fresh = items([], [old, proposal({ id: 'new', createdAt: at(0) })]);
    s = step(s, fresh);
    expect(keysOf(s, fresh)).toEqual(['proposal:new']);
  });

  it('toasts requests before the first Proposal list lands', () => {
    const one = items([request('s1')]);
    const s = step(INITIAL_TOASTS, one, { proposalsLoaded: false });
    expect(keysOf(s, one)).toEqual(['s1\u0000c-shop']);
    expect(s.proposalsBaselined).toBe(false);
  });

  it('marks the baseline once and reports the change', () => {
    const s = step(INITIAL_TOASTS, [], { proposalsLoaded: true });
    expect(s).not.toBe(INITIAL_TOASTS);
    expect(s.proposalsBaselined).toBe(true);
    expect(step(s, [], { proposalsLoaded: true })).toBe(s);
  });
});

describe('hideToast', () => {
  it('hides one toast and leaves the rest', () => {
    const two = items([request('s1'), request('s2', { lastAt: at(1) })]);
    const s = step(INITIAL_TOASTS, two);
    const hidden = hideToast(s, 's2\u0000c-shop');
    expect(keysOf(hidden, two)).toEqual(['s1\u0000c-shop']);
    expect(hidden.seen.has('s2\u0000c-shop')).toBe(true);
    expect(hideToast(hidden, 'nope')).toBe(hidden);
  });
});

describe('toastCards', () => {
  const four = items(['s1', 's2', 's3', 's4'].map((id, i) => request(id, { lastAt: at(10 - i) })));

  it('folds the request toasts into one from the fourth', () => {
    expect(FOLD_AT).toBe(4);
    const three = four.slice(1);
    let s = step(INITIAL_TOASTS, three);
    expect(toastCards(s, three, false).map((c) => c.kind)).toEqual(['request', 'request', 'request']);
    s = step(s, four);
    expect(toastCards(s, four, false)).toEqual([{ kind: 'fold', key: 'fold', count: 4 }]);
    expect(foldTitle(4)).toBe('4 Agent requests');
  });

  it('keeps Proposal toasts apart from the fold, in their place', () => {
    let s = step(INITIAL_TOASTS, [], { proposalsLoaded: true });
    const p = proposal({ id: 'p', createdAt: at(20) });
    const first = items([], [p]);
    s = step(s, first);
    const all = items(['s1', 's2', 's3', 's4'].map((id) => request(id)), [p]);
    s = step(s, all);
    expect(toastCards(s, all, false).map((c) => c.kind)).toEqual(['fold', 'proposal']);
  });

  it('folds nothing while three requests share the stack with a Proposal', () => {
    let s = step(INITIAL_TOASTS, [], { proposalsLoaded: true });
    const all = items(['s1', 's2', 's3'].map((id) => request(id)), [proposal({ id: 'p', createdAt: at(20) })]);
    s = step(s, all);
    expect(toastCards(s, all, false).map((c) => c.kind)).toEqual(['request', 'request', 'request', 'proposal']);
  });

  it('puts the fold where the newest request stood, under a newer Proposal', () => {
    let s = step(INITIAL_TOASTS, [], { proposalsLoaded: true });
    const requests = ['s1', 's2', 's3', 's4'].map((id) => request(id));
    s = step(s, items(requests));
    const all = items(requests, [proposal({ id: 'p', createdAt: at(0) })]);
    s = step(s, all);
    expect(toastCards(s, all, false)).toEqual([expect.objectContaining({ kind: 'proposal' }), { kind: 'fold', key: 'fold', count: 4 }]);
  });

  it('skips a toast whose item is gone', () => {
    const one = items([request('s1')]);
    const s = step(INITIAL_TOASTS, one);
    expect(toastCards(s, [], false)).toEqual([]);
  });

  it('draws a Proposal toast from its item', () => {
    let s = step(INITIAL_TOASTS, [], { proposalsLoaded: true });
    const list = items([], [proposal({ id: 'p' })]);
    s = step(s, list);
    const [card] = toastCards(s, list, false);
    expect(card?.kind).toBe('proposal');
    expect(card?.kind === 'proposal' && card.item.pair).toBe('orders.customerId → customers._id');
  });
});

describe('hideRequestToasts', () => {
  it('hides every request toast and keeps the Proposal ones', () => {
    let s = step(INITIAL_TOASTS, [], { proposalsLoaded: true });
    const p = proposal({ id: 'p', createdAt: at(20) });
    const all = items([request('s1'), request('s2')], [p]);
    s = step(s, all);
    const hidden = hideRequestToasts(s, all);
    expect(keysOf(hidden, all)).toEqual(['proposal:p']);
    expect(hideRequestToasts(hidden, all)).toBe(hidden);
  });
});
