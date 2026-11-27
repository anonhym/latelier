// The sidebar's mode switch (X30 §2): Databases | Agents, the Needs you badge,
// the stored mode, ⌘⇧A (never under a dialog) and the tablist's arrow keys.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '../helpers/render';
import { uninstallAtelierMock } from '../helpers/atelierMock';
import { agentState, mountAgentsWorkspace } from '../helpers/agentsWorkspace';
import type { AgentConnectionRequest } from '@shared/types';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

const request = (sessionId: string): AgentConnectionRequest => ({
  sessionId,
  tokenName: 'laptop-claude',
  clientName: 'claude-code',
  folder: null,
  connectionId: 'c1',
  connectionName: 'Prod',
  firstAt: '2026-11-27T10:00:00.000Z',
  lastAt: '2026-11-27T10:00:00.000Z',
  count: 1,
  lastTool: 'find',
  database: 'shop',
  collection: 'orders',
  lastOutcome: 'refused',
});

const switcher = () => screen.findByRole('tablist', { name: 'Sidebar mode' });
const agentsSegment = async () => within(await switcher()).getByRole('tab', { name: /^Agents/ });
const databasesSegment = async () => within(await switcher()).getByRole('tab', { name: /^Databases/ });
const pressModeKey = (target: Element | Window = window) =>
  fireEvent.keyDown(target, { key: 'A', code: 'KeyA', metaKey: true, shiftKey: true });

describe('the sidebar mode switch', () => {
  it('shows the Needs you count on Agents, named for screen readers, and nothing at zero', async () => {
    const ws = mountAgentsWorkspace({ state: agentState({ connectionRequests: [request('s1'), request('s2')] }) });
    await waitFor(async () => expect((await agentsSegment()).textContent).toContain('2'));
    expect(within(await switcher()).getByRole('tab', { name: /2 Agent requests/ })).toBe(await agentsSegment());
    ws.push(agentState({ connectionRequests: [] }));
    await waitFor(async () => expect(within(await agentsSegment()).queryByTestId('needs-you-badge')).toBeNull());
    expect(within(await switcher()).getByRole('tab', { name: 'Agents' })).toBe(await agentsSegment());
  });

  it('is shown while Agent Access is off, starting on Databases', async () => {
    mountAgentsWorkspace({ state: agentState({ enabled: false }) });
    expect((await databasesSegment()).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByTestId('agents-sidebar')).toBeNull();
  });

  it('stores the mode, and a stored Agents mode opens on the Agents sidebar without the Agents tab', async () => {
    const ws = mountAgentsWorkspace();
    fireEvent.click(await agentsSegment());
    expect(await screen.findByTestId('agents-sidebar')).toBeTruthy();
    expect(ws.prefs.set).toHaveBeenCalledWith('sidebar.mode', 'agents');
    uninstallAtelierMock();
    document.body.innerHTML = '';

    mountAgentsWorkspace({ prefs: { 'sidebar.mode': 'agents' } });
    expect(await screen.findByTestId('agents-sidebar')).toBeTruthy();
    // After a relaunch the Agents tab is absent until the user asks for it.
    expect(screen.queryByTestId('agents-tab')).toBeNull();
  });

  it('⌘⇧A toggles the mode and moves focus into the sidebar', async () => {
    mountAgentsWorkspace();
    await switcher();
    pressModeKey();
    expect(await screen.findByTestId('agents-sidebar')).toBeTruthy();
    await waitFor(async () => expect(document.activeElement).toBe(await agentsSegment()));
    pressModeKey();
    await waitFor(() => expect(screen.queryByTestId('agents-sidebar')).toBeNull());
    await waitFor(async () => expect(document.activeElement).toBe(await databasesSegment()));
  });

  it('⌘⇧A opens a collapsed sidebar before focusing it', async () => {
    mountAgentsWorkspace({ prefs: { 'ui.workspace.sidebarCollapsed': true } });
    await screen.findByRole('tablist', { name: 'Open tabs' });
    expect(screen.queryByRole('tablist', { name: 'Sidebar mode' })).toBeNull();
    pressModeKey();
    await waitFor(async () => expect(document.activeElement).toBe(await agentsSegment()));
  });

  it('does nothing under an open dialog', async () => {
    mountAgentsWorkspace();
    await switcher();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const input = document.createElement('input');
    dialog.appendChild(input);
    document.body.appendChild(dialog);
    input.focus();
    pressModeKey(input);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('agents-sidebar')).toBeNull();
    expect((await databasesSegment()).getAttribute('aria-selected')).toBe('true');
    dialog.remove();
  });

  it('is one tab stop, and the arrow keys move and choose', async () => {
    mountAgentsWorkspace();
    const dbs = await databasesSegment();
    const agents = await agentsSegment();
    expect(dbs.tabIndex).toBe(0);
    expect(agents.tabIndex).toBe(-1);
    dbs.focus();
    fireEvent.keyDown(dbs, { key: 'ArrowRight' });
    expect(await screen.findByTestId('agents-sidebar')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(agents));
    expect(agents.tabIndex).toBe(0);
    fireEvent.keyDown(agents, { key: 'ArrowLeft' });
    await waitFor(() => expect(screen.queryByTestId('agents-sidebar')).toBeNull());
    expect(document.activeElement).toBe(dbs);
  });

  it('opens the Agents tab on Home when switching to Agents, and steps it back on Databases', async () => {
    mountAgentsWorkspace();
    fireEvent.click(await agentsSegment());
    const tab = await screen.findByTestId('agents-tab');
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Agents · Home' })).toBe(tab);
    expect(await screen.findByTestId('agents-home')).toBeTruthy();
    fireEvent.click(await databasesSegment());
    await waitFor(() => expect(screen.getByTestId('agents-tab').getAttribute('aria-selected')).toBe('false'));
    expect(screen.queryByTestId('agents-home')).toBeNull();
  });
});
