// Settings → Agent Access (X30 §11): the switch, one status line and Open
// Agents. Everything else lives in Agents mode.
import { describe, it, expect, vi, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen } from '../helpers/render';
import { installAtelierMock, uninstallAtelierMock, AGENT_ACCESS_OFF } from '../helpers/atelierMock';
import { HintsProvider } from '../../src/hints/HintsProvider';
import { SettingsModal } from '../../src/pages/SettingsModal';
import { takeAgentsPageRequest } from '../../src/features/agents/agentsNav';
import type { AgentAccessState } from '../../shared/types';

afterEach(() => {
  uninstallAtelierMock();
  takeAgentsPageRequest();
});

const ON: AgentAccessState = {
  ...AGENT_ACCESS_OFF,
  enabled: true,
  bridgeInstalled: true,
  socketPath: '/tmp/latelier-agent.sock',
  sessionReadCount: 3,
  sessionCount: 1,
  claudeCodeCommand: 'claude mcp add latelier -- YOUR_TOKEN',
  tokens: [{ id: 't1', name: 'Claude Code', createdAt: '2026-11-18T00:00:00.000Z' }],
};

function settings(onClose: () => void) {
  return (
    <HintsProvider>
      <SettingsModal initialSection="agents" onClose={onClose} />
    </HintsProvider>
  );
}

function mount(state: AgentAccessState, agentAccess: Record<string, unknown> = {}, onClose = () => {}) {
  installAtelierMock({
    prefs: { get: async () => null, set: async (_k: string, v: unknown) => v } as never,
    agentAccess: { getState: async () => state, ...agentAccess } as never,
  });
  return render(settings(onClose));
}

describe('Settings: Agent Access', () => {
  it('off: the switch is unchecked, the status line says so, and turning it on asks main', async () => {
    const requestEnable = vi.fn(async () => ({ enabled: false }));
    mount(AGENT_ACCESS_OFF, { requestEnable });
    const sw = await screen.findByRole('switch', { name: 'Agent Access' });
    expect((sw as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId('agent-access-status').textContent).toBe('Agent Access is off');
    await userEvent.click(sw);
    expect(requestEnable).toHaveBeenCalledTimes(1);
    // A cancelled dialog leaves it off: the switch follows the state, not the click.
    expect((sw as HTMLInputElement).checked).toBe(false);
  });

  it('on: one status line and nothing of what moved to Agents mode', async () => {
    const disable = vi.fn(async () => ({ enabled: false as const }));
    mount(ON, { disable });
    const sw = await screen.findByRole('switch', { name: 'Agent Access' });
    expect((sw as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId('agent-access-status').textContent).toBe('Agent Access is on · no live sessions');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('/tmp/latelier-agent.sock')).toBeNull();
    expect(screen.queryByText(/YOUR_TOKEN/)).toBeNull();
    expect(screen.queryByText(/reads? this session/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Add Agent|Copy setup|Revoke|Remove bridge/ })).toBeNull();
    await userEvent.click(sw);
    expect(disable).toHaveBeenCalledTimes(1);
  });

  it('Open Agents asks for Setup & capabilities and closes Settings', async () => {
    const onClose = vi.fn();
    mount(ON, {}, onClose);
    await userEvent.click(await screen.findByRole('button', { name: 'Open Agents' }));
    expect(takeAgentsPageRequest()).toEqual({ kind: 'setup' });
    expect(onClose).toHaveBeenCalled();
  });

  it('Open Agents from another screen goes to the Workspace, where the Agents tab lives', async () => {
    installAtelierMock({
      prefs: { get: async () => null, set: async (_k: string, v: unknown) => v } as never,
      agentAccess: { getState: async () => ON } as never,
    });
    render(
      <MemoryRouter initialEntries={['/connections/c1']}>
        <Routes>
          <Route path="/connections/:id" element={settings(() => {})} />
          <Route path="/workspace" element={<p>workspace route</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Open Agents' }));
    expect(await screen.findByText('workspace route')).toBeTruthy();
    expect(takeAgentsPageRequest()).toEqual({ kind: 'setup' });
  });
});
