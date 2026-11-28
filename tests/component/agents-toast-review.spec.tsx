// X30 §10.1: a Proposal that arrives in Databases mode toasts, and its Review
// opens Agents mode on the session that proposed it, with the Proposal open.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '../helpers/render';
import { uninstallAtelierMock } from '../helpers/atelierMock';
import { agentState, liveSession, mountAgentsWorkspace, token } from '../helpers/agentsWorkspace';
import { backer, proposal } from '../helpers/agentProposalFixture';
import { resetProposalStore } from '../../src/features/agents/proposalStore';
import type { AgentProposal, AgentProposalsQuery } from '@shared/types';

afterEach(() => {
  uninstallAtelierMock();
  resetProposalStore();
  vi.restoreAllMocks();
});

describe('a Proposal toast in Databases mode', () => {
  it('Review opens the session that proposed it, with the Proposal open', async () => {
    let open: AgentProposal[] = [];
    const events = new Set<() => void>();
    const list = vi.fn(async (q: AgentProposalsQuery) => (q.before ? [] : open));
    mountAgentsWorkspace({
      state: agentState({ sessions: [liveSession({ id: 's1', tokenId: 't1' })], sessionCount: 1, tokens: [token('t1', 'laptop-claude')] }),
      overrides: {
        agentProposals: {
          list,
          onChanged: (cb: () => void) => {
            events.add(cb);
            return () => events.delete(cb);
          },
          check: async () => ({ kind: 'sampled' as const, sampled: 3, resolved: 3, sourceCollection: 'orders', sourceField: 'customerId', targetCollection: 'customers', targetField: '_id' }),
        } as never,
      },
    });
    await screen.findByRole('region', { name: 'Agent requests' });
    // The Proposals open at launch are the baseline; only one arriving after it toasts.
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(screen.queryByTestId('agent-toast-proposal')).toBeNull();

    open = [proposal({ id: 'p-new', connectionId: 'c1' })];
    await act(async () => {
      for (const cb of events) cb();
    });
    const toast = await screen.findByTestId('agent-toast-proposal');
    fireEvent.click(within(toast).getByRole('button', { name: 'Review' }));

    const page = await screen.findByTestId('agents-page-session');
    expect(await within(page).findByTestId('proposal-card')).toBeTruthy();
    expect(screen.queryByTestId('agent-toast-proposal')).toBeNull();
  });

  it('Review on one whose session was not kept opens it in Home\'s Needs you', async () => {
    let open: AgentProposal[] = [];
    const events = new Set<() => void>();
    const list = vi.fn(async (q: AgentProposalsQuery) => (q.before ? [] : open));
    mountAgentsWorkspace({
      state: agentState({ tokens: [token('t1', 'laptop-claude')] }),
      overrides: {
        agentProposals: {
          list,
          onChanged: (cb: () => void) => {
            events.add(cb);
            return () => events.delete(cb);
          },
          check: async () => ({ kind: 'not-open' as const, connectionName: 'Prod' }),
        } as never,
      },
    });
    await screen.findByRole('region', { name: 'Agent requests' });
    await waitFor(() => expect(list).toHaveBeenCalled());

    open = [proposal({ id: 'p-gone', connectionId: 'c1', backers: [backer({ sessionId: null })] })];
    await act(async () => {
      for (const cb of events) cb();
    });
    fireEvent.click(within(await screen.findByTestId('agent-toast-proposal')).getByRole('button', { name: 'Review' }));

    const row = await screen.findByTestId('needs-you-proposal');
    expect(row.dataset.proposalId).toBe('p-gone');
    expect(within(row).getByTestId('proposal-card')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Review' }).getAttribute('aria-expanded')).toBe('true');
  });
});
