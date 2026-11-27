import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createAgentHarness, type AgentHarness } from '../helpers/agentHarness';
import { connectAgent, textOf, type AgentConnection } from '../helpers/agentSocket';
import { FamilyRepo } from '../../electron/db/repositories/FamilyRepo';
import { ReferenceRulesRepo } from '../../electron/db/repositories/ReferenceRulesRepo';
import { RowSummaryRepo } from '../../electron/db/repositories/RowSummaryRepo';
import { FamilyService } from '../../electron/services/FamilyService';
import { NEVER_PAIRS_KEY } from '../../electron/services/AgentProposalService';
import { PROPOSED_TEXT } from '../../electron/agent/proposalTools';
import { pairKey } from '../../src/utils/referenceDiscovery';

const DAY = 24 * 60 * 60 * 1000;

interface ToolResult {
  content?: unknown;
  isError?: boolean;
}

describe('Agent Proposals (X28)', () => {
  let h: AgentHarness;
  let clock: number;
  let conn: string;
  let a: AgentConnection;
  let b: AgentConnection;
  let tokenA: string;
  let tokenB: string;
  let socketPath: string;
  const open: AgentConnection[] = [];

  beforeEach(async () => {
    clock = Date.parse('2026-11-27T10:00:00.000Z');
    h = createAgentHarness({ proposalsNow: () => clock });
    conn = randomUUID();
    h.addConnection(conn, 'prod', { shared: true, status: 'connected' });
    const ta = h.svc.addToken('laptop-claude');
    const tb = h.svc.addToken('ci-agent');
    tokenA = ta.info.id;
    tokenB = tb.info.id;
    socketPath = await h.enable();
    a = await connectAgent(socketPath, ta.token, { name: 'claude-code', version: '1.0' });
    b = await connectAgent(socketPath, tb.token, { name: 'cursor', version: '2.0' });
    open.push(a, b);
  });

  afterEach(async () => {
    for (const c of open.splice(0)) await c.close().catch(() => undefined);
    await h.cleanup();
  });

  const pair = (over: Record<string, unknown> = {}) => ({
    connectionId: conn,
    sourceDb: 'shop',
    sourceCollection: 'orders',
    sourceField: 'customerId',
    targetDb: 'shop',
    targetCollection: 'customers',
    reason: 'orders.customerId values match customers._id',
    ...over,
  });
  const call = (agent: AgentConnection, name: string, args: Record<string, unknown>) =>
    agent.client.callTool({ name, arguments: args }) as Promise<ToolResult>;
  const propose = (agent: AgentConnection, over: Record<string, unknown> = {}) => call(agent, 'propose_reference_rule', pair(over));
  const idOf = (r: ToolResult): string => {
    const text = textOf(r);
    expect(text.startsWith(`${PROPOSED_TEXT}\n{"proposalId":"`)).toBe(true);
    return (JSON.parse(text.split('\n')[1]!) as { proposalId: string }).proposalId;
  };
  const codeOf = (r: ToolResult) => textOf(r).split(':')[0];
  const count = (table: string) => (h.tmp.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const ruleCount = () => count('reference_rules');
  const logRows = () =>
    h.tmp.db.prepare('SELECT tool, outcome, database, collection, token_id FROM agent_read_log ORDER BY ts, rowid').all() as Array<{
      tool: string;
      outcome: string;
      database: string | null;
      collection: string | null;
      token_id: string;
    }>;
  const sessionOf = (client: string) => h.svc.getState().sessions.find((s) => s.clientName === client)!.id;

  describe('propose_reference_rule', () => {
    it('files one pending Proposal with the Agent as first backer, and creates no rule', async () => {
      const r = await propose(a);
      expect(r.isError).toBeUndefined();
      const id = idOf(r);
      const [p] = h.proposals.list({ limit: 10 });
      expect(p).toMatchObject({
        id,
        kind: 'reference_rule',
        status: 'pending',
        connectionId: conn,
        connectionName: 'prod',
        sourceDb: 'shop',
        sourceCollection: 'orders',
        sourceField: 'customerId',
        targetDb: 'shop',
        targetCollection: 'customers',
        targetField: '_id',
        pairKey: pairKey(conn, {
          source: { dbName: 'shop', collection: 'orders', field: 'customerId' },
          target: { dbName: 'shop', collection: 'customers', field: '_id' },
        }),
        createdAt: '2026-11-27T10:00:00.000Z',
        expiresAt: '2026-12-27T10:00:00.000Z',
        decidedAt: null,
        ruleId: null,
        savedFor: null,
      });
      expect(p!.backers).toEqual([
        {
          tokenId: tokenA,
          tokenName: 'laptop-claude',
          sessionId: sessionOf('claude-code'),
          clientName: 'claude-code',
          reason: 'orders.customerId values match customers._id',
          createdAt: '2026-11-27T10:00:00.000Z',
        },
      ]);
      expect(ruleCount()).toBe(0);
      expect(h.proposalEvents).toEqual([{ id, status: 'pending' }]);
    });

    it('writes one Read Log row per call, refusals included, under the source namespace', async () => {
      await propose(a);
      await propose(a, { sourceField: '' });
      await call(a, 'get_proposal', { proposalId: randomUUID() });
      expect(logRows()).toEqual([
        { tool: 'propose_reference_rule', outcome: 'ok', database: 'shop', collection: 'orders', token_id: tokenA },
        { tool: 'propose_reference_rule', outcome: 'INVALID_INPUT', database: 'shop', collection: 'orders', token_id: tokenA },
        { tool: 'get_proposal', outcome: 'INVALID_INPUT', database: null, collection: null, token_id: tokenA },
      ]);
    });

    describe('checks in X28 §4.1 order', () => {
      const deniedAndBad = { sourceDb: 'admin', sourceField: 'a..b' };

      it('1: refuses a Connection that is not shared, or not open, before anything else', async () => {
        h.statuses.set(conn, 'disconnected');
        expect(codeOf(await propose(a, deniedAndBad))).toBe('NOT_OPEN');
        h.connRepo.setShared(conn, false);
        expect(codeOf(await propose(a, deniedAndBad))).toBe('NOT_SHARED');
        expect(codeOf(await propose(a, { connectionId: randomUUID() }))).toBe('NOT_SHARED');
        expect(count('agent_proposals')).toBe(0);
      });

      it('2: refuses a §7.4 namespace on either side before a bad field path', async () => {
        expect(codeOf(await propose(a, deniedAndBad))).toBe('NAMESPACE_DENIED');
        expect(codeOf(await propose(a, { targetDb: 'config', sourceField: '' }))).toBe('NAMESPACE_DENIED');
        expect(codeOf(await propose(a, { sourceCollection: 'system.views' }))).toBe('NAMESPACE_DENIED');
        expect(codeOf(await propose(a, { targetCollection: 'system.users' }))).toBe('NAMESPACE_DENIED');
      });

      it('3: refuses a malformed field path or a field pointing at itself before the Never list', async () => {
        h.appState.set(NEVER_PAIRS_KEY, [pairKey(conn, { source: { dbName: 'shop', collection: 'orders', field: '$x' }, target: { dbName: 'shop', collection: 'customers', field: '_id' } })]);
        for (const bad of [{ sourceField: '$x' }, { sourceField: '' }, { targetField: 'items.0' }, { sourceField: 'a'.repeat(257) }]) {
          const r = await propose(a, bad);
          expect(textOf(r)).toMatch(/^INVALID_INPUT: The input is invalid\. (sourceField|targetField): /);
        }
        const self = await propose(a, { targetCollection: 'orders', targetField: 'customerId' });
        expect(textOf(self)).toBe('INVALID_INPUT: The input is invalid. the source and target are the same field');
      });

      it('4: refuses a pair on the Never list before checking for a rule', async () => {
        h.refs.create({ owner: { connectionId: conn }, sourceDb: 'shop', sourceCollection: 'orders', sourceField: 'customerId', targetDb: 'shop', targetCollection: 'customers' });
        const key = pairKey(conn, { source: { dbName: 'shop', collection: 'orders', field: 'customerId' }, target: { dbName: 'shop', collection: 'customers', field: '_id' } });
        h.appState.set(NEVER_PAIRS_KEY, [key]);
        expect(textOf(await propose(a))).toBe('PROPOSAL_DECLINED: The user declined this relation. Do not propose it again.');
      });

      it('5: refuses a source field any effective rule covers, switched off or from the Family, naming no rule', async () => {
        const rule = h.refs.create({ owner: { connectionId: conn }, sourceDb: 'shop', sourceCollection: 'orders', sourceField: 'customerId', targetDb: 'shop', targetCollection: 'people', enabled: false });
        const text = textOf(await propose(a));
        expect(text).toBe('ALREADY_CONFIGURED: A Reference Rule already covers this source field.');
        expect(text).not.toContain(rule.id);
        expect(text).not.toContain('people');
        const families = new FamilyService(new FamilyRepo(h.tmp.db), new ReferenceRulesRepo(h.tmp.db), new RowSummaryRepo(h.tmp.db));
        const familyId = families.create({ name: 'Shop', memberIds: [conn] }).id;
        h.refs.create({ owner: { familyId }, sourceDb: 'shop', sourceCollection: 'orders', sourceField: 'sellerId', targetDb: 'shop', targetCollection: 'sellers' });
        expect(codeOf(await propose(a, { sourceField: 'sellerId', targetCollection: 'sellers' }))).toBe('ALREADY_CONFIGURED');
        expect(count('agent_proposals')).toBe(0);
      });
    });

    it('6: a repeat by the same token returns the same id and writes nothing', async () => {
      const id = idOf(await propose(a));
      const again = await propose(a, { reason: 'a different reason' });
      expect(idOf(again)).toBe(id);
      expect(count('agent_proposals')).toBe(1);
      expect(count('agent_proposal_backers')).toBe(1);
      expect(h.proposals.list({ limit: 10 })[0]!.backers[0]!.reason).toBe('orders.customerId values match customers._id');
      expect(h.proposalEvents).toHaveLength(1);
    });

    it('8: another token joins as a backer with its own reason, session and client, and gets the same answer', async () => {
      const first = await propose(a);
      const joined = await propose(b, { reason: 'seen in the invoices too' });
      // The last line is the app's meta line, which carries the call's duration.
      const answer = (r: ToolResult) => textOf(r).split('\n').slice(0, -1).join('\n');
      expect(answer(joined)).toBe(answer(first));
      expect(answer(first)).toBe(`${PROPOSED_TEXT}\n{"proposalId":"${idOf(first)}"}`);
      const [p] = h.proposals.list({ limit: 10 });
      expect(p!.backers.map((x) => [x.tokenName, x.clientName, x.sessionId, x.reason])).toEqual([
        ['laptop-claude', 'claude-code', sessionOf('claude-code'), 'orders.customerId values match customers._id'],
        ['ci-agent', 'cursor', sessionOf('cursor'), 'seen in the invoices too'],
      ]);
      expect(count('agent_proposals')).toBe(1);
    });

    it('7: caps a token at 20 open Proposals, counting the ones it joined, but still answers a repeat', async () => {
      const joinedId = idOf(await propose(b, { sourceField: 'joined' }));
      expect(idOf(await propose(a, { sourceField: 'joined' }))).toBe(joinedId);
      for (let i = 0; i < 19; i++) expect((await propose(a, { sourceField: `f${i}` })).isError).toBeUndefined();
      expect(textOf(await propose(a, { sourceField: 'one-more' }))).toBe(
        'PROPOSAL_LIMIT: This Agent already has 20 open Proposals. Wait until the user decides some of them.',
      );
      const othersId = idOf(await propose(b, { sourceField: 'other' }));
      expect(codeOf(await propose(a, { sourceField: 'other' }))).toBe('PROPOSAL_LIMIT');
      expect(idOf(await propose(a, { sourceField: 'f3' }))).toBeTruthy();
      expect(idOf(await propose(a, { sourceField: 'joined' }))).toBe(joinedId);
      // A decided Proposal no longer counts.
      h.proposals.decline(joinedId);
      expect(idOf(await propose(a, { sourceField: 'other' }))).toBe(othersId);
    });

    it('on a shared Connection that is not open, is refused NOT_OPEN and raises a Connection request', async () => {
      h.statuses.set(conn, 'disconnected');
      expect(codeOf(await propose(a))).toBe('NOT_OPEN');
      expect(h.svc.getState().connectionRequests).toMatchObject([
        { connectionId: conn, connectionName: 'prod', lastTool: 'propose_reference_rule', database: 'shop', collection: 'orders' },
      ]);
      expect(count('agent_proposals')).toBe(0);
    });
  });

  describe('get_proposal', () => {
    it('answers each backer with the status, and reads as unknown to any other token or id', async () => {
      const id = idOf(await propose(a));
      await propose(b);
      expect(JSON.parse(textOf(await call(a, 'get_proposal', { proposalId: id })).split('\n')[0]!)).toEqual({ proposalId: id, status: 'pending' });
      expect(JSON.parse(textOf(await call(b, 'get_proposal', { proposalId: id })).split('\n')[0]!)).toEqual({ proposalId: id, status: 'pending' });
      const third = h.svc.addToken('third');
      const c = await connectAgent(socketPath, third.token);
      open.push(c);
      const stranger = textOf(await call(c, 'get_proposal', { proposalId: id }));
      const unknown = textOf(await call(c, 'get_proposal', { proposalId: randomUUID() }));
      expect(stranger).toBe('INVALID_INPUT: The input is invalid. proposalId: unknown');
      expect(unknown).toBe(stranger);
    });

    it('answers with no Connection open, since it reads nothing', async () => {
      const id = idOf(await propose(a));
      h.statuses.set(conn, 'disconnected');
      h.connRepo.setShared(conn, false);
      expect((await call(a, 'get_proposal', { proposalId: id })).isError).toBeUndefined();
    });

    it('reports accepted with who the rule was saved for, and a declined or expired one by its status', async () => {
      const accepted = idOf(await propose(a));
      const declined = idOf(await propose(a, { sourceField: 'sellerId', targetCollection: 'sellers' }));
      const expiring = idOf(await propose(a, { sourceField: 'shipperId', targetCollection: 'shippers' }));
      h.proposals.accept(accepted, 'connection');
      h.proposals.decline(declined);
      clock += 30 * DAY;
      const status = async (id: string) => JSON.parse(textOf(await call(a, 'get_proposal', { proposalId: id })).split('\n')[0]!) as Record<string, unknown>;
      expect(await status(accepted)).toEqual({ proposalId: accepted, status: 'accepted', savedFor: 'connection' });
      expect(await status(declined)).toEqual({ proposalId: declined, status: 'declined' });
      expect(await status(expiring)).toEqual({ proposalId: expiring, status: 'expired' });
    });
  });

  describe('deciding', () => {
    it('accept creates the stored pair as a rule for this Connection by default', async () => {
      const id = idOf(await propose(a));
      const result = h.proposals.accept(id, 'connection');
      expect(result.savedFor).toBe('connection');
      const rule = h.refs.get(result.ruleId);
      expect(rule).toMatchObject({
        owner: { connectionId: conn },
        sourceDb: 'shop',
        sourceCollection: 'orders',
        sourceField: 'customerId',
        targetDb: 'shop',
        targetCollection: 'customers',
        targetField: '_id',
      });
      expect(h.proposals.list({ limit: 10 })[0]).toMatchObject({
        status: 'accepted',
        ruleId: result.ruleId,
        savedFor: 'connection',
        decidedAt: '2026-11-27T10:00:00.000Z',
      });
      expect(h.proposalEvents.at(-1)).toEqual({ id, status: 'accepted' });
    });

    it('accept for the Family saves the rule on the Family, and is refused for a Connection in none', async () => {
      const id = idOf(await propose(a));
      expect(() => h.proposals.accept(id, 'family')).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
      expect(ruleCount()).toBe(0);
      const families = new FamilyService(new FamilyRepo(h.tmp.db), new ReferenceRulesRepo(h.tmp.db), new RowSummaryRepo(h.tmp.db));
      const familyId = families.create({ name: 'Shop', memberIds: [conn] }).id;
      const result = h.proposals.accept(id, 'family');
      expect(h.refs.get(result.ruleId).owner).toEqual({ familyId });
      expect(h.proposals.list({ limit: 1 })[0]).toMatchObject({ status: 'accepted', savedFor: 'family' });
    });

    it('accept is refused for a Proposal no longer open, and one whose source field gained a rule becomes obsolete', async () => {
      const declined = idOf(await propose(a));
      h.proposals.decline(declined);
      expect(() => h.proposals.accept(declined, 'connection')).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
      const gained = idOf(await propose(a, { sourceField: 'sellerId', targetCollection: 'sellers' }));
      h.refs.create({ owner: { connectionId: conn }, sourceDb: 'shop', sourceCollection: 'orders', sourceField: 'sellerId', targetDb: 'shop', targetCollection: 'users' });
      expect(() => h.proposals.accept(gained, 'connection')).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
      expect(h.proposalRepo.findById(gained)).toMatchObject({ status: 'obsolete', decidedAt: '2026-11-27T10:00:00.000Z' });
      expect(ruleCount()).toBe(1);
      expect(() => h.proposals.accept(randomUUID(), 'connection')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    });

    it('accept works after the Connection was unshared or closed, and is refused once it is deleted', async () => {
      const id = idOf(await propose(a));
      h.connRepo.setShared(conn, false);
      h.statuses.set(conn, 'disconnected');
      expect(h.proposals.accept(id, 'connection').savedFor).toBe('connection');
      h.connRepo.setShared(conn, true);
      h.statuses.set(conn, 'connected');
      const gone = idOf(await propose(a, { sourceField: 'sellerId', targetCollection: 'sellers' }));
      h.tmp.db.prepare('DELETE FROM connections WHERE id = ?').run(conn);
      expect(() => h.proposals.accept(gone, 'connection')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
      expect(h.proposalRepo.findById(gone)!.status).toBe('expired');
    });

    it('Not now sets a pending one aside, reopen brings it back, and neither applies twice', async () => {
      const id = idOf(await propose(a));
      expect(h.proposals.later(id)).toEqual({ ok: true });
      expect(h.proposalRepo.findById(id)).toMatchObject({ status: 'later', decidedAt: null });
      expect(() => h.proposals.later(id)).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
      expect(h.proposals.reopen(id)).toEqual({ ok: true });
      expect(h.proposalRepo.findById(id)!.status).toBe('pending');
      expect(() => h.proposals.reopen(id)).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
      expect(() => h.proposals.later(randomUUID())).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
      expect(h.proposalEvents.slice(-2)).toEqual([
        { id, status: 'later' },
        { id, status: 'pending' },
      ]);
    });

    it('Never for this pair declines it, adds X26’s key to the Never list, and the pair is refused from then on', async () => {
      h.appState.set(NEVER_PAIRS_KEY, ['older']);
      const id = idOf(await propose(a));
      h.proposals.later(id);
      expect(h.proposals.decline(id)).toEqual({ ok: true });
      const key = h.proposalRepo.findById(id)!.pairKey;
      expect(h.appState.get(NEVER_PAIRS_KEY)).toEqual(['older', key]);
      expect(h.proposalRepo.findById(id)).toMatchObject({ status: 'declined', decidedAt: '2026-11-27T10:00:00.000Z' });
      expect(codeOf(await propose(a))).toBe('PROPOSAL_DECLINED');
      expect(codeOf(await propose(b))).toBe('PROPOSAL_DECLINED');
      expect(() => h.proposals.decline(id)).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
    });
  });

  describe('lifecycle', () => {
    it('expires an open Proposal 30 days after it was filed, when listed', async () => {
      const id = idOf(await propose(a));
      clock += 30 * DAY - 1;
      expect(h.proposals.list({ status: 'open', limit: 10 }).map((p) => p.id)).toEqual([id]);
      clock += 1;
      expect(h.proposals.list({ status: 'open', limit: 10 })).toEqual([]);
      expect(h.proposals.list({ status: 'decided', limit: 10 })[0]).toMatchObject({ id, status: 'expired', decidedAt: '2026-12-27T10:00:00.000Z' });
      expect(h.proposalEvents.at(-1)).toEqual({ id, status: 'expired' });
    });

    it('expires before a new call is weighed: a stale Proposal is neither joined nor counted', async () => {
      const stale = idOf(await propose(b));
      clock += 30 * DAY;
      const fresh = idOf(await propose(a));
      expect(fresh).not.toBe(stale);
      expect(h.proposalRepo.findById(stale)!.status).toBe('expired');
      expect(h.proposals.list({ status: 'open', limit: 10 })[0]!.backers.map((x) => x.tokenId)).toEqual([tokenA]);
      expect(h.proposals.list({ status: 'decided', limit: 10 })[0]!.backers.map((x) => x.tokenId)).toEqual([tokenB]);
    });

    it('makes a Proposal obsolete once a rule covers its source field, and expires one whose Connection was deleted', async () => {
      const covered = idOf(await propose(a));
      const orphan = idOf(await propose(a, { sourceField: 'sellerId', targetCollection: 'sellers' }));
      h.refs.create({ owner: { connectionId: conn }, sourceDb: 'shop', sourceCollection: 'orders', sourceField: 'customerId', targetDb: 'shop', targetCollection: 'clients' });
      expect(h.proposals.list({ limit: 10 }).find((p) => p.id === covered)!.status).toBe('obsolete');
      h.tmp.db.prepare('DELETE FROM connections WHERE id = ?').run(conn);
      expect(h.proposals.list({ limit: 10 }).find((p) => p.id === orphan)!.status).toBe('expired');
    });

    it('leaves open Proposals alone when the session ends, the Connection is unshared or Agent Access goes off', async () => {
      const id = idOf(await propose(a));
      await a.close();
      h.connRepo.setShared(conn, false);
      await h.disable();
      expect(h.proposals.list({ limit: 10 }).map((p) => [p.id, p.status])).toEqual([[id, 'pending']]);
    });
  });

  describe('list', () => {
    it('filters by status, Connection and any backer’s session, newest first, keyset-paged without gaps', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        ids.push(idOf(await propose(a, { sourceField: `f${i}` })));
        if (i % 2 === 0) clock += 1000;
      }
      await propose(b, { sourceField: 'f1' });
      h.proposals.decline(ids[4]!);
      const newestFirst = h.proposals.list({ limit: 200 }).map((p) => p.id);
      expect(new Set(newestFirst)).toEqual(new Set(ids));
      const pages: string[] = [];
      let before: { createdAt: string; id: string } | undefined;
      for (;;) {
        const page = h.proposals.list({ limit: 2, ...(before ? { before } : {}) });
        if (page.length === 0) break;
        pages.push(...page.map((p) => p.id));
        const last = page.at(-1)!;
        before = { createdAt: last.createdAt, id: last.id };
      }
      expect(pages).toEqual(newestFirst);
      expect(h.proposals.list({ status: 'decided', limit: 10 }).map((p) => p.id)).toEqual([ids[4]]);
      expect(h.proposals.list({ status: 'open', limit: 10 })).toHaveLength(4);
      expect(h.proposals.list({ sessionId: sessionOf('cursor'), limit: 10 }).map((p) => p.id)).toEqual([ids[1]]);
      expect(h.proposals.list({ connectionId: randomUUID(), limit: 10 })).toEqual([]);
      expect(h.proposals.list({ connectionId: conn, limit: 10 })).toHaveLength(5);
    });
  });

  describe('the reason at rest', () => {
    it('is sealed in its cell and opened only for the list', async () => {
      await propose(a, { reason: 'customer 4242 appears in both' });
      const cell = (h.tmp.db.prepare('SELECT reason FROM agent_proposal_backers').get() as { reason: unknown }).reason;
      expect(Buffer.isBuffer(cell)).toBe(true);
      expect((cell as Buffer).includes(Buffer.from('customer 4242'))).toBe(false);
      expect(h.proposals.list({ limit: 1 })[0]!.backers[0]!.reason).toBe('customer 4242 appears in both');
    });
  });

  describe('pruning', () => {
    it('deletes Proposals decided over 90 days ago with their backers, and never an open one', async () => {
      const decided = idOf(await propose(a));
      const kept = idOf(await propose(a, { sourceField: 'sellerId', targetCollection: 'sellers' }));
      h.proposals.decline(decided);
      h.tmp.db.prepare("UPDATE agent_proposals SET decided_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(decided);
      h.tmp.db.prepare("UPDATE agent_proposals SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(kept);
      expect(h.proposalRepo.deleteDecidedOlderThan(90)).toBe(1);
      expect(h.proposalRepo.findById(decided)).toBeNull();
      expect(h.proposalRepo.findById(kept)).not.toBeNull();
      expect((h.tmp.db.prepare('SELECT proposal_id FROM agent_proposal_backers').all() as { proposal_id: string }[]).map((r) => r.proposal_id)).toEqual([kept]);
    });
  });
});
