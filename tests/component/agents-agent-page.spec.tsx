// X30 §5.3 and §5.1: an Agent's page (its sessions paged with Show more, and
// its menu), and All activity with its filters.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '../helpers/render';
import { connectionFixture, installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { agentState, liveSession, token } from '../helpers/agentsWorkspace';
import { AgentPage } from '../../src/features/agents/AgentPage';
import { AllActivityPage } from '../../src/features/agents/AllActivityPage';
import type { AgentsPage } from '../../src/features/agents/agentsPage';
import type { AgentCallsQuery, AgentSessionRow, AgentSessionsQuery } from '@shared/types';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

const at = (m: number) => new Date(Date.UTC(2026, 10, 27, 10, 0) - m * 60_000).toISOString();

const row = (id: string, startedMinAgo: number, over: Partial<AgentSessionRow> = {}): AgentSessionRow => ({
  id,
  tokenId: 't1',
  tokenName: 'laptop-claude',
  clientName: 'claude-code',
  clientVersion: '2',
  folder: '~/Projects/shop-api',
  startedAt: at(startedMinAgo),
  endedAt: at(startedMinAgo - 5),
  endReason: 'client-closed',
  callCount: 4,
  refusedCount: 0,
  lastCallAt: null,
  ...over,
});

const TOKEN = token('t1', 'laptop-claude', { createdAt: '2026-11-01T00:00:00.000Z' });

function mountAgent(pages: AgentSessionRow[][], state = agentState({ tokens: [TOKEN] })) {
  const queries: AgentSessionsQuery[] = [];
  const listSessions = vi.fn(async (q: AgentSessionsQuery) => {
    queries.push(q);
    const index = q.before ? pages.findIndex((p) => p.some((r) => r.id === q.before!.id)) + 1 : 0;
    return pages[index] ?? [];
  });
  const copySetup = vi.fn(async ({ id }: { id: string }) => ({ tokenId: id, copiedAt: '2026-11-27T10:00:00.000Z' }));
  const renameToken = vi.fn(async ({ id, name }: { id: string; name: string }) => ({ id, name, createdAt: TOKEN.createdAt }));
  const revokeToken = vi.fn(async () => ({ ok: true as const }));
  installAtelierMock({ agentAccess: { listSessions, copySetup, renameToken, revokeToken } });
  const onNavigate = vi.fn<(p: AgentsPage) => void>();
  render(<AgentPage page={{ kind: 'agent', tokenId: 't1' }} state={state} onNavigate={onNavigate} />);
  return { queries, copySetup, renameToken, revokeToken, onNavigate };
}

describe('the Agent page', () => {
  it('shows the name, when it was created and last used, and its sessions', async () => {
    const live = liveSession({ id: 'live', tokenId: 't1' });
    mountAgent([[row('live', 1, { endedAt: null, endReason: null }), row('old', 60)]], agentState({ tokens: [{ ...TOKEN, lastUsedAt: new Date().toISOString() }], sessions: [live] }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('laptop-claude');
    expect(screen.getByTestId('agent-page-dates').textContent).toMatch(/^Created .* · last used just now$/);
    await waitFor(() => expect(screen.getAllByTestId('agent-page-session')).toHaveLength(2));
    const [first, second] = screen.getAllByTestId('agent-page-session');
    expect(first!.dataset.live).toBe('true');
    expect(first!.textContent).toContain('live · since');
    expect(second!.dataset.live).toBeUndefined();
    expect(second!.textContent).toContain('the client closed it');
  });

  it('says when it was never used', () => {
    mountAgent([[]]);
    expect(screen.getByTestId('agent-page-dates').textContent).toContain('never used');
  });

  it('pages with Show more until a page comes back empty, even after a short one', async () => {
    const m = mountAgent([[row('a', 10), row('b', 20)], [row('c', 30)]]);
    await waitFor(() => expect(screen.getAllByTestId('agent-page-session')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(screen.getAllByTestId('agent-page-session')).toHaveLength(3));
    expect(m.queries[1]).toMatchObject({ tokenId: 't1', includeEnded: true, before: { id: 'b', startedAt: at(20) } });
    // A short page is not the end: Show more stays until an empty one.
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull());
    expect(screen.getAllByTestId('agent-page-session')).toHaveLength(3);
  });

  it('opens a session on its page, with the Agent known', async () => {
    const m = mountAgent([[row('a', 10)]]);
    fireEvent.click(within((await screen.findAllByTestId('agent-page-session'))[0]!).getByRole('button'));
    expect(m.onNavigate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'session', sessionId: 'a', tokenId: 't1', agentName: 'laptop-claude' }));
  });

  it('renames through its dialog', async () => {
    const m = mountAgent([[]]);
    fireEvent.click(screen.getByRole('button', { name: 'Rename…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename “laptop-claude”' });
    fireEvent.change(within(dialog).getByLabelText('Agent name'), { target: { value: '  ci-runner ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(m.renameToken).toHaveBeenCalledWith({ id: 't1', name: 'ci-runner' }));
  });

  it('copies the setup again for a chosen client', async () => {
    const m = mountAgent([[]]);
    fireEvent.click(screen.getByRole('button', { name: 'Copy setup again…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Copy setup again for “laptop-claude”' });
    expect(dialog.textContent).toContain('ends its live sessions');
    fireEvent.change(within(dialog).getByLabelText('Client'), { target: { value: 'cursor' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy setup' }));
    await waitFor(() => expect(m.copySetup).toHaveBeenCalledWith({ id: 't1', client: 'cursor' }));
  });

  it('revokes only after the app confirm', async () => {
    const m = mountAgent([[]]);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke…' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Revoke “laptop-claude”?' })).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(m.revokeToken).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke…' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Revoke “laptop-claude”?' })).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(m.revokeToken).toHaveBeenCalledWith({ id: 't1' }));
  });

  it('says so for an Agent that no longer exists', () => {
    mountAgent([[]], agentState({ tokens: [] }));
    expect(screen.getByTestId('agents-page-agent').textContent).toContain('no longer exists');
  });
});

describe('All activity', () => {
  function mountActivity(page: Extract<AgentsPage, { kind: 'activity' }>) {
    const queries: AgentCallsQuery[] = [];
    installAtelierMock({ agentAccess: { listCalls: async (q) => (queries.push(q), []) } });
    const onNavigate = vi.fn<(p: AgentsPage) => void>();
    const view = render(
      <AllActivityPage
        page={page}
        state={agentState({ tokens: [token('t2', 'zed'), token('t1', 'alpha')] })}
        connections={[connectionFixture({ id: 'c-shop', name: 'Shop' })]}
        onNavigate={onNavigate}
        onOpenQuery={() => {}}
      />,
    );
    return { queries, onNavigate, view };
  }

  it('reads the Log with a preset Connection, database and collection, and lets the namespace go', async () => {
    const m = mountActivity({ kind: 'activity', connectionId: 'c-shop', database: 'shop', collection: 'orders' });
    await waitFor(() => expect(m.queries[0]).toEqual({ outcome: 'all', connectionId: 'c-shop', database: 'shop', collection: 'orders', limit: 50 }));
    expect(screen.getByTestId('activity-namespace').textContent).toContain('shop.orders');
    fireEvent.click(screen.getByRole('button', { name: 'Show every collection, not only shop.orders' }));
    expect(m.onNavigate).toHaveBeenCalledWith({ kind: 'activity', connectionId: 'c-shop', database: undefined, collection: undefined });
  });

  it('filters by Agent, Connection and outcome', async () => {
    const m = mountActivity({ kind: 'activity', database: 'shop', collection: 'orders' });
    const agent = screen.getByLabelText('Agent') as HTMLSelectElement;
    expect([...agent.options].map((o) => o.textContent)).toEqual(['Every Agent', 'alpha', 'zed']);
    fireEvent.change(agent, { target: { value: 't2' } });
    expect(m.onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ tokenId: 't2' }));
    fireEvent.change(screen.getByLabelText('Connection'), { target: { value: 'c-shop' } });
    expect(m.onNavigate).toHaveBeenLastCalledWith({ kind: 'activity', connectionId: 'c-shop', database: undefined, collection: undefined });
    fireEvent.click(screen.getByRole('radio', { name: 'Refused' }));
    expect(m.onNavigate).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'refused' }));
    m.view.rerender(
      <AllActivityPage
        page={{ kind: 'activity', tokenId: 't2', outcome: 'refused' }}
        state={agentState({ tokens: [token('t2', 'zed')] })}
        connections={[]}
        onNavigate={() => {}}
        onOpenQuery={() => {}}
      />,
    );
    await waitFor(() => expect(m.queries.at(-1)).toEqual({ outcome: 'refused', tokenId: 't2', limit: 50 }));
  });
});
