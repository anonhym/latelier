// X28 §7: an Agent's Proposal in the strip on the collection it is about —
// one at a time, oldest first, yielding to the user's own discovery
// suggestion, deciding through X28 §6, Escape as Not now.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '../helpers/render';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { backer, proposal } from '../helpers/agentProposalFixture';
import { AgentProposalStrip } from '../../src/features/agents/AgentProposalStrip';
import { resetProposalStore, setOpenProposals } from '../../src/features/agents/proposalStore';
import { clearSuggestion, resetReferenceDiscovery, showSuggestion } from '../../src/state/referenceDiscovery';
import type { AgentProposal, AgentProposalCheck, AgentProposalsQuery, ConnectionFamily } from '@shared/types';

afterEach(() => {
  uninstallAtelierMock();
  resetProposalStore();
  resetReferenceDiscovery();
  vi.restoreAllMocks();
});

const sampled = (resolved: number): AgentProposalCheck => ({
  kind: 'sampled',
  sampled: 3,
  resolved,
  sourceCollection: 'orders',
  sourceField: 'customerId',
  targetCollection: 'customers',
  targetField: '_id',
});

/**
 * The strip under a parent with its own key spy. Main's store is a mutable
 * list: each decision changes it, and the strip reads it back as main would.
 */
function mount(initial: AgentProposal[], opts: { check?: AgentProposalCheck; families?: ConnectionFamily[]; acceptGate?: Promise<void> } = {}) {
  let open = [...initial];
  const drop = (id: string) => {
    open = open.filter((p) => p.id !== id);
  };
  const accept = vi.fn(async ({ id }: { id: string }) => {
    await opts.acceptGate;
    drop(id);
    return { ruleId: 'r1', savedFor: 'connection' as const };
  });
  const later = vi.fn(async ({ id }: { id: string }) => (drop(id), { ok: true as const }));
  const decline = vi.fn(async ({ id }: { id: string }) => (drop(id), { ok: true as const }));
  installAtelierMock({
    agentProposals: {
      list: async (q: AgentProposalsQuery) => (q.before ? [] : open),
      check: async () => opts.check ?? sampled(3),
      accept: accept as never,
      later,
      decline,
    },
    families: { list: async () => opts.families ?? [] },
  });
  setOpenProposals(open);
  const onParentKeyDown = vi.fn();
  render(
    <div onKeyDown={onParentKeyDown}>
      <AgentProposalStrip tabId="t1" connectionId="c-shop" dbName="shop" collection="orders" />
    </div>,
  );
  return { accept, later, decline, onParentKeyDown };
}

const strip = () => screen.queryByTestId('agent-proposal-strip');
const inStrip = (name: string) => within(strip()!).getByRole('button', { name });

describe('the Agent proposal strip', () => {
  it('says who proposes which pair, their words as text, and the check', async () => {
    mount([proposal({ backers: [backer({ reason: 'See <b>this</b>\nhttps://evil.example/x' })] })]);
    const s = screen.getByRole('region', { name: 'Agent proposal' });
    expect(s.textContent).toContain('laptop-claude proposes a Reference Rule: orders.customerId → customers._id');
    const reason = within(s).getByTestId('proposal-reason');
    expect(reason.querySelector('b, a')).toBeNull();
    expect(reason.textContent).toContain('See <b>this</b>\nhttps://evil.example/x');
    await waitFor(() => expect(within(s).getByTestId('proposal-check').textContent).toBe('3 of 3 sampled documents in orders resolve'));
    expect(inStrip('Add Reference Rule')).toBeTruthy();
  });

  it('shows only a pending Proposal from this collection, on this Connection', () => {
    mount([
      proposal({ id: 'p-other-coll', sourceCollection: 'invoices' }),
      proposal({ id: 'p-other-conn', connectionId: 'c-other' }),
      proposal({ id: 'p-later', status: 'later' }),
    ]);
    expect(strip()).toBeNull();
  });

  it('shows several one at a time, oldest first, and the next after Not now', async () => {
    const m = mount([
      proposal({ id: 'p-new', createdAt: '2026-11-27T11:00:00.000Z', sourceField: 'sellerId' }),
      proposal({ id: 'p-old', createdAt: '2026-11-27T09:00:00.000Z' }),
    ]);
    expect(strip()!.dataset.proposalId).toBe('p-old');
    fireEvent.click(inStrip('Not now'));
    await waitFor(() => expect(m.later).toHaveBeenCalledWith({ id: 'p-old' }));
    await waitFor(() => expect(strip()!.dataset.proposalId).toBe('p-new'));
  });

  it('adds the Reference Rule for this Connection only, and goes', async () => {
    const m = mount([proposal()]);
    await waitFor(() => expect(within(strip()!).getByTestId('proposal-check').dataset.tone).toBe('ok'));
    fireEvent.click(inStrip('Add Reference Rule'));
    await waitFor(() => expect(m.accept).toHaveBeenCalledWith({ id: 'p1', savedFor: 'connection' }));
    await waitFor(() => expect(strip()).toBeNull());
  });

  it('reads Add anyway when no sampled document resolved, and never disables it', async () => {
    const m = mount([proposal()], { check: sampled(0) });
    await waitFor(() => expect(within(strip()!).getByTestId('proposal-check').dataset.tone).toBe('warn'));
    const add = inStrip('Add anyway') as HTMLButtonElement;
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    await waitFor(() => expect(m.accept).toHaveBeenCalledWith({ id: 'p1', savedFor: 'connection' }));
  });

  it('offers Save for the Family on a Family member', async () => {
    const m = mount([proposal()], { families: [{ id: 'f1', name: 'Shop', memberIds: ['c-shop'] } as ConnectionFamily] });
    fireEvent.click(await within(strip()!).findByRole('button', { name: 'Save for the Family' }));
    await waitFor(() => expect(m.accept).toHaveBeenCalledWith({ id: 'p1', savedFor: 'family' }));
  });

  it('asks the app confirm before Never for this pair', async () => {
    const m = mount([proposal()]);
    fireEvent.click(inStrip('Never for this pair'));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Never for this pair?' })).getByRole('button', { name: 'Never for this pair' }));
    await waitFor(() => expect(m.decline).toHaveBeenCalledWith({ id: 'p1' }));
    await waitFor(() => expect(strip()).toBeNull());
  });

  it('yields the strip to a discovery suggestion, and comes back when it is free', () => {
    mount([proposal()]);
    expect(strip()).not.toBeNull();
    act(() =>
      showSuggestion('t1', {
        pair: { source: { dbName: 'shop', collection: 'orders', field: 'sku' }, target: { dbName: 'shop', collection: 'items', field: '_id' } },
        key: 'k',
        seq: 1,
        connectionId: 'c-shop',
        family: null,
      }),
    );
    expect(strip()).toBeNull();
    act(() => clearSuggestion('t1'));
    expect(strip()).not.toBeNull();
  });

  it('Escape acts as Not now and goes no further', async () => {
    const m = mount([proposal()]);
    fireEvent.keyDown(inStrip('Add Reference Rule'), { key: 'Escape' });
    await waitFor(() => expect(m.later).toHaveBeenCalledWith({ id: 'p1' }));
    expect(m.onParentKeyDown).not.toHaveBeenCalled();
    expect(m.accept).not.toHaveBeenCalled();
  });

  it('holds Escape and the other decisions while an Add is in flight', async () => {
    let release!: () => void;
    const m = mount([proposal()], { acceptGate: new Promise<void>((r) => (release = r)) });
    fireEvent.click(inStrip('Add Reference Rule'));
    await waitFor(() => expect(m.accept).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(inStrip('Not now'), { key: 'Escape' });
    expect((inStrip('Not now') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(inStrip('Never for this pair'));
    await act(async () => {});
    expect(m.later).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => release());
    await waitFor(() => expect(strip()).toBeNull());
    expect(m.later).not.toHaveBeenCalled();
    expect(m.decline).not.toHaveBeenCalled();
  });
});
