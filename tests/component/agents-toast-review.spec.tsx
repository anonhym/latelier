// X30 §10.1: a Proposal that arrives in Databases mode toasts, and its Review
// opens Agents mode on the session that proposed it, with the Proposal open.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '../helpers/render';
import { uninstallAtelierMock } from '../helpers/atelierMock';
import { agentState, liveSession, mountAgentsWorkspace, token } from '../helpers/agentsWorkspace';
import { proposal } from '../helpers/agentProposalFixture';
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
          onEvent: (cb: () => void) => {
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
});
