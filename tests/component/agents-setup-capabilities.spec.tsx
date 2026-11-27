// Setup & capabilities (X30 §7): the switch, the bridge, troubleshooting and
// what an Agent can and never does.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '../helpers/render';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { agentState } from '../helpers/agentsWorkspace';
import { SetupCapabilities } from '../../src/features/agents/SetupCapabilities';
import type { AgentAccessState } from '@shared/types';
import type { IpcApi } from '@shared/ipc';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

function mount(state: AgentAccessState, agentAccess: Partial<IpcApi['agentAccess']> = {}) {
  installAtelierMock({ agentAccess });
  render(<SetupCapabilities state={state} />);
}

describe('Setup & capabilities', () => {
  it('turns Agent Access on through main, and off at once', async () => {
    const requestEnable = vi.fn(async () => ({ enabled: true }));
    const disable = vi.fn(async () => ({ enabled: false as const }));
    mount(agentState({ enabled: false }), { requestEnable, disable });
    expect(screen.getByTestId('agent-access-status').textContent).toBe('Agent Access is off');
    fireEvent.click(screen.getByRole('switch', { name: 'Agent Access' }));
    await waitFor(() => expect(requestEnable).toHaveBeenCalled());
    uninstallAtelierMock();
    document.body.textContent = '';
    mount(agentState(), { requestEnable, disable });
    fireEvent.click(screen.getByRole('switch', { name: 'Agent Access' }));
    await waitFor(() => expect(disable).toHaveBeenCalled());
  });

  it('shows the bridge and removes it, saying so when main refuses', async () => {
    const removeBridge = vi.fn(async () => {
      throw Object.assign(new Error('Turn off Agent Access before removing the bridge.'), { code: 'CONFLICT' });
    });
    mount(agentState(), { removeBridge });
    expect(screen.getByTestId('agents-bridge-state').textContent).toBe('Installed');
    expect(screen.getByText('/bridge/latelier-agent-bridge')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove bridge' }));
    expect(await screen.findByText(/Turn off Agent Access before removing the bridge/)).toBeTruthy();
  });

  it('keeps troubleshooting collapsed, with the socket and the Windows pipe caveat', async () => {
    mount(agentState({ platformCaveat: 'windows-pipe' }));
    const toggle = screen.getByRole('button', { name: /Troubleshooting/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('/tmp/latelier.sock')).toBeTruthy();
    expect(screen.getByTestId('agent-windows-caveat').textContent).toMatch(/named pipe/);
  });

  it("lists X30's tool groups, the limits, what an Agent never does and prompts that work", () => {
    mount(agentState({ bridgeInstalled: false }));
    expect(screen.getByTestId('agents-bridge-state').textContent).toBe('Not installed');
    expect(screen.queryByRole('button', { name: 'Remove bridge' })).toBeNull();
    for (const group of ['Explore', 'Read', 'Check', 'Relations', 'Propose']) {
      expect(screen.getByRole('heading', { level: 3, name: group })).toBeTruthy();
    }
    expect(screen.getByText('propose_reference_rule')).toBeTruthy();
    expect(screen.getByText('explain_find · explain_aggregate')).toBeTruthy();
    expect(screen.getByText('50 / 200')).toBeTruthy();
    expect(screen.getByText('2 + 4')).toBeTruthy();
    expect(screen.getByText('Run $out or $merge')).toBeTruthy();
    expect(screen.getByText('Read admin, local, config or system.*')).toBeTruthy();
    expect(screen.getByText('“Propose Reference Rules for shop.orders”')).toBeTruthy();
  });
});
