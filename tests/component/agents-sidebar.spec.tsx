// The Agents sidebar (X30 §3): Agents by name with their live sessions and up
// to five ended ones, Show all, the tree's keys, Agent-supplied text as text,
// and the Agent row's menu.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '../helpers/render';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { agentState, liveSession, token } from '../helpers/agentsWorkspace';
import { AgentsSidebar } from '../../src/features/agents/AgentsSidebar';
import type { AgentAccessState, AgentSessionRow, AgentSessionsQuery } from '@shared/types';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const ended = (i: number, tokenId = 't1'): AgentSessionRow => ({
  id: `e${i}`,
  tokenId,
  tokenName: 'laptop-claude',
  clientName: `ended-client-${i}`,
  clientVersion: null,
  folder: null,
  startedAt: minutesAgo(600 + i * 10),
  endedAt: minutesAgo(590 + i * 10),
  endReason: 'client-closed',
  callCount: 0,
  refusedCount: 0,
  lastCallAt: null,
});

const STATE = agentState({
  tokens: [
    token('t1', 'laptop-claude'),
    token('t3', 'desktop', { lastUsedAt: minutesAgo(60 * 24 * 2) }),
    token('t2', 'cursor-work'),
  ],
  sessions: [
    liveSession({ id: 'old', tokenId: 't1', clientName: 'claude-code', folder: '~/Projects/shop-api', startedAt: minutesAgo(34) }),
    liveSession({ id: 'new', tokenId: 't1', clientName: 'claude-code', folder: null, clientVersion: '2.0.1', startedAt: minutesAgo(5) }),
  ],
  connectionRequests: [
    {
      sessionId: 'old',
      tokenName: 'laptop-claude',
      clientName: 'claude-code',
      folder: null,
      connectionId: 'c1',
      connectionName: 'Prod',
      firstAt: minutesAgo(2),
      lastAt: minutesAgo(2),
      count: 1,
      lastTool: 'find',
      database: null,
      collection: null,
      lastOutcome: 'refused',
    },
  ],
});

function mount(state: AgentAccessState = STATE, endedRows: AgentSessionRow[] = []) {
  const listSessions = vi.fn(async (q: AgentSessionsQuery) => {
    if (q.before) return [];
    // The live ones come back too, and one the state still lists as live may already be stored as ended: drawn once, as live.
    return [
      { ...ended(99, q.tokenId!), id: 'new', endedAt: null },
      { ...ended(98, q.tokenId!), id: 'old' },
      ...endedRows.filter((r) => r.tokenId === q.tokenId),
    ];
  });
  const api = installAtelierMock({ agentAccess: { listSessions } });
  const onNavigate = vi.fn();
  render(<AgentsSidebar state={state} page={null} onNavigate={onNavigate} />);
  return { api, onNavigate, listSessions };
}

const agentRow = (name: string) =>
  screen.getAllByTestId('agents-sidebar-agent').find((el) => el.getAttribute('aria-label')?.startsWith(`${name},`))!;

describe('the Agents sidebar', () => {
  it('lists Agents by name with their state, an Agent with a live session expanded', async () => {
    mount();
    const rows = screen.getAllByTestId('agents-sidebar-agent');
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'cursor-work, never connected',
      'desktop, last seen 2d ago',
      'laptop-claude, 2 live',
    ]);
    expect(agentRow('laptop-claude').getAttribute('aria-expanded')).toBe('true');
    expect(agentRow('desktop').getAttribute('aria-expanded')).toBe('false');
    const live = screen.getAllByTestId('agents-sidebar-live-session');
    // Newest first: the one with no folder shows its client's version.
    expect(live[0]!.textContent).toContain('2.0.1 · 5 min');
    expect(live[1]!.textContent).toContain('shop-api · 34 min');
    expect(within(live[1]!).getByTestId('needs-you-badge').textContent).toBe('1');
    expect(within(live[0]!).queryByTestId('needs-you-badge')).toBeNull();
  });

  it('lists up to five ended sessions, dimmed, and Show all when there are more', async () => {
    const { onNavigate, listSessions } = mount(STATE, [0, 1, 2, 3, 4, 5].map((i) => ended(i)));
    await waitFor(() => expect(screen.getAllByTestId('agents-sidebar-ended-session')).toHaveLength(5));
    expect(screen.getAllByTestId('agents-sidebar-ended-session')[0]!.textContent).toMatch(/ended · (today|yesterday|\w{3} \d+) \d\d:\d\d–\d\d:\d\d/);
    expect(screen.getAllByTestId('agents-sidebar-ended-session')[0]!.style.opacity).toBe('0.62');
    expect(listSessions).toHaveBeenCalledWith(expect.objectContaining({ tokenId: 't1', includeEnded: true }));
    // The stored list's copy of a live session is drawn once, as live.
    expect(screen.getAllByTestId('agents-sidebar-live-session')).toHaveLength(2);
    fireEvent.click(screen.getByText('Show all'));
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'agent', tokenId: 't1' });
  });

  it('has no Show all with five or fewer ended sessions', async () => {
    mount(STATE, [0, 1, 2, 3, 4].map((i) => ended(i)));
    await waitFor(() => expect(screen.getAllByTestId('agents-sidebar-ended-session')).toHaveLength(5));
    expect(screen.queryByText('Show all')).toBeNull();
  });

  it('shows only Home and Connect an Agent with no Agent yet', () => {
    const { onNavigate } = mount(agentState());
    expect(screen.getByTestId('agents-sidebar-home')).toBeTruthy();
    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Setup & capabilities' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Connect an Agent' }));
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'connect' });
    fireEvent.click(screen.getByTestId('agents-sidebar-home'));
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'home' });
  });

  it('opens Setup & capabilities from the gear', () => {
    const { onNavigate } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Setup & capabilities' }));
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'setup' });
  });

  it('moves with the navigator keys: arrows, Right and Left expand and collapse, Enter opens', async () => {
    const { onNavigate } = mount();
    const tree = screen.getByRole('tree');
    const items = () => within(tree).getAllByRole('treeitem');
    expect(items().filter((i) => i.tabIndex === 0)).toHaveLength(1);
    const desktop = agentRow('desktop');
    desktop.focus();
    fireEvent.keyDown(desktop, { key: 'ArrowRight' });
    await waitFor(() => expect(agentRow('desktop').getAttribute('aria-expanded')).toBe('true'));
    fireEvent.keyDown(agentRow('desktop'), { key: 'ArrowLeft' });
    await waitFor(() => expect(agentRow('desktop').getAttribute('aria-expanded')).toBe('false'));

    const laptop = agentRow('laptop-claude');
    laptop.focus();
    fireEvent.keyDown(laptop, { key: 'ArrowRight' });
    const firstSession = screen.getAllByTestId('agents-sidebar-live-session')[0]!;
    expect(document.activeElement).toBe(firstSession);
    expect(firstSession.tabIndex).toBe(0);
    fireEvent.keyDown(firstSession, { key: 'Enter' });
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'session', sessionId: 'new', agentName: 'laptop-claude' }));
    fireEvent.keyDown(firstSession, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(agentRow('laptop-claude'));
    fireEvent.keyDown(agentRow('laptop-claude'), { key: 'ArrowLeft' });
    await waitFor(() => expect(screen.queryAllByTestId('agents-sidebar-live-session')).toHaveLength(0));
    fireEvent.keyDown(agentRow('laptop-claude'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(agentRow('desktop'));
    fireEvent.keyDown(agentRow('desktop'), { key: 'Home' });
    expect(document.activeElement).toBe(agentRow('cursor-work'));
    fireEvent.keyDown(agentRow('cursor-work'), { key: 'End' });
    expect(document.activeElement).toBe(agentRow('laptop-claude'));
    fireEvent.keyDown(agentRow('laptop-claude'), { key: 'Enter' });
    expect(onNavigate).toHaveBeenLastCalledWith({ kind: 'agent', tokenId: 't1' });
  });

  it('renders a hostile client name and folder as text, cut, with the whole value in the tooltip', () => {
    const hostile = `<img src=x onerror="alert(1)">${'x'.repeat(300)}`;
    installAtelierMock();
    const { container } = render(
      <AgentsSidebar
        state={agentState({
          tokens: [token('t1', '<b>agent</b>')],
          sessions: [liveSession({ id: 's1', tokenId: 't1', clientName: hostile, folder: `/tmp/<script>x</script>` })],
        })}
        page={null}
        onNavigate={() => {}}
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    const name = screen.getByTitle(hostile);
    expect(name.textContent).toBe(hostile);
    expect(name.style.textOverflow).toBe('ellipsis');
    expect(screen.getByText('<b>agent</b>')).toBeTruthy();
  });

  it('marks the row the Agents tab shows', () => {
    installAtelierMock();
    render(<AgentsSidebar state={STATE} page={{ kind: 'session', sessionId: 'old' }} onNavigate={() => {}} />);
    const selected = screen.getAllByRole('treeitem').filter((i) => i.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]!.textContent).toContain('shop-api');
  });
});

describe("an Agent row's menu", () => {
  const openMenu = async (name: string) => {
    fireEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }));
    return screen.findByRole('menu');
  };

  it('renames after the dialog, 1 to 64 characters, without opening the Agent page', async () => {
    const renameToken = vi.fn(async ({ id, name }: { id: string; name: string }) => ({ id, name, createdAt: '' }));
    installAtelierMock({ agentAccess: { renameToken } });
    const onNavigate = vi.fn();
    render(<AgentsSidebar state={STATE} page={null} onNavigate={onNavigate} />);
    fireEvent.click(within(await openMenu('desktop')).getByRole('menuitem', { name: 'Rename…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename “desktop”' });
    const input = within(dialog).getByLabelText('Agent name');
    fireEvent.change(input, { target: { value: '   ' } });
    expect((within(dialog).getByRole('button', { name: 'Rename' }) as HTMLButtonElement).disabled).toBe(true);
    expect(input.getAttribute('maxlength')).toBe('64');
    fireEvent.change(input, { target: { value: ' home-desktop ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(renameToken).toHaveBeenCalledWith({ id: 't3', name: 'home-desktop' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('copies the setup again for the chosen client', async () => {
    const copySetup = vi.fn(async ({ id }: { id: string }) => ({ tokenId: id, copiedAt: new Date().toISOString() }));
    installAtelierMock({ agentAccess: { copySetup } });
    render(<AgentsSidebar state={STATE} page={null} onNavigate={() => {}} />);
    fireEvent.click(within(await openMenu('cursor-work')).getByRole('menuitem', { name: 'Copy setup again…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Client'), { target: { value: 'cursor' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy setup' }));
    await waitFor(() => expect(copySetup).toHaveBeenCalledWith({ id: 't2', client: 'cursor' }));
    expect(await screen.findByText('Cursor setup copied')).toBeTruthy();
  });

  it('revokes only after the app confirm', async () => {
    const revokeToken = vi.fn(async () => ({ ok: true as const }));
    installAtelierMock({ agentAccess: { revokeToken } });
    render(<AgentsSidebar state={STATE} page={null} onNavigate={() => {}} />);
    fireEvent.click(within(await openMenu('laptop-claude')).getByRole('menuitem', { name: 'Revoke…' }));
    const confirm = await screen.findByRole('dialog', { name: 'Revoke “laptop-claude”?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(revokeToken).not.toHaveBeenCalled();
    fireEvent.click(within(await openMenu('laptop-claude')).getByRole('menuitem', { name: 'Revoke…' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Revoke “laptop-claude”?' })).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(revokeToken).toHaveBeenCalledWith({ id: 't1' }));
  });
});
