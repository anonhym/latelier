// X28 §5, §7: the parts every surface shows of a Proposal.
import { describe, expect, it } from 'vitest';
import {
  addLabel,
  backerLine,
  backerName,
  checkSegments,
  checkText,
  checkTone,
  proposalPairText,
  proposalWho,
  proposalsForTab,
  reasonLabel,
  reviewSessionId,
} from '../../src/features/agents/proposalView';
import { backer, proposal } from '../helpers/agentProposalFixture';

const sampled = (sampledN: number, resolved: number) =>
  ({
    kind: 'sampled',
    sampled: sampledN,
    resolved,
    sourceCollection: 'orders',
    sourceField: 'customerId',
    targetCollection: 'customers',
    targetField: '_id',
  }) as const;

describe('proposalPairText', () => {
  it('writes the pair as X26 does, without databases when both sides share one', () => {
    expect(proposalPairText(proposal())).toBe('orders.customerId → customers._id');
  });

  it('names both databases when they differ', () => {
    expect(proposalPairText(proposal({ targetDb: 'crm' }))).toBe('shop.orders.customerId → crm.customers._id');
  });
});

describe('backers', () => {
  it('names a backer, or a stand-in when its name was not kept', () => {
    expect(backerName(backer())).toBe('laptop-claude');
    expect(backerName(backer({ tokenName: null }))).toBe('An Agent');
    expect(backerName(backer({ tokenName: '' }))).toBe('An Agent');
    expect(backerName(undefined)).toBe('An Agent');
  });

  it('writes name · client, or the name alone', () => {
    expect(backerLine(backer())).toBe('laptop-claude · claude-code');
    expect(backerLine(backer({ clientName: null }))).toBe('laptop-claude');
  });

  it("labels each reason in the Agent's words", () => {
    expect(reasonLabel(backer())).toBe("In laptop-claude's words");
  });

  it('says who proposes it: one Agent, one other, several others', () => {
    expect(proposalWho(proposal())).toEqual({ agent: 'laptop-claude', rest: ' proposes' });
    expect(proposalWho(proposal({ backers: [backer(), backer({ tokenId: 't2', tokenName: 'ci' })] }))).toEqual({
      agent: 'laptop-claude',
      rest: ' and 1 other Agent propose',
    });
    expect(
      proposalWho(proposal({ backers: [backer(), backer({ tokenId: 't2' }), backer({ tokenId: 't3' })] })).rest,
    ).toBe(' and 2 other Agents propose');
    expect(proposalWho(proposal({ backers: [] }))).toEqual({ agent: 'An Agent', rest: ' proposes' });
  });

  it("reviews in the first backer's session", () => {
    expect(reviewSessionId(proposal({ backers: [backer({ sessionId: 'first' }), backer({ sessionId: 'second' })] }))).toBe('first');
    expect(reviewSessionId(proposal({ backers: [backer({ sessionId: null })] }))).toBeNull();
    expect(reviewSessionId(proposal({ backers: [] }))).toBeNull();
  });
});

describe('the check', () => {
  it('reads n of m sampled documents resolving', () => {
    expect(checkText(sampled(3, 3))).toBe('3 of 3 sampled documents in orders resolve');
    expect(checkText(sampled(3, 1))).toBe('1 of 3 sampled documents in orders resolve');
    expect(checkSegments(sampled(3, 0))).toEqual([{ text: '0 of 3 sampled documents in orders resolve' }]);
    // One sampled document reads in the singular.
    expect(checkText(sampled(1, 1))).toBe('1 of 1 sampled document in orders resolves');
    expect(checkText(sampled(1, 0))).toBe('0 of 1 sampled document in orders resolves');
  });

  it('names the field when no sampled document has it, as code', () => {
    expect(checkSegments(sampled(0, 0))).toEqual([{ text: 'No sampled document in orders has ' }, { text: 'customerId', code: true }]);
    expect(checkText(sampled(0, 0))).toBe('No sampled document in orders has customerId');
  });

  it('asks to open the Connection when it is not open', () => {
    expect(checkText({ kind: 'not-open', connectionName: 'Shop (prod)' })).toBe('Open Shop (prod) to check this relation');
  });

  it('says why there is nothing to check once the Proposal is no longer open', () => {
    expect(checkSegments({ kind: 'closed', status: 'expired' })).toEqual([{ text: 'This Proposal expired' }]);
    expect(checkText({ kind: 'closed', status: 'obsolete' })).toBe('A Reference Rule already covers this field');
    expect(checkText({ kind: 'closed', status: 'accepted' })).toBe('This Proposal was added');
    expect(checkText({ kind: 'closed', status: 'declined' })).toBe('This Proposal was declined');
  });

  it('tones: green when one resolved, warning when none did, neutral when nothing was read', () => {
    expect(checkTone(sampled(3, 1))).toBe('ok');
    expect(checkTone(sampled(3, 0))).toBe('warn');
    expect(checkTone(sampled(0, 0))).toBe('warn');
    expect(checkTone({ kind: 'not-open', connectionName: 'x' })).toBe('neutral');
    expect(checkTone({ kind: 'closed', status: 'expired' })).toBe('neutral');
  });

  it('reads Add anyway only after a check that read and found nothing resolving', () => {
    expect(addLabel(null)).toBe('Add Reference Rule');
    expect(addLabel({ kind: 'not-open', connectionName: 'x' })).toBe('Add Reference Rule');
    expect(addLabel({ kind: 'closed', status: 'obsolete' })).toBe('Add Reference Rule');
    expect(addLabel(sampled(3, 1))).toBe('Add Reference Rule');
    expect(addLabel(sampled(3, 0))).toBe('Add anyway');
    expect(addLabel(sampled(0, 0))).toBe('Add anyway');
  });
});

describe('proposalsForTab', () => {
  const tab = { connectionId: 'c-shop', dbName: 'shop', collection: 'orders' };

  it('keeps pending Proposals on the tab’s Connection and source namespace, oldest first', () => {
    const list = [
      proposal({ id: 'new', createdAt: '2026-11-27T12:00:00.000Z' }),
      proposal({ id: 'later', status: 'later' }),
      proposal({ id: 'other-conn', connectionId: 'c-other' }),
      proposal({ id: 'other-db', sourceDb: 'crm' }),
      proposal({ id: 'other-coll', sourceCollection: 'customers' }),
      proposal({ id: 'old', createdAt: '2026-11-27T09:00:00.000Z' }),
      proposal({ id: 'tie-b', createdAt: '2026-11-27T11:00:00.000Z' }),
      proposal({ id: 'tie-a', createdAt: '2026-11-27T11:00:00.000Z' }),
    ];
    expect(proposalsForTab(list, tab).map((p) => p.id)).toEqual(['old', 'tie-a', 'tie-b', 'new']);
  });

  it('does not reorder the list it was given', () => {
    const list = [proposal({ id: 'b', createdAt: '2026-11-27T12:00:00.000Z' }), proposal({ id: 'a', createdAt: '2026-11-27T09:00:00.000Z' })];
    proposalsForTab(list, tab);
    expect(list.map((p) => p.id)).toEqual(['b', 'a']);
  });
});
