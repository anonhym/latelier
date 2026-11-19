import { describe, it, expect, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, act } from '../helpers/render';
import { installAtelierMock, uninstallAtelierMock, AGENT_ACCESS_OFF } from '../helpers/atelierMock';
import { StatusBar } from '../../src/pages/Workspace/StatusBar';
import { AgentStatusIndicator } from '../../src/features/agentAccess/AgentStatusIndicator';
import { SettingsProvider } from '../../src/pages/SettingsContext';
import { HintsProvider } from '../../src/hints/HintsProvider';
import type { AgentAccessState } from '../../shared/types';

afterEach(uninstallAtelierMock);

function mountBar(state: AgentAccessState, agentAccess: Record<string, unknown> = {}) {
  installAtelierMock({
    prefs: { get: async () => null, set: async (_k: string, v: unknown) => v } as never,
    agentAccess: { getState: async () => state, ...agentAccess } as never,
  });
  return render(
    <HintsProvider>
      <SettingsProvider>
        <StatusBar connection={null} />
      </SettingsProvider>
    </HintsProvider>,
  );
}

describe('AgentStatusIndicator', () => {
  it('shows nothing while Agent Access is off', async () => {
    mountBar(AGENT_ACCESS_OFF);
    await screen.findByTestId('status-bar');
    await act(async () => {});
    expect(screen.queryByTestId('agent-status')).toBeNull();
  });

  it('shows the session read count in a labelled button while on', async () => {
    mountBar({ ...AGENT_ACCESS_OFF, enabled: true, sessionReadCount: 4 });
    const btn = await screen.findByRole('button', { name: 'Agent Access: 4 reads this session' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.textContent).toBe('Agents · 4');
  });

  it('follows main\'s push: appears on enable, updates the count, hides on disable', async () => {
    let push: (s: AgentAccessState) => void = () => {};
    mountBar(AGENT_ACCESS_OFF, { onState: (cb: (s: AgentAccessState) => void) => { push = cb; return () => {}; } });
    await act(async () => {});
    act(() => push({ ...AGENT_ACCESS_OFF, enabled: true, sessionReadCount: 1 }));
    expect(screen.getByRole('button', { name: 'Agent Access: 1 read this session' })).toBeTruthy();
    act(() => push({ ...AGENT_ACCESS_OFF, enabled: true, sessionReadCount: 2 }));
    expect(screen.getByRole('button', { name: 'Agent Access: 2 reads this session' })).toBeTruthy();
    act(() => push(AGENT_ACCESS_OFF));
    expect(screen.queryByTestId('agent-status')).toBeNull();
  });

  it('click and keyboard open Settings on the Agent Access section', async () => {
    installAtelierMock({
      prefs: { get: async () => null, set: async (_k: string, v: unknown) => v } as never,
      agentAccess: { getState: async () => ({ ...AGENT_ACCESS_OFF, enabled: true }) } as never,
    });
    render(
      <HintsProvider>
        <SettingsProvider>
          <AgentStatusIndicator />
        </SettingsProvider>
      </HintsProvider>,
    );
    const btn = await screen.findByTestId('agent-status');
    btn.focus();
    await userEvent.keyboard('{Enter}');
    const tab = await screen.findByRole('tab', { name: 'Agent Access' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
  });
});
