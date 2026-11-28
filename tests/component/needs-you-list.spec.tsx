// X30 §8 and X28 §6: Needs you lists Proposals next to Connection requests;
// Later ones wait under a collapsed Later; Decline is "Never for this pair"
// and asks the app confirm first.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '../helpers/render';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { backer, proposal } from '../helpers/agentProposalFixture';
import { NEEDS_YOU_EMPTY, NeedsYouList, type NeedsYouHandlers } from '../../src/features/agents/NeedsYouList';
import { laterItems, needsYouItems } from '../../src/features/agents/needsYou';
import { resetProposalStore } from '../../src/features/agents/proposalStore';
import type { AgentProposal } from '@shared/types';

afterEach(() => {
  uninstallAtelierMock();
  resetProposalStore();
  vi.restoreAllMocks();
});

const NOW = Date.parse('2026-11-27T10:30:00.000Z');

function mount(proposals: AgentProposal[], reviewing: string | null = null) {
  const decline = vi.fn(async () => ({ ok: true as const }));
  const reopen = vi.fn(async () => ({ ok: true as const }));
  installAtelierMock({
    agentProposals: {
      decline,
      reopen,
      list: async () => [],
      check: async () => ({ kind: 'not-open' as const, connectionName: 'Shop (prod)' }),
    },
  });
  const handlers: NeedsYouHandlers = { onOpenConnection: vi.fn(), onNotNow: vi.fn(), onReview: vi.fn(), reviewsInPlace: (item) => item.proposal.id !== 'p-elsewhere' };
  render(
    <NeedsYouList
      items={needsYouItems(null, NOW, proposals, [])}
      later={laterItems(proposals, NOW, [])}
      handlers={handlers}
      reviewing={reviewing}
    />,
  );
  return { decline, reopen, handlers };
}

describe('Needs you', () => {
  it('says nothing needs you when the list is empty', () => {
    mount([]);
    expect(screen.getByTestId('needs-you').textContent).toContain(NEEDS_YOU_EMPTY);
    expect(screen.queryByTestId('needs-you-later-toggle')).toBeNull();
  });

  it('lists a pending Proposal with who proposes it and the pair', () => {
    mount([proposal({ backers: [backer(), backer({ tokenId: 't2', tokenName: 'ci' })] })]);
    const row = screen.getByTestId('needs-you-proposal');
    expect(row.textContent).toContain('laptop-claude and 1 other Agent propose');
    expect(row.textContent).toContain('orders.customerId');
    expect(row.textContent).toContain('customers._id');
  });

  it('Review hands the Proposal over, and opens the card under its row when reviewed here', () => {
    const p = proposal();
    const m = mount([p], 'p1');
    const row = screen.getByTestId('needs-you-proposal');
    const review = within(row).getByRole('button', { name: 'Review' });
    expect(review.getAttribute('aria-expanded')).toBe('true');
    expect(within(row).getByTestId('proposal-card')).toBeTruthy();
    fireEvent.click(review);
    expect(m.handlers.onReview).toHaveBeenCalledWith(expect.objectContaining({ kind: 'proposal', key: 'proposal:p1' }));
  });

  it('makes Review a disclosure only where it opens the Proposal in place', () => {
    mount([proposal({ id: 'p-here' }), proposal({ id: 'p-elsewhere', createdAt: '2026-11-27T09:00:00.000Z' })]);
    const [here, elsewhere] = screen.getAllByTestId('needs-you-proposal');
    expect(here!.dataset.proposalId).toBe('p-here');
    expect(within(here!).getByRole('button', { name: 'Review' }).getAttribute('aria-expanded')).toBe('false');
    expect(within(elsewhere!).getByRole('button', { name: 'Review' }).hasAttribute('aria-expanded')).toBe(false);
  });

  it('keeps Later Proposals under a collapsed Later, apart from the count', () => {
    mount([proposal({ id: 'p-later', status: 'later' })]);
    expect(screen.getByTestId('needs-you').textContent).toContain(NEEDS_YOU_EMPTY);
    const toggle = screen.getByTestId('needs-you-later-toggle');
    expect(toggle.textContent).toBe('Later (1)');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('needs-you-later-proposal')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('needs-you-later-proposal')).toBeTruthy();
  });

  it('opens Later by itself when the Proposal under review waits there', () => {
    mount([proposal({ id: 'p-later', status: 'later' })], 'p-later');
    expect(screen.getByTestId('needs-you-later-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(within(screen.getByTestId('needs-you-later-proposal')).getByTestId('proposal-card')).toBeTruthy();
  });

  it('Move back returns a Later Proposal to the list', async () => {
    const m = mount([proposal({ id: 'p-later', status: 'later' })]);
    fireEvent.click(screen.getByTestId('needs-you-later-toggle'));
    fireEvent.click(within(screen.getByTestId('needs-you-later-proposal')).getByRole('button', { name: 'Move back' }));
    await waitFor(() => expect(m.reopen).toHaveBeenCalledWith({ id: 'p-later' }));
  });

  it('Decline asks the app confirm first, and Cancel declines nothing', async () => {
    const m = mount([proposal()]);
    fireEvent.click(within(screen.getByTestId('needs-you-proposal')).getByRole('button', { name: 'Decline' }));
    const dialog = await screen.findByRole('dialog', { name: 'Never for this pair?' });
    expect(dialog.textContent).toContain('will not be suggested again, by reference discovery or by any Agent');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(m.decline).not.toHaveBeenCalled();

    fireEvent.click(within(screen.getByTestId('needs-you-proposal')).getByRole('button', { name: 'Decline' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Never for this pair?' })).getByRole('button', { name: 'Never for this pair' }));
    await waitFor(() => expect(m.decline).toHaveBeenCalledWith({ id: 'p1' }));
  });
});
