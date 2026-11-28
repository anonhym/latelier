// X30 §5.2: a session page — identity and where each value comes from, the
// Connections reached, Needs you for the session, and its Activity, live.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '../helpers/render';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { agentState, liveSession, token } from '../helpers/agentsWorkspace';
import { callRow, proposal } from '../helpers/agentProposalFixture';
import { SessionPage } from '../../src/features/agents/SessionPage';
import { resetProposalStore, setOpenProposals } from '../../src/features/agents/proposalStore';
import type { AgentAccessState, AgentCallRow, AgentCallSummary, AgentCallsQuery, AgentSessionRow } from '@shared/types';
import type { QuerySeed } from '../../src/features/agents/activityRow';

afterEach(() => {
  uninstallAtelierMock();
  resetProposalStore();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const LIVE = liveSession({ id: 's1', callCount: 3, refusedCount: 1, clientName: 'claude-code', clientVersion: '2.0.1', folder: '~/Projects/shop-api' });
const STATE = agentState({ sessions: [LIVE], sessionCount: 1, tokens: [token('t1', 'laptop-claude')] });

const storedRow = (over: Partial<AgentSessionRow> = {}): AgentSessionRow => ({
  id: 's1',
  tokenId: 't1',
  tokenName: 'laptop-claude',
  clientName: 'claude-code',
  clientVersion: '2.0.1',
  folder: '~/Projects/shop-api',
  startedAt: ago(60),
  endedAt: ago(10),
  endReason: 'client-closed',
  callCount: 3,
  refusedCount: 1,
  lastCallAt: ago(12),
  ...over,
});

function mount(
  opts: {
    state?: AgentAccessState;
    calls?: AgentCallRow[];
    stored?: AgentSessionRow[];
    proposalId?: string;
  } = {},
) {
  const listeners = new Set<(c: AgentCallSummary) => void>();
  const queries: AgentCallsQuery[] = [];
  const calls = opts.calls ?? [];
  const listCalls = vi.fn(async (q: AgentCallsQuery) => {
    queries.push(q);
    if (q.before) return [];
    return calls.filter((c) => (q.outcome === 'refused' ? c.outcome !== 'ok' && c.outcome !== 'INPUT_REQUIRED' : true));
  });
  const endSession = vi.fn(async () => ({ ok: true as const }));
  const revokeToken = vi.fn(async () => ({ ok: true as const }));
  const dismissRequest = vi.fn(async () => ({ ok: true as const }));
  const listSessions = vi.fn(async (q: { before?: unknown }) => (q.before ? [] : (opts.stored ?? [])));
  installAtelierMock({
    agentProposals: {
      check: async () => ({ kind: 'sampled' as const, sampled: 3, resolved: 3, sourceCollection: 'orders', sourceField: 'customerId', targetCollection: 'customers', targetField: '_id' }),
    },
    agentAccess: {
      listCalls,
      listSessions,
      endSession,
      revokeToken,
      dismissRequest,
      onCall: (cb) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    },
  });
  const openConnection = vi.fn();
  const onOpenQuery = vi.fn<(seed: QuerySeed) => void>();
  render(
    <SessionPage
      page={{ kind: 'session', sessionId: 's1', tokenId: 't1', ...(opts.proposalId ? { proposalId: opts.proposalId } : {}) }}
      state={opts.state ?? STATE}
      openConnection={openConnection}
      onOpenQuery={onOpenQuery}
    />,
  );
  return {
    listCalls,
    queries,
    endSession,
    revokeToken,
    dismissRequest,
    openConnection,
    onOpenQuery,
    push: (c: AgentCallSummary) => act(() => listeners.forEach((l) => l(c))),
  };
}

describe('the session page', () => {
  it('shows each identity value with where it comes from', async () => {
    mount();
    const identity = await screen.findByTestId('session-identity');
    expect(within(identity).getByRole('heading', { level: 1 }).textContent).toBe('laptop-claude');
    expect(identity.textContent).toContain('your name for this token, checked at connect');
    expect(identity.textContent).toContain('claude-code 2.0.1');
    expect(identity.textContent).toContain('as the client reports it');
    expect(identity.textContent).toContain('~/Projects/shop-api');
    expect(identity.textContent).toContain('reported by the bridge');
    expect(screen.getByTestId('session-when').textContent).toMatch(/^s1 · connected .* · live$/);
    expect(screen.getByTestId('session-counts').textContent).toBe('3 calls · 1 refused');
  });

  it('reads a folder the bridge did not report as not reported, with no source note', async () => {
    mount({ state: agentState({ sessions: [{ ...LIVE, folder: null }], tokens: [token('t1', 'laptop-claude')] }) });
    const identity = await screen.findByTestId('session-identity');
    expect(identity.textContent).toContain('not reported');
    expect(identity.textContent).not.toContain('reported by the bridge');
  });

  it('pills each Connection reached, a refused one in words and the warning style', async () => {
    mount({
      calls: [
        callRow({ id: 'a', connectionId: 'c-local', connectionName: 'Local dev', outcome: 'ok' }),
        callRow({ id: 'b', connectionId: 'c-shop', connectionName: 'Shop (prod)', outcome: 'NOT_OPEN' }),
      ],
    });
    await waitFor(() => expect(screen.getAllByTestId('session-reached')).toHaveLength(2));
    const pills = screen.getAllByTestId('session-reached');
    expect(pills.map((p) => [p.textContent, p.dataset.tone])).toEqual([
      ['Local dev', 'ok'],
      ['Shop (prod) · refused, not open', 'warn'],
    ]);
  });

  it('lists the Activity newest first, appends a live call of this session only, and fills in its request', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const first = callRow({ id: 'k1', ts: ago(5) });
    const calls = [first];
    const m = mount({ calls });
    await waitFor(() => expect(screen.getAllByTestId('activity-row')).toHaveLength(1));
    const next = callRow({ id: 'k2', ts: ago(0), tool: 'count' });
    m.push({ ...next, sessionId: 'other' } as AgentCallSummary);
    m.push(next);
    expect(screen.getAllByTestId('activity-row').map((r) => r.dataset.callId)).toEqual(['k2', 'k1']);
    // Pushed without its request: the newest page is read again shortly after.
    calls.unshift(next);
    const before = m.listCalls.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(m.listCalls.mock.calls.length).toBeGreaterThan(before);
    fireEvent.click(within(screen.getAllByTestId('activity-row')[0]!).getByRole('button'));
    await waitFor(() => expect(screen.getByTestId('activity-request').textContent).toContain('"filter"'));
  });

  it('shows the result in words, and tints a refused row', async () => {
    mount({
      calls: [
        callRow({ id: 'ok', ts: ago(3) }),
        callRow({ id: 'no', ts: ago(2), outcome: 'NOT_OPEN' }),
        callRow({ id: 'ask', ts: ago(1), outcome: 'INPUT_REQUIRED' }),
      ],
    });
    await waitFor(() => expect(screen.getAllByTestId('activity-row')).toHaveLength(3));
    const results = screen.getAllByTestId('activity-result').map((r) => r.textContent);
    expect(results).toEqual(['asked you to open Shop (prod)', 'refused · not open', '50 docs · 38 ms']);
    expect(screen.getAllByTestId('activity-row').map((r) => r.dataset.refused ?? null)).toEqual([null, 'true', null]);
  });

  it('filters Refused only through the Read Log', async () => {
    const m = mount({ calls: [callRow({ id: 'ok' }), callRow({ id: 'no', outcome: 'TIMEOUT' })] });
    await waitFor(() => expect(screen.getAllByTestId('activity-row')).toHaveLength(2));
    const toggle = screen.getByRole('button', { name: 'Refused only' });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(screen.getAllByTestId('activity-row').map((r) => r.dataset.callId)).toEqual(['no']));
    expect(m.queries.at(-1)).toMatchObject({ sessionId: 's1', outcome: 'refused' });
  });

  it('loads older rows until a page comes back empty', async () => {
    const m = mount({ calls: [callRow({ id: 'k1' })] });
    await waitFor(() => expect(screen.getAllByTestId('activity-row')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Load older' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull());
    expect(m.queries.at(-1)).toMatchObject({ sessionId: 's1', before: { ts: callRow().ts, id: 'k1' } });
  });

  it('opens an ok, uncut find as a query, and offers Copy only on a refused or cut one', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const m = mount({
      calls: [
        callRow({ id: 'ok', ts: ago(3) }),
        callRow({ id: 'no', ts: ago(2), outcome: 'JS_NOT_ALLOWED', request: '{"filter":{"$where":"sleep(1)"}}' }),
        callRow({ id: 'cut', ts: ago(1), requestTruncated: true, request: '{"truncated":true,"bytes":20000,"head":"{"}' }),
        callRow({ id: 'schema', ts: ago(0), tool: 'collection_schema' }),
      ],
    });
    await waitFor(() => expect(screen.getAllByTestId('activity-row')).toHaveLength(4));
    const open = (id: string) => {
      const row = screen.getAllByTestId('activity-row').find((r) => r.dataset.callId === id)!;
      fireEvent.click(within(row).getAllByRole('button')[0]!);
      return within(row).getByTestId('activity-detail');
    };
    for (const id of ['no', 'cut', 'schema']) {
      const detail = open(id);
      expect(within(detail).queryByRole('button', { name: 'Open as query' })).toBeNull();
      expect(within(detail).getByRole('button', { name: 'Copy' })).toBeTruthy();
    }
    const detail = open('ok');
    fireEvent.click(within(detail).getByRole('button', { name: 'Open as query' }));
    expect(m.onOpenQuery).toHaveBeenCalledWith(expect.objectContaining({ kind: 'find', queryRaw: '{"status":"shipped"}', collection: 'orders' }));
    fireEvent.click(within(detail).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]![0]).toContain('"status": "shipped"');
  });

  it('renders a hostile request as text', async () => {
    mount({ calls: [callRow({ request: '{"filter":{"x":"<img src=x onerror=alert(1)><a href=\\"https://evil\\">go</a>"}}' })] });
    await waitFor(() => expect(screen.getAllByTestId('activity-row')).toHaveLength(1));
    fireEvent.click(within(screen.getByTestId('activity-row')).getAllByRole('button')[0]!);
    const request = screen.getByTestId('activity-request');
    expect(request.textContent).toContain('<img src=x');
    expect(request.querySelector('img, a')).toBeNull();
  });

  it('ends this session, and revokes the Agent only after the app confirm', async () => {
    const m = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'End this session' }));
    await waitFor(() => expect(m.endSession).toHaveBeenCalledWith({ sessionId: 's1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke laptop-claude…' }));
    const confirm = await screen.findByRole('dialog', { name: 'Revoke “laptop-claude”?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(m.revokeToken).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke laptop-claude…' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Revoke “laptop-claude”?' })).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(m.revokeToken).toHaveBeenCalledWith({ id: 't1' }));
  });

  it('shows an ended session read-only, found among the stored sessions', async () => {
    mount({ state: agentState({ tokens: [token('t1', 'laptop-claude')] }), stored: [storedRow({ id: 'other' }), storedRow()] });
    const page = await screen.findByTestId('session-identity');
    expect(screen.getByTestId('agents-page-session').dataset.ended).toBe('true');
    expect(screen.getByTestId('session-when').textContent).toContain('ended');
    expect(screen.getByTestId('session-when').textContent).toContain('the client closed it');
    expect(within(page).queryByRole('button', { name: 'End this session' })).toBeNull();
    expect(within(page).queryByRole('button', { name: /Revoke/ })).toBeNull();
  });

  it('says so when the session is not in the Read Log any more', async () => {
    mount({ state: agentState(), stored: [] });
    expect(await screen.findByText('This session is not in the Agent Read Log any more.')).toBeTruthy();
  });

  it("lists this session's Needs you, and opens a Proposal reviewed from Home with its check", async () => {
    setOpenProposals([proposal({ id: 'p1', backers: [{ ...proposal().backers[0]!, sessionId: 's1' }] }), proposal({ id: 'p2', backers: [{ ...proposal().backers[0]!, sessionId: 's9' }] })]);
    mount({
      proposalId: 'p1',
      state: agentState({
        sessions: [LIVE],
        tokens: [token('t1', 'laptop-claude')],
        connectionRequests: [
          {
            sessionId: 's1',
            tokenName: 'laptop-claude',
            clientName: 'claude-code',
            folder: null,
            connectionId: 'c-shop',
            connectionName: 'Shop (prod)',
            firstAt: ago(2),
            lastAt: ago(1),
            count: 1,
            lastTool: 'find',
            database: 'shop',
            collection: 'orders',
            lastOutcome: 'refused',
          },
        ],
      }),
    });
    const needs = await screen.findByTestId('needs-you');
    expect(within(needs).getAllByTestId('needs-you-request')).toHaveLength(1);
    expect(within(needs).getAllByTestId('needs-you-proposal').map((p) => p.dataset.proposalId)).toEqual(['p1']);
    const card = await within(needs).findByTestId('proposal-card');
    expect(card.dataset.proposalId).toBe('p1');
    await waitFor(() => expect(within(card).getByTestId('proposal-check').textContent).toBe('3 of 3 sampled documents in orders resolve'));
  });
});
