// Test-only builders for Agent Proposals (X28) and Read Log rows (X27 §16.5).
import type { AgentCallRow, AgentProposal, AgentProposalBacker } from '@shared/types';

export function backer(over: Partial<AgentProposalBacker> = {}): AgentProposalBacker {
  return {
    tokenId: 't1',
    tokenName: 'laptop-claude',
    sessionId: 's1',
    clientName: 'claude-code',
    reason: 'orders.customerId holds customers._id values',
    createdAt: '2026-11-27T10:00:00.000Z',
    ...over,
  };
}

export function proposal(over: Partial<AgentProposal> = {}): AgentProposal {
  return {
    id: 'p1',
    kind: 'reference_rule',
    status: 'pending',
    connectionId: 'c-shop',
    connectionName: 'Shop (prod)',
    sourceDb: 'shop',
    sourceCollection: 'orders',
    sourceField: 'customerId',
    targetDb: 'shop',
    targetCollection: 'customers',
    targetField: '_id',
    pairKey: 'c-shop|["shop","orders","customerId","shop","customers","_id"]',
    createdAt: '2026-11-27T10:00:00.000Z',
    decidedAt: null,
    expiresAt: '2026-12-27T10:00:00.000Z',
    ruleId: null,
    savedFor: null,
    backers: [backer()],
    ...over,
  };
}

export function callRow(over: Partial<AgentCallRow> = {}): AgentCallRow {
  return {
    id: 'k1',
    sessionId: 's1',
    ts: '2026-11-27T10:00:00.000Z',
    tokenId: 't1',
    tokenName: 'laptop-claude',
    clientName: 'claude-code',
    clientVersion: '2.0.1',
    connectionId: 'c-shop',
    connectionName: 'Shop (prod)',
    database: 'shop',
    collection: 'orders',
    tool: 'find',
    docCount: 50,
    bytes: 2048,
    durationMs: 38,
    outcome: 'ok',
    truncated: false,
    request: JSON.stringify({ connectionId: 'c-shop', database: 'shop', collection: 'orders', filter: { status: 'shipped' } }),
    requestTruncated: false,
    ...over,
  };
}
