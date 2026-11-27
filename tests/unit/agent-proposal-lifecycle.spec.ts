import { describe, it, expect } from 'vitest';
import type { AgentProposalStatus } from '@shared/types';
import {
  coversSourceField,
  DECIDED_STATUSES,
  expiresAt,
  isExpired,
  isOpen,
  MAX_OPEN_PER_TOKEN,
  nextStatus,
  OPEN_STATUSES,
  PROPOSAL_TTL_DAYS,
  proposeAction,
  sweepEvent,
  type ProposalEvent,
  type SweepRow,
} from '../../electron/agent/proposalLifecycle';

const ALL: AgentProposalStatus[] = ['pending', 'later', 'accepted', 'declined', 'expired', 'obsolete'];
const EVENTS: ProposalEvent[] = ['later', 'reopen', 'accept', 'decline', 'expire', 'obsolete'];

describe('isOpen', () => {
  it('is pending and later only', () => {
    expect(ALL.filter(isOpen)).toEqual(['pending', 'later']);
    expect([...OPEN_STATUSES]).toEqual(['pending', 'later']);
    expect([...DECIDED_STATUSES]).toEqual(['accepted', 'declined', 'expired', 'obsolete']);
  });
});

describe('nextStatus', () => {
  it('follows X28 §3 from pending', () => {
    expect(EVENTS.map((e) => nextStatus('pending', e))).toEqual(['later', null, 'accepted', 'declined', 'expired', 'obsolete']);
  });

  it('follows X28 §3 from later: reopen, not a second Not now', () => {
    expect(EVENTS.map((e) => nextStatus('later', e))).toEqual([null, 'pending', 'accepted', 'declined', 'expired', 'obsolete']);
  });

  it('never moves a decided Proposal', () => {
    for (const status of DECIDED_STATUSES) {
      for (const event of EVENTS) expect(nextStatus(status, event), `${status} ${event}`).toBeNull();
    }
  });
});

describe('expiry', () => {
  it('is 30 days after filing', () => {
    expect(PROPOSAL_TTL_DAYS).toBe(30);
    expect(expiresAt('2026-11-01T10:00:00.000Z')).toBe('2026-12-01T10:00:00.000Z');
  });

  it('counts the instant itself as expired, and a millisecond before as not', () => {
    const at = '2026-12-01T10:00:00.000Z';
    expect(isExpired(Date.parse(at) - 1, at)).toBe(false);
    expect(isExpired(Date.parse(at), at)).toBe(true);
    expect(isExpired(Date.parse(at) + 1, at)).toBe(true);
  });
});

describe('coversSourceField', () => {
  const source = { sourceDb: 'shop', sourceCollection: 'orders', sourceField: 'customerId' };

  it('matches a rule on the same database, collection and field', () => {
    expect(coversSourceField([source], source)).toBe(true);
    expect(coversSourceField([], source)).toBe(false);
  });

  it('needs all three to match', () => {
    expect(coversSourceField([{ ...source, sourceDb: 'other' }], source)).toBe(false);
    expect(coversSourceField([{ ...source, sourceCollection: 'other' }], source)).toBe(false);
    expect(coversSourceField([{ ...source, sourceField: 'other' }], source)).toBe(false);
  });

  it('finds the match among others', () => {
    expect(coversSourceField([{ ...source, sourceField: 'x' }, source], source)).toBe(true);
  });
});

describe('sweepEvent', () => {
  const row: SweepRow = {
    status: 'pending',
    expiresAt: '2026-12-01T00:00:00.000Z',
    sourceDb: 'shop',
    sourceCollection: 'orders',
    sourceField: 'customerId',
  };
  const before = Date.parse('2026-11-30T23:59:59.999Z');
  const ctx = { nowMs: before, connectionExists: true, rules: [] };

  it('leaves a live Proposal alone', () => {
    expect(sweepEvent(row, ctx)).toBeNull();
    expect(sweepEvent({ ...row, status: 'later' }, ctx)).toBeNull();
  });

  it('expires one whose 30 days are up, with an injected clock', () => {
    expect(sweepEvent(row, { ...ctx, nowMs: Date.parse(row.expiresAt) })).toBe('expire');
    expect(sweepEvent({ ...row, status: 'later' }, { ...ctx, nowMs: Date.parse(row.expiresAt) })).toBe('expire');
  });

  it('expires one whose Connection was deleted', () => {
    expect(sweepEvent(row, { ...ctx, connectionExists: false })).toBe('expire');
  });

  it('makes one obsolete once a rule covers its source field', () => {
    expect(sweepEvent(row, { ...ctx, rules: [row] })).toBe('obsolete');
    expect(sweepEvent(row, { ...ctx, rules: [{ ...row, sourceField: 'other' }] })).toBeNull();
  });

  it('expires rather than obsoletes when both apply', () => {
    expect(sweepEvent(row, { ...ctx, connectionExists: false, rules: [row] })).toBe('expire');
  });

  it('never touches a decided one', () => {
    for (const status of DECIDED_STATUSES) {
      expect(sweepEvent({ ...row, status }, { nowMs: Date.parse(row.expiresAt) + 1, connectionExists: false, rules: [row] })).toBeNull();
    }
  });
});

describe('proposeAction', () => {
  it('returns the existing id for a repeat, even at the cap', () => {
    expect(proposeAction({ openExists: true, tokenBacksOpen: true, tokenOpenCount: 3 })).toBe('repeat');
    expect(proposeAction({ openExists: true, tokenBacksOpen: true, tokenOpenCount: MAX_OPEN_PER_TOKEN })).toBe('repeat');
  });

  it('refuses to create or join at the cap of 20', () => {
    expect(MAX_OPEN_PER_TOKEN).toBe(20);
    expect(proposeAction({ openExists: false, tokenBacksOpen: false, tokenOpenCount: 20 })).toBe('limit');
    expect(proposeAction({ openExists: true, tokenBacksOpen: false, tokenOpenCount: 20 })).toBe('limit');
    expect(proposeAction({ openExists: false, tokenBacksOpen: false, tokenOpenCount: 21 })).toBe('limit');
  });

  it('joins another token’s open Proposal below the cap', () => {
    expect(proposeAction({ openExists: true, tokenBacksOpen: false, tokenOpenCount: 19 })).toBe('join');
  });

  it('creates one when none is open for the pair', () => {
    expect(proposeAction({ openExists: false, tokenBacksOpen: false, tokenOpenCount: 0 })).toBe('create');
    expect(proposeAction({ openExists: false, tokenBacksOpen: false, tokenOpenCount: 19 })).toBe('create');
  });
});
