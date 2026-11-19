import { describe, it, expect, vi, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor, within } from '../helpers/render';
import { installAtelierMock, uninstallAtelierMock, AGENT_ACCESS_OFF } from '../helpers/atelierMock';
import { HintsProvider } from '../../src/hints/HintsProvider';
import { SettingsModal } from '../../src/pages/SettingsModal';
import type { AgentAccessState } from '../../shared/types';

afterEach(uninstallAtelierMock);

const ON: AgentAccessState = {
  ...AGENT_ACCESS_OFF,
  enabled: true,
  socketPath: '/tmp/latelier-agent.sock',
  sessionReadCount: 3,
  sessionCount: 1,
  tokens: [
    { id: 't2', name: 'Zed', createdAt: '2026-11-18T00:00:00.000Z' },
    { id: 't1', name: 'Claude Code', createdAt: '2026-11-18T00:00:00.000Z', lastUsedAt: '2026-11-19T00:00:00.000Z' },
  ],
};

function mount(state: AgentAccessState, agentAccess: Record<string, unknown> = {}) {
  installAtelierMock({
    prefs: { get: async () => null, set: async (_k: string, v: unknown) => v } as never,
    agentAccess: { getState: async () => state, ...agentAccess } as never,
  });
  return render(
    <HintsProvider>
      <SettingsModal initialSection="agents" onClose={() => {}} />
    </HintsProvider>,
  );
}

describe('Settings: Agent Access', () => {
  it('off: the switch is unchecked, no socket or read count, and turning it on asks main', async () => {
    const requestEnable = vi.fn(async () => ({ enabled: false }));
    mount(AGENT_ACCESS_OFF, { requestEnable });
    const sw = await screen.findByRole('switch', { name: 'Agent Access' });
    expect((sw as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText('Agents can connect')).toBeNull();
    expect(screen.queryByText(/reads? this session/)).toBeNull();
    await userEvent.click(sw);
    expect(requestEnable).toHaveBeenCalledTimes(1);
    // A cancelled dialog leaves it off: the switch follows the state, not the click.
    expect((sw as HTMLInputElement).checked).toBe(false);
  });

  it('on: shows the socket path, the read count and the tokens sorted by name', async () => {
    mount(ON);
    expect(await screen.findByText('Agents can connect')).toBeTruthy();
    expect(screen.getByText('/tmp/latelier-agent.sock')).toBeTruthy();
    expect(screen.getByText('3 Agent reads this session')).toBeTruthy();
    const rows = within(screen.getByRole('table', { name: 'Agents' })).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['Claude Code', 'Zed']);
    expect(within(rows[1]).getByText('Never')).toBeTruthy();
    expect((screen.getByRole('switch', { name: 'Agent Access' }) as HTMLInputElement).checked).toBe(true);
  });

  it('Regenerate, Revoke and turning off go to main by token id', async () => {
    const regenerateToken = vi.fn(async ({ id }: { id: string }) => ({ id, name: 'x', createdAt: '' }));
    const revokeToken = vi.fn(async () => ({ ok: true as const }));
    const disable = vi.fn(async () => ({ enabled: false as const }));
    mount(ON, { regenerateToken, revokeToken, disable });
    await userEvent.click(await screen.findByRole('button', { name: 'Regenerate Zed' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revoke Claude Code' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Agent Access' }));
    await waitFor(() => expect(disable).toHaveBeenCalled());
    expect(regenerateToken).toHaveBeenCalledWith({ id: 't2' });
    expect(revokeToken).toHaveBeenCalledWith({ id: 't1' });
  });

  it('Add Agent sends the trimmed name and offers no empty submit', async () => {
    const addToken = vi.fn(async ({ name }: { name: string }) => ({ id: 'n', name, createdAt: '' }));
    mount(ON, { addToken });
    await userEvent.click(await screen.findByRole('button', { name: 'Add Agent' }));
    const add = screen.getByRole('button', { name: 'Add' });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByRole('textbox', { name: 'Agent name' }), '  Cursor  ');
    await userEvent.click(add);
    await waitFor(() => expect(addToken).toHaveBeenCalledWith({ name: 'Cursor' }));
  });

  it('never renders a token: the DOM carries only what getState returned', async () => {
    const SECRET = 'tok_SECRET_abcdefghijklmnop';
    // A token reaching the renderer would have to arrive on a state object or an add result.
    const addToken = vi.fn(async ({ name }: { name: string }) => ({ id: 'n', name, createdAt: '', token: SECRET }));
    const { baseElement } = mount({ ...ON, tokens: [{ ...ON.tokens[0], token: SECRET } as never] }, { addToken });
    await screen.findByText('Agents can connect');
    await userEvent.click(screen.getByRole('button', { name: 'Add Agent' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Agent name' }), 'Cursor');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(addToken).toHaveBeenCalled());
    expect(baseElement.innerHTML).not.toContain(SECRET);
  });

  it('Windows caveat shows only on the pipe platform; Remove bridge only while off and installed', async () => {
    const removeBridge = vi.fn(async () => ({ removed: true }));
    const view = mount({ ...AGENT_ACCESS_OFF, platformCaveat: 'windows-pipe', bridgeInstalled: true }, { removeBridge });
    expect(await screen.findByTestId('agent-windows-caveat')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Remove bridge' }));
    expect(removeBridge).toHaveBeenCalledTimes(1);
    view.unmount();
    uninstallAtelierMock();
    mount({ ...ON, bridgeInstalled: true });
    await screen.findByText('Agents can connect');
    expect(screen.queryByRole('button', { name: 'Remove bridge' })).toBeNull();
    expect(screen.queryByTestId('agent-windows-caveat')).toBeNull();
  });

  it('states what Agents can and cannot do, in the agreed terms', async () => {
    mount(AGENT_ACCESS_OFF);
    await screen.findByText('What Agents can do');
    expect(screen.getByText('What Agents cannot do')).toBeTruthy();
    expect(screen.getByText(/read-only database user/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/assistant|\bbot\b|AI mode/i);
  });
});
