// X30 §8 and §10.1: Agent toasts in Databases mode — one per new Needs you
// item, never taking the focus, folding from the fourth request, and none in
// Agents mode.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '../helpers/render';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { agentState } from '../helpers/agentsWorkspace';
import { proposal } from '../helpers/agentProposalFixture';
import { AgentToastStack, type AgentToastHandlers } from '../../src/features/agents/AgentToastStack';
import { notify } from '../../src/theme/notifications';
import type { AgentAccessState, AgentConnectionRequest, AgentProposal } from '@shared/types';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const request = (over: Partial<AgentConnectionRequest> = {}): AgentConnectionRequest => ({
  sessionId: 's1',
  tokenName: 'laptop-claude',
  clientName: 'claude-code',
  folder: '~/Projects/shop-api',
  connectionId: 'c-shop',
  connectionName: 'Shop (prod)',
  firstAt: minutesAgo(3),
  lastAt: minutesAgo(2),
  count: 1,
  lastTool: 'find',
  database: 'shop',
  collection: 'orders',
  lastOutcome: 'refused',
  ...over,
});

interface Props {
  state: AgentAccessState;
  proposals?: AgentProposal[];
  proposalsLoaded?: boolean;
  agentsMode?: boolean;
}

function mount(initial: Props, opts: { later?: () => Promise<{ ok: true }> } = {}) {
  const later = vi.fn(opts.later ?? (async () => ({ ok: true as const })));
  installAtelierMock({ agentProposals: { later, list: async () => [] } });
  const handlers: AgentToastHandlers = {
    onOpenConnection: vi.fn(),
    onViewSession: vi.fn(),
    onReview: vi.fn(),
    onOpenAgents: vi.fn(),
  };
  const ui = (p: Props) => (
    <div>
      <button type="button">Run</button>
      <AgentToastStack
        state={p.state}
        proposals={p.proposals ?? []}
        proposalsLoaded={p.proposalsLoaded ?? true}
        agentsMode={p.agentsMode ?? false}
        handlers={handlers}
      />
    </div>
  );
  const view = render(ui(initial));
  return { handlers, later, update: (p: Props) => view.rerender(ui(p)) };
}

const requestCards = () => screen.queryAllByTestId('agent-toast-request');

describe('Agent toasts', () => {
  it('shows a request as a status line in a labelled region, and never takes the focus', () => {
    const m = mount({ state: agentState() });
    const run = screen.getByRole('button', { name: 'Run' });
    run.focus();
    m.update({ state: agentState({ connectionRequests: [request()] }) });
    const region = screen.getByRole('region', { name: 'Agent requests' });
    const card = within(region).getByRole('status');
    expect(card.dataset.testid).toBe('agent-toast-request');
    expect(card.textContent).toContain('laptop-claude');
    expect(card.textContent).toContain('Shop (prod)');
    expect(document.activeElement).toBe(run);
  });

  it('opens the Connection through the ordinary connect action, and the toast goes', () => {
    const m = mount({ state: agentState({ connectionRequests: [request()] }) });
    fireEvent.click(screen.getByRole('button', { name: 'Open Shop (prod)' }));
    expect(m.handlers.onOpenConnection).toHaveBeenCalledWith('c-shop');
    expect(requestCards()).toHaveLength(0);
  });

  it('views the session', () => {
    const m = mount({ state: agentState({ connectionRequests: [request()] }) });
    fireEvent.click(screen.getByRole('button', { name: 'View session' }));
    expect(m.handlers.onViewSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1', connectionId: 'c-shop' }));
    expect(requestCards()).toHaveLength(0);
  });

  it('dismissing hides the toast only: it does not come back while the request stays open', () => {
    const state = agentState({ connectionRequests: [request()] });
    const m = mount({ state });
    fireEvent.click(within(requestCards()[0]!).getByRole('button', { name: 'Dismiss' }));
    expect(requestCards()).toHaveLength(0);
    m.update({ state: agentState({ connectionRequests: [request({ count: 2, lastAt: minutesAgo(1) })] }) });
    expect(requestCards()).toHaveLength(0);
  });

  it('toasts a request again once it has left and come back', () => {
    const m = mount({ state: agentState({ connectionRequests: [request()] }) });
    fireEvent.click(within(requestCards()[0]!).getByRole('button', { name: 'Dismiss' }));
    m.update({ state: agentState({ connectionRequests: [] }) });
    m.update({ state: agentState({ connectionRequests: [request()] }) });
    expect(requestCards()).toHaveLength(1);
  });

  it('folds requests into one card from the fourth', () => {
    const three = ['a', 'b', 'c'].map((id, i) => request({ connectionId: id, connectionName: id, lastAt: minutesAgo(10 - i) }));
    const m = mount({ state: agentState({ connectionRequests: three }) });
    expect(requestCards()).toHaveLength(3);
    m.update({ state: agentState({ connectionRequests: [...three, request({ connectionId: 'd', connectionName: 'd', lastAt: minutesAgo(1) })] }) });
    expect(requestCards()).toHaveLength(0);
    const fold = screen.getByTestId('agent-toast-fold');
    expect(fold.textContent).toContain('4 Agent requests');
    fireEvent.click(within(fold).getByRole('button', { name: 'Open Agents' }));
    expect(m.handlers.onOpenAgents).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('agent-toast-fold')).toBeNull();
  });

  it('shows nothing in Agents mode, and an item seen there does not toast on the way back', () => {
    const m = mount({ state: agentState({ connectionRequests: [request()] }), agentsMode: true });
    expect(screen.getByRole('region', { name: 'Agent requests' }).children).toHaveLength(0);
    m.update({ state: agentState({ connectionRequests: [request()] }), agentsMode: false });
    expect(requestCards()).toHaveLength(0);
  });

  it('hides a toast already showing once Agents mode opens, where the item shows in the list', () => {
    const state = agentState({ connectionRequests: [request()] });
    const m = mount({ state });
    expect(requestCards()).toHaveLength(1);
    m.update({ state, agentsMode: true });
    expect(screen.getByRole('region', { name: 'Agent requests' }).children).toHaveLength(0);
  });

  it('does not toast the Proposals already open at launch, only new ones', () => {
    const old = proposal({ id: 'p-old' });
    const m = mount({ state: agentState(), proposals: [], proposalsLoaded: false });
    m.update({ state: agentState(), proposals: [old], proposalsLoaded: true });
    expect(screen.queryAllByTestId('agent-toast-proposal')).toHaveLength(0);
    m.update({ state: agentState(), proposals: [old, proposal({ id: 'p-new', createdAt: minutesAgo(1) })], proposalsLoaded: true });
    const cards = screen.getAllByTestId('agent-toast-proposal');
    expect(cards).toHaveLength(1);
    expect(cards[0]!.textContent).toContain('proposes');
  });

  it('Review hands the Proposal over, and the toast goes', async () => {
    const m = mount({ state: agentState(), proposals: [], proposalsLoaded: true });
    m.update({ state: agentState(), proposals: [proposal({ id: 'p-new' })], proposalsLoaded: true });
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(m.handlers.onReview).toHaveBeenCalledWith(expect.objectContaining({ kind: 'proposal', key: 'proposal:p-new' }));
    expect(screen.queryAllByTestId('agent-toast-proposal')).toHaveLength(0);
    await act(async () => {});
  });

  it('Later hides the toast at once, and says so when putting the Proposal off fails', async () => {
    const error = vi.spyOn(notify, 'error').mockImplementation(() => undefined as never);
    let fail!: (e: Error) => void;
    const m = mount({ state: agentState(), proposals: [], proposalsLoaded: true }, { later: () => new Promise((_, reject) => (fail = reject)) });
    m.update({ state: agentState(), proposals: [proposal({ id: 'p-new' })], proposalsLoaded: true });
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    // Gone before main answers.
    expect(screen.queryAllByTestId('agent-toast-proposal')).toHaveLength(0);
    expect(m.later).toHaveBeenCalledWith({ id: 'p-new' });
    await act(async () => fail(new Error('the Proposal was decided elsewhere')));
    await waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining('decided elsewhere')));
  });
});
