// Agents Home (X30 §5.1, §8): the status line, the checklist ticked from real
// state, Needs you, and the Connections table with its Shared switch.
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '../helpers/render';
import { connectionFixture, installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { agentState, liveSession } from '../helpers/agentsWorkspace';
import { AgentsHome } from '../../src/features/agents/AgentsHome';
import { useConnectionActivity } from '../../src/features/agents/useConnectionActivity';
import { NEEDS_YOU_EMPTY } from '../../src/features/agents/NeedsYouList';
import { resetProposalStore, setOpenProposals } from '../../src/features/agents/proposalStore';
import { backer, proposal } from '../helpers/agentProposalFixture';
import type { IpcApi } from '@shared/ipc';
import type { AgentAccessState, AgentCallSummary, AgentConnectionRequest, AgentSessionRow, ConnectionSummary } from '@shared/types';

afterEach(() => {
  uninstallAtelierMock();
  resetProposalStore();
  vi.restoreAllMocks();
});

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const CONNECTIONS: ConnectionSummary[] = [
  connectionFixture({ id: 'c-arch', name: 'Archive 2023', status: 'disconnected', shareWithAgents: false }),
  connectionFixture({ id: 'c-shop', name: 'Shop (prod)', status: 'disconnected', shareWithAgents: true }),
  connectionFixture({ id: 'c-local', name: 'Local dev', status: 'connected', shareWithAgents: true }),
  connectionFixture({ id: 'c-rep', name: 'Reports replica', status: 'connected', shareWithAgents: false }),
];

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

const call = (over: Partial<AgentCallSummary>): AgentCallSummary => ({
  id: 'k1',
  sessionId: 's1',
  ts: minutesAgo(1),
  tokenId: 't1',
  tokenName: 'laptop-claude',
  clientName: 'claude-code',
  clientVersion: '2',
  connectionId: 'c-local',
  connectionName: 'Local dev',
  database: 'shop',
  collection: 'orders',
  tool: 'find',
  docCount: 1,
  bytes: 10,
  durationMs: 3,
  outcome: 'ok',
  truncated: false,
  ...over,
});

/** Home as the Workspace draws it: the activity is read above it, for the run. */
function HomeWithActivity(props: Omit<React.ComponentProps<typeof AgentsHome>, 'activity'>) {
  const activity = useConnectionActivity(
    React.useMemo(() => props.connections.map((c) => c.id), [props.connections]),
    true,
  );
  return <AgentsHome {...props} activity={activity} />;
}

function mount(
  opts: {
    state?: AgentAccessState;
    connections?: ConnectionSummary[];
    stored?: AgentSessionRow[];
    calls?: AgentCallSummary[];
    agentAccess?: Partial<IpcApi['agentAccess']>;
  } = {},
) {
  const callListeners = new Set<(row: AgentCallSummary) => void>();
  const listCalls = vi.fn(async (q: { connectionId?: string; before?: unknown }) =>
    q.before ? [] : (opts.calls ?? []).filter((c) => c.connectionId === q.connectionId),
  );
  const api = installAtelierMock({
    agentAccess: {
      listSessions: async () => opts.stored ?? [],
      listCalls: listCalls as never,
      onCall: (cb) => {
        callListeners.add(cb);
        return () => callListeners.delete(cb);
      },
      ...opts.agentAccess,
    },
  });
  const onNavigate = vi.fn();
  const openConnection = vi.fn();
  const props = { connections: opts.connections ?? CONNECTIONS, onNavigate, openConnection };
  const view = render(<HomeWithActivity state={opts.state ?? agentState()} {...props} />);
  return {
    api,
    onNavigate,
    openConnection,
    listCalls,
    rerender: (state: AgentAccessState) => view.rerender(<HomeWithActivity state={state} {...props} />),
    pushCall: (row: AgentCallSummary) => act(() => callListeners.forEach((cb) => cb(row))),
  };
}

const row = (name: string) =>
  screen.getAllByTestId('agents-connection-row').find((r) => r.querySelector(`[title="${name}"]`))!;
const step = (id: string) => screen.getByTestId(`agents-setup-${id}`);

describe('Agents Home', () => {
  it('reads the status line from the state', () => {
    mount({ state: agentState({ enabled: false }) });
    expect(screen.getByTestId('agents-status-line').textContent).toBe('Agent Access is off');
    uninstallAtelierMock();
    document.body.textContent = '';
    mount({ state: agentState({ sessions: [liveSession({ id: 'a' }), liveSession({ id: 'b', tokenId: 't2' })] }) });
    expect(screen.getByTestId('agents-status-line').textContent).toBe('Agent Access is on · 2 live sessions from 2 Agents');
  });

  describe('the setup checklist', () => {
    it('ticks each step from real state, and its buttons act', async () => {
      const requestEnable = vi.fn(async () => ({ enabled: true }));
      const { onNavigate } = mount({
        state: agentState({ enabled: false }),
        connections: CONNECTIONS.map((c) => ({ ...c, shareWithAgents: false })),
        agentAccess: { requestEnable },
      });
      expect(step('enable').dataset.done).toBeUndefined();
      expect(step('share').dataset.done).toBeUndefined();
      expect(step('connect').dataset.done).toBeUndefined();
      fireEvent.click(within(step('enable')).getByRole('button', { name: 'Turn on Agent Access' }));
      expect(requestEnable).toHaveBeenCalled();
      fireEvent.click(within(step('connect')).getByRole('button', { name: 'Connect an Agent' }));
      expect(onNavigate).toHaveBeenCalledWith({ kind: 'connect' });
    });

    it('ticks the last step from a stored session, and is gone while all three are true', async () => {
      mount({ stored: [{ id: 'x' } as AgentSessionRow] });
      await waitFor(() => expect(screen.queryByTestId('agents-setup')).toBeNull());
    });

    it('comes back with the other steps ticked when Agent Access is turned off', async () => {
      const { rerender } = mount({ state: agentState({ sessions: [liveSession()] }) });
      expect(screen.queryByTestId('agents-setup')).toBeNull();
      rerender(agentState({ enabled: false, sessions: [liveSession()] }));
      expect(step('enable').dataset.done).toBeUndefined();
      expect(step('share').dataset.done).toBe('true');
      expect(step('connect').dataset.done).toBe('true');
    });

    it('stays while no session was ever recorded', async () => {
      const listSessions = vi.fn(async () => []);
      mount({ agentAccess: { listSessions } });
      await waitFor(() => expect(listSessions).toHaveBeenCalledWith({ includeEnded: true, limit: 1 }));
      expect(step('connect').dataset.done).toBeUndefined();
      expect(step('enable').dataset.done).toBe('true');
    });
  });

  describe('the Connections table', () => {
    it('lists every saved Connection, shared first then by name, with its status', () => {
      mount();
      const rows = screen.getAllByTestId('agents-connection-row');
      expect(rows.map((r) => r.dataset.connectionId)).toEqual(['c-local', 'c-shop', 'c-arch', 'c-rep']);
      expect(within(row('Local dev')).getByText('Open · reachable')).toBeTruthy();
      expect(within(row('Shop (prod)')).getByText('Not open')).toBeTruthy();
      expect(within(row('Archive 2023')).getByText('Closed · not shared')).toBeTruthy();
      expect(within(row('Reports replica')).getByText('Open · not shared')).toBeTruthy();
      expect(screen.getByText('An Agent sees a Connection only while it is shared and open.')).toBeTruthy();
    });

    it("shows a shared Connection's privilege as a pill", () => {
      mount({ state: agentState({ privilege: { 'c-local': { kind: 'beyond-read', roles: ['readWrite'] } } }) });
      expect(within(row('Local dev')).getByText('can write')).toBeTruthy();
    });

    it('shares through set-shared and stops sharing at once; a closed unshared one cannot be switched on', async () => {
      const setShared = vi.fn(async ({ shared }: { shared: boolean }) => ({ shared }));
      mount({ agentAccess: { setShared } });
      fireEvent.click(screen.getByRole('switch', { name: 'Share Reports replica with Agents' }));
      await waitFor(() => expect(setShared).toHaveBeenCalledWith({ connectionId: 'c-rep', shared: true }));
      fireEvent.click(screen.getByRole('switch', { name: 'Share Local dev with Agents' }));
      await waitFor(() => expect(setShared).toHaveBeenCalledWith({ connectionId: 'c-local', shared: false }));
      expect((screen.getByRole('switch', { name: 'Share Archive 2023 with Agents' }) as HTMLInputElement).disabled).toBe(true);
    });

    it('tints a requested Connection, names who asked, and Open uses the connect action', () => {
      const { openConnection } = mount({ state: agentState({ connectionRequests: [request()] }) });
      const shop = row('Shop (prod)');
      expect(shop.dataset.requested).toBe('true');
      expect(shop.style.background).not.toBe('');
      expect(within(shop).getByText('Asked for by laptop-claude')).toBeTruthy();
      expect(row('Local dev').dataset.requested).toBeUndefined();
      fireEvent.click(within(shop).getByRole('button', { name: 'Open Shop (prod)' }));
      expect(openConnection).toHaveBeenCalledWith('c-shop');
      expect(within(row('Archive 2023')).queryByRole('button', { name: /^Open/ })).toBeNull();
    });

    it('derives Used now by and Last Agent call from the log, and follows new calls', async () => {
      const state = agentState({ sessions: [liveSession({ id: 's1', tokenName: 'laptop-claude' })] });
      const { pushCall, listCalls } = mount({
        state,
        calls: [call({ connectionId: 'c-local', sessionId: 's1', ts: minutesAgo(1) }), call({ id: 'k2', connectionId: 'c-shop', sessionId: 'gone', outcome: 'NOT_OPEN', ts: minutesAgo(2) })],
      });
      await waitFor(() => expect(within(row('Local dev')).getByText('1 session · laptop-claude')).toBeTruthy());
      expect(within(row('Local dev')).getByText('1m ago')).toBeTruthy();
      expect(within(row('Shop (prod)')).getByText('refused · 2m ago')).toBeTruthy();
      expect(within(row('Archive 2023')).getByText('never')).toBeTruthy();
      expect(listCalls).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'c-rep', outcome: 'all' }));
      pushCall(call({ id: 'k3', connectionId: 'c-rep', sessionId: 's1', ts: new Date().toISOString() }));
      await waitFor(() => expect(within(row('Reports replica')).getByText('just now')).toBeTruthy());
      expect(within(row('Reports replica')).getByText('1 session · laptop-claude')).toBeTruthy();
    });

    it('reads past a short page while calls are still inside the window', async () => {
      const tsA = minutesAgo(1);
      const pages = [
        [call({ id: 'a', ts: tsA })],
        [call({ id: 'b', ts: minutesAgo(2), sessionId: 's2' })],
        [],
      ];
      const listCalls = vi.fn(async (q: { connectionId?: string }) => (q.connectionId === 'c-local' ? (pages.shift() ?? []) : []));
      mount({
        state: agentState({
          sessions: [liveSession({ id: 's1', tokenName: 'laptop-claude' }), liveSession({ id: 's2', tokenId: 't2', tokenName: 'cursor-work' })],
        }),
        agentAccess: { listCalls: listCalls as never },
      });
      await waitFor(() => expect(within(row('Local dev')).getByText('2 sessions · cursor-work, laptop-claude')).toBeTruthy());
      expect(listCalls).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'c-local', before: { ts: tsA, id: 'a' } }));
    });
  });

  describe('Needs you', () => {
    it('says so when nothing needs you', () => {
      mount();
      expect(within(screen.getByTestId('needs-you')).getByText(NEEDS_YOU_EMPTY)).toBeTruthy();
    });

    it('lists requests newest first, with Open and Not now', async () => {
      const dismissRequest = vi.fn(async () => ({ ok: true as const }));
      const { openConnection } = mount({
        state: agentState({
          connectionRequests: [
            request({ sessionId: 's-old', lastAt: minutesAgo(9) }),
            request({ sessionId: 's-new', lastAt: minutesAgo(1), lastOutcome: 'waiting', connectionId: 'c-local', connectionName: 'Local dev' }),
          ],
        }),
        agentAccess: { dismissRequest },
      });
      const items = screen.getAllByTestId('needs-you-request');
      expect(items[0]!.textContent).toContain(
        'laptop-claude asked for Local dev. It is shared, but not open, so the call is waiting for you; then accept in claude-code to continue.',
      );
      expect(items[1]!.textContent).toContain('laptop-claude asked for Shop (prod). It is shared, but not open, so the call was refused.');
      expect(items[1]!.textContent).toContain('claude-code · ~/Projects/shop-api · 9m ago · find on shop.orders');
      fireEvent.click(within(items[1]!).getByRole('button', { name: 'Open Shop (prod)' }));
      expect(openConnection).toHaveBeenCalledWith('c-shop');
      fireEvent.click(within(items[0]!).getByRole('button', { name: 'Not now' }));
      await waitFor(() => expect(dismissRequest).toHaveBeenCalledWith({ sessionId: 's-new', connectionId: 'c-local' }));
    });

    it('renders Agent-supplied names as text', () => {
      mount({ state: agentState({ connectionRequests: [request({ tokenName: '<img src=x onerror=alert(1)>', folder: '<script>1</script>' })] }) });
      const container = document.body;
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('script')).toBeNull();
      expect(screen.getByTestId('needs-you-request').textContent).toContain('<img src=x onerror=alert(1)>');
    });
  });
});

describe('Home: a Proposal in Needs you', () => {
  it('Review goes to the session page for a kept session, and opens in place, as a disclosure, for one not kept', () => {
    const m = mount({ state: agentState({ sessions: [liveSession({ id: 's1', tokenId: 't1' })] }) });
    act(() =>
      setOpenProposals([
        proposal({ id: 'p-kept', backers: [backer({ sessionId: 's1' })] }),
        proposal({ id: 'p-gone', createdAt: '2026-11-27T09:00:00.000Z', backers: [backer({ sessionId: null })] }),
      ]),
    );
    const [kept, gone] = screen.getAllByTestId('needs-you-proposal');
    expect(kept!.dataset.proposalId).toBe('p-kept');
    const keptReview = within(kept!).getByRole('button', { name: 'Review' });
    expect(keptReview.hasAttribute('aria-expanded')).toBe(false);
    fireEvent.click(keptReview);
    expect(m.onNavigate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'session', sessionId: 's1', proposalId: 'p-kept' }));

    const goneReview = within(gone!).getByRole('button', { name: 'Review' });
    expect(goneReview.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(goneReview);
    expect(goneReview.getAttribute('aria-expanded')).toBe('true');
    expect(within(gone!).getByTestId('proposal-card')).toBeTruthy();
  });
});
