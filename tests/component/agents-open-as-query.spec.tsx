// X30 §5.2: Open as query fills the collection's tab with the Agent's query
// and never runs it, even when the query is the tab's own default `{}`, which
// a fresh tab would otherwise run on landing.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '../helpers/render';
import { collectionTabFixture, connectionFixture, uninstallAtelierMock, watchServerCalls } from '../helpers/atelierMock';
import { agentState, liveSession, mountAgentsWorkspace, token } from '../helpers/agentsWorkspace';
import { callRow } from '../helpers/agentProposalFixture';
import { requestAgentsPage } from '../../src/features/agents/agentsNav';
import { resetProposalStore } from '../../src/features/agents/proposalStore';
import type { AgentCallRow, CollectionTab, CollectionTabState, ConnectionRuntime } from '@shared/types';

afterEach(() => {
  uninstallAtelierMock();
  resetProposalStore();
  vi.restoreAllMocks();
});

async function openAsQuery(call: AgentCallRow) {
  const USERS = collectionTabFixture({ id: 't-users', dbName: 'shop', collection: 'users', position: 0, isActive: true });
  const ORDERS = collectionTabFixture({ id: 't-orders', dbName: 'shop', collection: 'orders', position: 1 });
  // As main does: the tab opened, or reused, is the active one from then on.
  const openCollection = vi.fn(async (): Promise<CollectionTab> => {
    USERS.isActive = false;
    ORDERS.isActive = true;
    return ORDERS;
  });
  const ws = mountAgentsWorkspace({
    tabs: [USERS, ORDERS],
    state: agentState({ sessions: [liveSession({ id: 's1', tokenId: 't-a' })], tokens: [token('t-a', 'laptop-claude')] }),
    overrides: {
      tabs: { openCollection, setActive: async (id: string) => ({ id }) },
      agentAccess: { listCalls: async (q) => (q.before ? [] : [call]) },
    },
  });
  await screen.findByRole('tab', { name: /users/ });
  act(() => requestAgentsPage({ kind: 'session', sessionId: 's1', tokenId: 't-a' }));
  const row = await screen.findByTestId('activity-row');
  fireEvent.click(within(row).getAllByRole('button')[0]!);
  const server = watchServerCalls(ws.api);
  fireEvent.click(within(row).getByRole('button', { name: 'Open as query' }));
  await waitFor(() => expect(openCollection).toHaveBeenCalledWith(expect.objectContaining({ dbName: 'shop', collection: 'orders', reuseExisting: true })));
  return { server, openCollection };
}

describe('Open as query', () => {
  it('fills the tab with the filter, sort and projection, and runs nothing', async () => {
    const { server } = await openAsQuery(
      callRow({
        connectionId: 'c1',
        request: JSON.stringify({ connectionId: 'c1', database: 'shop', collection: 'orders', filter: { status: 'shipped' }, sort: { at: -1 } }),
      }),
    );
    await waitFor(() => expect((document.getElementById('query-bar-filter') as HTMLTextAreaElement | null)?.value).toBe('{"status":"shipped"}'));
    expect(screen.getByRole('tab', { name: /orders/, selected: true })).toBeTruthy();
    // Long enough for an auto-run to have fired.
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    expect(server.calls.filter((c) => c.startsWith('query.'))).toEqual([]);
  });

  it('runs nothing for an empty filter either, which a fresh tab would run on landing', async () => {
    const { server } = await openAsQuery(
      callRow({ connectionId: 'c1', tool: 'count', request: JSON.stringify({ connectionId: 'c1', database: 'shop', collection: 'orders' }) }),
    );
    await waitFor(() => expect(screen.getByRole('tab', { name: /orders/, selected: true })).toBeTruthy());
    expect((document.getElementById('query-bar-filter') as HTMLTextAreaElement | null)?.value).toBe('{}');
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    expect(server.calls.filter((c) => c.startsWith('query.'))).toEqual([]);
  });
});

describe('Open as query into the launch-restored tab', () => {
  it('does not run the Agent\'s filter when the tab\'s closed Connection connects later', async () => {
    // The tab in front at launch, on a Connection that is not open: the restore waits to run it.
    const ORDERS = collectionTabFixture({ id: 't-orders', dbName: 'shop', collection: 'orders', position: 0, isActive: true });
    const status = new Set<(e: ConnectionRuntime) => void>();
    const ws = mountAgentsWorkspace({
      tabs: [ORDERS],
      connections: [connectionFixture({ id: 'c1', status: 'disconnected' })],
      state: agentState({ sessions: [liveSession({ id: 's1', tokenId: 't-a' })], tokens: [token('t-a', 'laptop-claude')] }),
      overrides: {
        tabs: { openCollection: async (): Promise<CollectionTab> => ORDERS, setActive: async (id: string) => ({ id }) },
        mongo: {
          connect: async (id: string) => ({ id, status: 'disconnected' }),
          onStatus: (cb: (e: ConnectionRuntime) => void) => {
            status.add(cb);
            return () => status.delete(cb);
          },
        } as never,
        agentAccess: {
          listCalls: async (q) =>
            q.before
              ? []
              : [callRow({ connectionId: 'c1', request: JSON.stringify({ connectionId: 'c1', database: 'shop', collection: 'orders', filter: { status: 'shipped' } }) })],
        },
      },
    });
    await screen.findByRole('tab', { name: /orders/ });
    const server = watchServerCalls(ws.api);
    act(() => requestAgentsPage({ kind: 'session', sessionId: 's1', tokenId: 't-a' }));
    const row = await screen.findByTestId('activity-row');
    fireEvent.click(within(row).getAllByRole('button')[0]!);
    fireEvent.click(within(row).getByRole('button', { name: 'Open as query' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: /orders/, selected: true })).toBeTruthy());
    await act(async () => new Promise((r) => setTimeout(r, 20)));

    // The user connects it later; the restore must not take the Agent's query for the user's own.
    act(() => {
      for (const cb of status) cb({ id: 'c1', status: 'connected' } as ConnectionRuntime);
    });
    await waitFor(() => expect((document.getElementById('query-bar-filter') as HTMLTextAreaElement | null)?.value).toBe('{"status":"shipped"}'));
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    expect(server.calls.filter((c) => c.startsWith('query.'))).toEqual([]);
  });
});

describe('an Agent-seeded tab across a relaunch', () => {
  const SEEDED: CollectionTabState = {
    view: 'Tree',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{"status":"shipped"}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    agentSeeded: true,
  };

  /**
   * A launch with the orders tab restored in front, on an open Connection.
   * `stored` is the tab's persisted state; each `tabs.update` merges into it
   * through JSON, as main writes `state_json`, so a cleared field is gone.
   */
  function launch(stored: { state: CollectionTabState }) {
    const ORDERS = collectionTabFixture({ id: 't-orders', dbName: 'shop', collection: 'orders', isActive: true, state: stored.state });
    const ws = mountAgentsWorkspace({
      tabs: [ORDERS],
      overrides: {
        tabs: {
          update: async (_id: string, patch: { state: Partial<CollectionTabState> }) => {
            stored.state = JSON.parse(JSON.stringify({ ...stored.state, ...patch.state })) as CollectionTabState;
            return { ...ORDERS, state: stored.state };
          },
        } as never,
      },
    });
    return watchServerCalls(ws.api);
  }
  const finds = (server: { calls: string[] }) => server.calls.filter((c) => c === 'query.find');

  it('does not run on launch, and after the user runs it once, a later launch restores as normal', async () => {
    const stored = { state: SEEDED };
    let server = launch(stored);
    await waitFor(() => expect((document.getElementById('query-bar-filter') as HTMLTextAreaElement | null)?.value).toBe('{"status":"shipped"}'));
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    expect(server.calls.filter((c) => c.startsWith('query.'))).toEqual([]);

    // The user's Run: it runs, and the mark is gone from the stored state.
    fireEvent.click(screen.getByTestId('query-run-btn'));
    await waitFor(() => expect(finds(server)).toHaveLength(1));
    await waitFor(() => expect('agentSeeded' in stored.state).toBe(false), { timeout: 2000 });
    expect(stored.state.queryRaw).toBe('{"status":"shipped"}');

    // Relaunch: the restore runs the user's query in front, as for any tab.
    cleanup();
    uninstallAtelierMock();
    server = launch(stored);
    await waitFor(() => expect(finds(server)).toHaveLength(1));
  });
});
