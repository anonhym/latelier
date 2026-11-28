// X30 §9: a collection's History lists the Agents' finds and counts beside
// the user's own runs. Load fills the editor and never runs; a refused or cut
// call offers Copy only; the footer opens All activity on the collection.
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within, emptyWorkspaceActions, emptyWorkspaceMeta } from '../helpers/render';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { callRow } from '../helpers/agentProposalFixture';
import { RecentTab } from '../../src/pages/Workspace/views/RecentTab';
import { QueryBar } from '../../src/pages/Workspace/QueryBar';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import { takeAgentsPageRequest } from '../../src/features/agents/agentsNav';
import { isAgentSeeded, resetAgentSeeded } from '../../src/features/agents/agentSeededTabs';
import { _resetTabRequestsForTests } from '../../src/pages/Workspace/tabRequest';
import type { CollectionWorkspaceActions } from '../../src/pages/Workspace/context';
import type { LegacySavedFindPayload } from '../../src/pages/Workspace/legacyBuilder';
import type { AgentCallRow, AgentCallsQuery, CollectionTabState, RecentQuery } from '@shared/types';

afterEach(() => {
  uninstallAtelierMock();
  _resetTabRequestsForTests();
  takeAgentsPageRequest();
  resetAgentSeeded();
  vi.restoreAllMocks();
});

const at = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const mine = (id: string, minutesAgo: number, queryRaw: string): RecentQuery => ({
  id,
  connectionId: 'c1',
  dbName: 'shop',
  collection: 'orders',
  kind: 'find',
  payload: { kind: 'find', queryRaw, builder: { conditions: [], logic: 'AND', sort: '', limit: '', projection: [] } } as unknown as RecentQuery['payload'],
  ranAt: at(minutesAgo),
  durationMs: 12,
});

const agentFind = (id: string, minutesAgo: number, filter: unknown, over: Partial<AgentCallRow> = {}) =>
  callRow({
    id,
    ts: at(minutesAgo),
    connectionId: 'c1',
    database: 'shop',
    collection: 'orders',
    request: JSON.stringify({ connectionId: 'c1', database: 'shop', collection: 'orders', filter }),
    ...over,
  });

function mount({ runs = [] as RecentQuery[], calls = [] as AgentCallRow[], failCalls = false } = {}) {
  const queries: AgentCallsQuery[] = [];
  installAtelierMock({
    recent: { list: async () => runs },
    agentAccess: {
      listCalls: async (q) => {
        queries.push(q);
        if (failCalls) throw new Error('log unreadable');
        return calls.filter((c) => c.tool === q.tool);
      },
    },
  });
  const onRunHere = vi.fn<(r: RecentQuery) => void>();
  const onLoad = vi.fn<(p: LegacySavedFindPayload) => void>();
  const onAgentActivity = vi.fn();
  render(<RecentTab connectionId="c1" dbName="shop" collection="orders" onRunHere={onRunHere} onLoad={onLoad} onAgentActivity={onAgentActivity} />);
  return { queries, onRunHere, onLoad, onAgentActivity };
}

const agentRows = () => screen.queryAllByTestId('recent-agent-row');

describe('History with Agent rows', () => {
  it('reads the finds and counts on this collection from the Agent Read Log, never its aggregations', async () => {
    const m = mount();
    await waitFor(() => expect(m.queries).toHaveLength(2));
    expect(m.queries.map((q) => q.tool)).toEqual(['find', 'count']);
    for (const q of m.queries) expect(q).toMatchObject({ connectionId: 'c1', database: 'shop', collection: 'orders', outcome: 'all' });
  });

  it('merges Agent rows with the user\'s runs by time, each with its chip naming the Agent and session', async () => {
    mount({
      runs: [mine('r1', 10, '{"a":1}')],
      calls: [agentFind('k1', 5, { status: 'shipped' }), agentFind('k2', 20, { b: 2 }, { tool: 'count', clientName: null })],
    });
    await waitFor(() => expect(agentRows()).toHaveLength(2));
    const order = [...document.querySelectorAll('[data-testid="recent-row"], [data-testid="recent-agent-row"]')].map(
      (el) => (el as HTMLElement).dataset.callId ?? 'mine',
    );
    expect(order).toEqual(['k1', 'mine', 'k2']);
    const [first, last] = screen.getAllByTestId('recent-agent-chip');
    expect(first!.textContent).toBe('Agent · claude-code, laptop-claude · session s1');
    expect(last!.textContent).toContain('Agent · unknown client');
  });

  it('filters All, Mine and Agents', async () => {
    mount({ runs: [mine('r1', 10, '{"a":1}')], calls: [agentFind('k1', 5, {})] });
    await waitFor(() => expect(agentRows()).toHaveLength(1));
    expect(screen.getByRole('radiogroup', { name: 'Who ran it' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Mine' }));
    expect(agentRows()).toHaveLength(0);
    expect(screen.getAllByTestId('recent-row')).toHaveLength(1);
    fireEvent.click(screen.getByRole('radio', { name: 'Agents' }));
    expect(agentRows()).toHaveLength(1);
    expect(screen.queryAllByTestId('recent-row')).toHaveLength(0);
  });

  it('says so when no Agent has run a find or count here', async () => {
    mount({ runs: [mine('r1', 10, '{"a":1}')] });
    await screen.findByTestId('recent-row');
    fireEvent.click(screen.getByRole('radio', { name: 'Agents' }));
    expect(screen.getByText('No Agent has run a find or a count on orders.')).toBeTruthy();
  });

  it('Load hands over the Agent\'s filter to fill the editor, and an Agent row has no Run or Delete', async () => {
    const m = mount({ calls: [agentFind('k1', 5, { status: 'shipped' })] });
    const row = (await screen.findAllByTestId('recent-agent-row'))[0]!;
    expect(within(row).queryByRole('button', { name: /^Run / })).toBeNull();
    expect(within(row).queryByRole('button', { name: /^Delete / })).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: 'Load {"status":"shipped"} into the editor' }));
    expect(m.onLoad).toHaveBeenCalledWith(expect.objectContaining({ kind: 'find', queryRaw: '{"status":"shipped"}' }));
    expect(m.onRunHere).not.toHaveBeenCalled();
  });

  it('offers Copy only on a refused call and on a cut one', async () => {
    mount({
      calls: [
        agentFind('k-refused', 5, { $where: '1' }, { outcome: 'JS_NOT_ALLOWED', docCount: undefined }),
        agentFind('k-cut', 6, { a: 1 }, { requestTruncated: true }),
      ],
    });
    await waitFor(() => expect(agentRows()).toHaveLength(2));
    for (const row of agentRows()) {
      expect(within(row).queryByRole('button', { name: /^Load / })).toBeNull();
      expect((within(row).getByRole('button', { name: "Copy the Agent's request to the clipboard" }) as HTMLButtonElement).disabled).toBe(false);
    }
    expect(agentRows()[0]!.textContent).toContain('refused · server-side JavaScript');
  });

  it('routes Enter by what the row offers: run the user\'s, load the Agent\'s, nothing for Copy only', async () => {
    const m = mount({
      runs: [mine('r1', 30, '{"a":1}')],
      calls: [agentFind('k-ok', 5, { b: 2 }), agentFind('k-refused', 10, {}, { outcome: 'NOT_OPEN', docCount: undefined })],
    });
    await waitFor(() => expect(agentRows()).toHaveLength(2));
    const search = screen.getByRole('textbox', { name: 'Search recent queries' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(m.onLoad).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(m.onLoad).toHaveBeenCalledTimes(1);
    expect(m.onRunHere).not.toHaveBeenCalled();
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(m.onRunHere).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
  });

  it('keeps Clear to the user\'s own runs', async () => {
    mount({ calls: [agentFind('k1', 5, {})] });
    await waitFor(() => expect(agentRows()).toHaveLength(1));
    expect((screen.getByRole('button', { name: 'Clear recent find history for orders' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows an Agent\'s strings as text', async () => {
    mount({ calls: [agentFind('k1', 5, { name: '<b>bold</b>' }, { clientName: '<img src=x onerror=alert(1)>' })] });
    const row = (await screen.findAllByTestId('recent-agent-row'))[0]!;
    expect(row.querySelector('b, img')).toBeNull();
    expect(row.textContent).toContain('<b>bold</b>');
    expect(row.textContent).toContain('Agent · <img src=x onerror=alert(1)>');
  });

  it('still lists the user\'s runs when the Agent Read Log cannot be read', async () => {
    mount({ runs: [mine('r1', 10, '{"a":1}')], failCalls: true });
    await screen.findByTestId('recent-row');
    expect(screen.getByText('Agent calls could not be read.')).toBeTruthy();
  });

  it('says the Agent Read Log could not be read under Agents, never that no Agent ran anything', async () => {
    mount({ runs: [mine('r1', 10, '{"a":1}')], failCalls: true });
    await screen.findByTestId('recent-row');
    fireEvent.click(screen.getByRole('radio', { name: 'Agents' }));
    expect(screen.queryByText('No Agent has run a find or a count on orders.')).toBeNull();
    expect(screen.getAllByText('Agent calls could not be read.')).toHaveLength(1);
  });

  it('links to All activity on the collection', async () => {
    const m = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'All Agent activity on orders' }));
    expect(m.onAgentActivity).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Load fills the editor, it never runs/)).toBeTruthy();
  });
});

describe('History in the Filter Bar', () => {
  const state: CollectionTabState = {
    view: 'Tree',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
  };

  function Bar({ actions }: { actions: CollectionWorkspaceActions }) {
    const [s, setS] = React.useState(state);
    const live = React.useMemo<CollectionWorkspaceActions>(
      () => ({
        ...actions,
        patch: (p) => {
          actions.patch(p);
          setS((prev) => ({ ...prev, ...p }));
        },
      }),
      [actions],
    );
    return (
      <CollectionWorkspaceProvider state={s} actions={live} meta={emptyWorkspaceMeta({ dbName: 'shop', collection: 'orders', tabId: 'hist' })}>
        <QueryBar suggestionContext={null} builderOpen onToggleBuilder={() => undefined} />
      </CollectionWorkspaceProvider>
    );
  }

  async function openHistory(calls: AgentCallRow[]) {
    installAtelierMock({ recent: { list: async () => [] }, agentAccess: { listCalls: async (q) => calls.filter((c) => c.tool === q.tool) } });
    const actions = emptyWorkspaceActions();
    render(<Bar actions={actions} />);
    fireEvent.click(screen.getByTestId('query-bar-saved-btn'));
    fireEvent.click(await screen.findByRole('tab', { name: 'History' }));
    return actions;
  }

  it('Load fills the filter and runs nothing', async () => {
    const actions = await openHistory([agentFind('k1', 5, { status: 'shipped' })]);
    fireEvent.click(await screen.findByRole('button', { name: 'Load {"status":"shipped"} into the editor' }));
    await waitFor(() => expect(actions.patch).toHaveBeenCalledWith(expect.objectContaining({ queryRaw: '{"status":"shipped"}' })));
    expect(actions.run).not.toHaveBeenCalled();
    // Marked, so the Workspace never runs it by itself later, on a connect or as the restored tab.
    expect(isAgentSeeded('hist')).toBe(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('the footer opens All activity on this collection', async () => {
    await openHistory([]);
    fireEvent.click(await screen.findByRole('button', { name: 'All Agent activity on orders' }));
    expect(takeAgentsPageRequest()).toEqual({ kind: 'activity', connectionId: 'c1', database: 'shop', collection: 'orders' });
  });
});
