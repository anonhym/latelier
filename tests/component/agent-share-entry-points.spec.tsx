import { describe, it, expect, vi, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { fireEvent, render, screen, act, within, navigatorRoot } from '../helpers/render';
import { installAtelierMock, uninstallAtelierMock, connectionFixture, AGENT_ACCESS_OFF } from '../helpers/atelierMock';
import { StatusBar } from '../../src/pages/Workspace/StatusBar';
import { SettingsProvider } from '../../src/pages/SettingsContext';
import { SettingsModal } from '../../src/pages/SettingsModal';
import { HintsProvider } from '../../src/hints/HintsProvider';
import { DbCollectionNavigator } from '../../src/pages/Workspace/DbCollectionNavigator';
import type { AgentAccessState, ConnectionSummary } from '../../shared/types';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

const ON: AgentAccessState = { ...AGENT_ACCESS_OFF, enabled: true, sessionReadCount: 2 };
const prod = (over: Partial<ConnectionSummary> = {}): ConnectionSummary => ({
  ...connectionFixture(),
  id: 'c1',
  name: 'Prod',
  status: 'connected',
  shareWithAgents: false,
  ...over,
});

function mountBar(connection: ConnectionSummary | null, state: AgentAccessState, setShared = vi.fn(async ({ shared }: { shared: boolean }) => ({ shared }))) {
  installAtelierMock({
    prefs: { get: async () => null, set: async (_k: string, v: unknown) => v } as never,
    agentAccess: { getState: async () => state, setShared } as never,
  });
  render(
    <HintsProvider>
      <SettingsProvider>
        <StatusBar connection={connection} />
      </SettingsProvider>
    </HintsProvider>,
  );
  return setShared;
}

describe('the status bar Agents control (X27 §12.2)', () => {
  it('shows "Agents off" for a focused Connection while Agent Access is off, so sharing is reachable from the data view', async () => {
    mountBar(prod(), AGENT_ACCESS_OFF);
    const btn = await screen.findByRole('button', { name: 'Agent Access is off' });
    expect(btn.textContent).toBe('Agents off');
  });

  it('shares the focused Connection by name, through main', async () => {
    const setShared = mountBar(prod(), AGENT_ACCESS_OFF);
    await userEvent.click(await screen.findByTestId('agent-status'));
    const menu = await screen.findByTestId('agent-status-menu');
    expect(within(menu).getByTestId('agent-status-share-state').textContent).toBe('Not shared with Agents');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Share "Prod" with Agents…' }));
    expect(setShared).toHaveBeenCalledWith({ connectionId: 'c1', shared: true });
  });

  it('disables Share and says why while the focused Connection is not open', async () => {
    const setShared = mountBar(prod({ status: 'disconnected' }), ON);
    await userEvent.click(await screen.findByTestId('agent-status'));
    const item = await screen.findByRole('menuitem', { name: 'Share "Prod" with Agents…' });
    expect(item.hasAttribute('disabled') || item.getAttribute('data-disabled') === 'true').toBe(true);
    expect(screen.getAllByText('Open this Connection first').length).toBeGreaterThan(0);
    await userEvent.click(item);
    expect(setShared).not.toHaveBeenCalled();
  });

  it('for a shared Connection, shows the privilege result and offers Stop sharing', async () => {
    const setShared = mountBar(prod({ shareWithAgents: true }), { ...ON, privilege: { c1: { kind: 'read-only', roles: [] } } });
    await userEvent.click(await screen.findByRole('button', { name: 'Agent Access: 2 reads this session' }));
    const menu = await screen.findByTestId('agent-status-menu');
    expect(within(menu).getByTestId('agent-status-share-state').textContent).toBe('Shared with Agents · This user can only read.');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Stop sharing "Prod" with Agents' }));
    expect(setShared).toHaveBeenCalledWith({ connectionId: 'c1', shared: false });
  });

  it('opens Settings on the Agent Access section from the menu', async () => {
    mountBar(prod(), ON);
    await userEvent.click(await screen.findByTestId('agent-status'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Agent Access settings…' }));
    const tab = await screen.findByRole('tab', { name: 'Agent Access' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
  });
});

describe('the navigator root menu (X27 §12.3)', () => {
  function mountNavigator(conn: ConnectionSummary, setShared = vi.fn(async ({ shared }: { shared: boolean }) => ({ shared }))) {
    installAtelierMock({ agentAccess: { getState: async () => ON, setShared } as never });
    render(
      <DbCollectionNavigator
        // A tab open on it is what gives a not-open Connection a root at all.
        connectionsWithTabs={new Set([conn.id])}
        connections={[conn]}
        focusedConnectionId={null}
        activeDbName={null}
        activeCollection={null}
        onOpenCollection={vi.fn()}
        onOpenAggregation={vi.fn()}
      />,
    );
    return setShared;
  }

  it('offers Share with Agents on an open Connection, and asks main', async () => {
    const setShared = mountNavigator(prod());
    fireEvent.contextMenu(navigatorRoot('Prod'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Share with Agents…' }));
    await act(async () => {});
    expect(setShared).toHaveBeenCalledWith({ connectionId: 'c1', shared: true });
  });

  it('disables Share on a Connection that is not open', async () => {
    const setShared = mountNavigator(prod({ status: 'disconnected' }));
    fireEvent.contextMenu(navigatorRoot('Prod'));
    const item = screen.getByRole('menuitem', { name: /Share with Agents…/ });
    expect(item.getAttribute('aria-disabled') === 'true' || item.hasAttribute('disabled')).toBe(true);
    fireEvent.click(item);
    await act(async () => {});
    expect(setShared).not.toHaveBeenCalled();
  });

  it('offers Stop sharing on a shared Connection', async () => {
    const setShared = mountNavigator(prod({ shareWithAgents: true }));
    fireEvent.contextMenu(navigatorRoot('Prod'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stop sharing with Agents' }));
    await act(async () => {});
    expect(setShared).toHaveBeenCalledWith({ connectionId: 'c1', shared: false });
  });
});

describe('Settings: Shared Connections (X27 §12.1)', () => {
  function mountSettings(state: AgentAccessState, conns: ConnectionSummary[], setShared = vi.fn(async ({ shared }: { shared: boolean }) => ({ shared }))) {
    installAtelierMock({
      prefs: { get: async () => null, set: async (_k: string, v: unknown) => v } as never,
      conn: { list: async () => conns },
      agentAccess: { getState: async () => state, setShared } as never,
    });
    render(
      <HintsProvider>
        <SettingsModal initialSection="agents" onClose={() => {}} />
      </HintsProvider>,
    );
    return setShared;
  }

  it('lists only shared Connections with their open state, and Stop sharing asks main', async () => {
    const setShared = mountSettings(ON, [
      prod({ shareWithAgents: true }),
      prod({ id: 'c2', name: 'Staging', shareWithAgents: true, status: 'disconnected' }),
      prod({ id: 'c3', name: 'Local', shareWithAgents: false }),
    ]);
    const table = await screen.findByRole('table', { name: 'Shared Connections' });
    const rows = within(table).getAllByRole('row').map((r) => r.textContent);
    expect(rows).toEqual([expect.stringContaining('Prod'), expect.stringContaining('Staging')]);
    expect(rows[0]).toContain('Open');
    expect(rows[1]).toContain('Not open: Agents see it as unavailable');
    expect(within(table).queryByText('Local')).toBeNull();
    await userEvent.click(within(table).getByRole('button', { name: 'Stop sharing: Staging' }));
    expect(setShared).toHaveBeenCalledWith({ connectionId: 'c2', shared: false });
  });

  it('says where to share from when none is shared', async () => {
    mountSettings(ON, [prod()]);
    expect(await screen.findByText(/No Connection is shared/)).toBeTruthy();
    expect(screen.queryByTestId('agent-next-step')).toBeNull();
  });

  it('says shared Connections are unreachable while Agent Access is off', async () => {
    mountSettings(AGENT_ACCESS_OFF, [prod({ shareWithAgents: true })]);
    expect(await screen.findByText('Agent Access is off, so no Agent can reach these.')).toBeTruthy();
  });

  it('points at Add Agent when something is shared but no Agent has a token', async () => {
    mountSettings(ON, [prod({ shareWithAgents: true })]);
    expect((await screen.findByTestId('agent-next-step')).textContent).toMatch(/add an Agent/);
  });

  it('walks through the Claude Code CLI setup with the command main built, placeholder and all', async () => {
    const command = `claude mcp add latelier --scope user -e LATELIER_AGENT_TOKEN=YOUR_TOKEN -- "/Users/me/Library/Application Support/L'Atelier/bin/latelier-agent-bridge"`;
    mountSettings({ ...AGENT_ACCESS_OFF, claudeCodeCommand: command }, []);
    const setup = await screen.findByTestId('agent-claude-code-setup');
    expect(within(setup).getByText('Set up Claude Code')).toBeTruthy();
    expect(within(setup).getByTestId('agent-claude-code-command').textContent).toBe(command);
    expect(within(setup).getByText(/Copy Claude Code command/)).toBeTruthy();
    expect(within(setup).getByText('claude mcp list')).toBeTruthy();
    expect(within(setup).getByText(/--scope user makes it available in every project/)).toBeTruthy();
    expect(within(setup).getByText('To remove it: claude mcp remove latelier')).toBeTruthy();
    expect(within(setup).getAllByRole('listitem')).toHaveLength(5);
  });

  it('drops the next step once an Agent exists', async () => {
    mountSettings({ ...ON, tokens: [{ id: 't1', name: 'Claude Code', createdAt: '2026-11-18T00:00:00.000Z' }] }, [prod({ shareWithAgents: true })]);
    await screen.findByRole('table', { name: 'Shared Connections' });
    expect(screen.queryByTestId('agent-next-step')).toBeNull();
  });
});
