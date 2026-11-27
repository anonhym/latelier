import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createRouter } from '../../electron/ipc/router';
import { registerAgentProposalsChannels } from '../../electron/ipc/handlers/agentProposals';
import { IPC_CHANNELS, type Envelope } from '../../shared/ipc';
import type { AgentProposal, AgentProposalCheck } from '../../shared/types';
import { createAgentHarness, type AgentHarness } from '../helpers/agentHarness';
import { createIpcShim } from '../helpers/ipcShim';

/** X28 §8 through the router: validation, the stored pair, and errors as codes. */
describe('agentProposals:* channels', () => {
  let h: AgentHarness;
  let shim: ReturnType<typeof createIpcShim>;
  let conn: string;
  let tokenId: string;

  beforeEach(() => {
    h = createAgentHarness();
    shim = createIpcShim();
    registerAgentProposalsChannels(createRouter(shim.ipcMain, () => true), h.proposals);
    conn = randomUUID();
    h.addConnection(conn, 'prod', { shared: true, status: 'connected' });
    tokenId = h.svc.addToken('laptop-claude').info.id;
  });

  afterEach(async () => {
    await h.cleanup();
  });

  const invoke = <T>(channel: string, payload?: unknown): Promise<Envelope<T>> => shim.invoke<T>(channel, payload);
  async function ok<T>(channel: string, payload?: unknown): Promise<T> {
    const env = await invoke<T>(channel, payload);
    if (!env.ok) throw new Error(`${channel} failed: ${env.error.code} ${env.error.message}`);
    return env.data;
  }
  async function code(channel: string, payload?: unknown): Promise<string> {
    const env = await invoke(channel, payload);
    if (env.ok) throw new Error(`${channel} succeeded`);
    return env.error.code;
  }
  const file = (sourceField = 'customerId') =>
    h.proposals.propose(
      { sessionId: randomUUID(), tokenId, tokenName: 'laptop-claude', clientName: 'claude-code' },
      {
        connectionId: conn,
        sourceDb: 'shop',
        sourceCollection: 'orders',
        sourceField,
        targetDb: 'shop',
        targetCollection: 'customers',
        targetField: '_id',
        reason: 'ids match',
      },
    ).id;

  describe('validation', () => {
    it.each([
      IPC_CHANNELS.agentProposalsCheck,
      IPC_CHANNELS.agentProposalsLater,
      IPC_CHANNELS.agentProposalsReopen,
      IPC_CHANNELS.agentProposalsDecline,
    ])('%s takes exactly a Proposal uuid', async (channel) => {
      for (const bad of [undefined, {}, { id: 'p1' }, { id: randomUUID(), more: 1 }]) expect(await code(channel, bad)).toBe('VALIDATION');
      expect(await code(channel, { id: randomUUID() })).toBe('NOT_FOUND');
    });

    it('accept takes a Proposal uuid and who to save the rule for, and no pair', async () => {
      const id = file();
      for (const bad of [
        { id },
        { id, savedFor: 'everyone' },
        { id: 'p1', savedFor: 'connection' },
        { id, savedFor: 'connection', sourceField: 'other' },
      ]) {
        expect(await code(IPC_CHANNELS.agentProposalsAccept, bad)).toBe('VALIDATION');
      }
    });

    it('list needs a limit of 1 to 200 and refuses anything it does not know', async () => {
      for (const bad of [
        {},
        { limit: 0 },
        { limit: 201 },
        { limit: 1.5 },
        { limit: 10, status: 'all' },
        { limit: 10, connectionId: 'prod' },
        { limit: 10, sessionId: 'x' },
        { limit: 10, before: { createdAt: 'x'.repeat(65), id: randomUUID() } },
        { limit: 10, before: { createdAt: '2026', id: 'p' } },
        { limit: 10, tokenId },
      ]) {
        expect(await code(IPC_CHANNELS.agentProposalsList, bad)).toBe('VALIDATION');
      }
      expect(await ok<AgentProposal[]>(IPC_CHANNELS.agentProposalsList, { limit: 200 })).toEqual([]);
    });
  });

  it('lists, sets aside, reopens and accepts through the router, with the stored pair', async () => {
    const id = file();
    const [listed] = await ok<AgentProposal[]>(IPC_CHANNELS.agentProposalsList, { status: 'open', limit: 10 });
    expect(listed).toMatchObject({ id, status: 'pending', backers: [{ tokenName: 'laptop-claude', reason: 'ids match' }] });
    expect(await ok(IPC_CHANNELS.agentProposalsLater, { id })).toEqual({ ok: true });
    expect(await ok(IPC_CHANNELS.agentProposalsReopen, { id })).toEqual({ ok: true });
    const accepted = await ok<{ ruleId: string; savedFor: string }>(IPC_CHANNELS.agentProposalsAccept, { id, savedFor: 'connection' });
    expect(h.refs.get(accepted.ruleId)).toMatchObject({ owner: { connectionId: conn }, sourceField: 'customerId', targetCollection: 'customers' });
    expect(await code(IPC_CHANNELS.agentProposalsAccept, { id, savedFor: 'connection' })).toBe('CONFLICT');
    expect(await code(IPC_CHANNELS.agentProposalsDecline, { id })).toBe('CONFLICT');
  });

  it('declines through the router and refuses Family for a Connection in none', async () => {
    const id = file();
    expect(await code(IPC_CHANNELS.agentProposalsAccept, { id, savedFor: 'family' })).toBe('VALIDATION');
    expect(await ok(IPC_CHANNELS.agentProposalsDecline, { id })).toEqual({ ok: true });
    expect(h.proposalRepo.findById(id)!.status).toBe('declined');
  });

  it('check answers not-open for a closed Connection', async () => {
    const id = file();
    h.statuses.set(conn, 'disconnected');
    expect(await ok<AgentProposalCheck>(IPC_CHANNELS.agentProposalsCheck, { id })).toEqual({ kind: 'not-open', connectionName: 'prod' });
  });
});
