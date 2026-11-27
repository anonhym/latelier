// X30 §5.2: Open as query fills the collection's tab with the Agent's query
// and never runs it, even when the query is the tab's own default `{}`, which
// a fresh tab would otherwise run on landing.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '../helpers/render';
import { collectionTabFixture, uninstallAtelierMock, watchServerCalls } from '../helpers/atelierMock';
import { agentState, liveSession, mountAgentsWorkspace, token } from '../helpers/agentsWorkspace';
import { callRow } from '../helpers/agentProposalFixture';
import { requestAgentsPage } from '../../src/features/agents/agentsNav';
import { resetProposalStore } from '../../src/features/agents/proposalStore';
import type { AgentCallRow, CollectionTab } from '@shared/types';

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
