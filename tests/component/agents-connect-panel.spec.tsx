// Connect an Agent (X30 §6): "copied" only once main resolves, a cancel leaves
// step 1, a second Copy regenerates the same Agent, "Connected" on its first
// session, and never a token in the DOM.
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '../helpers/render';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { agentState, liveSession, token } from '../helpers/agentsWorkspace';
import { ConnectAgentPanel } from '../../src/features/agents/ConnectAgentPanel';
import { useAgentsTab } from '../../src/features/agents/useAgentsTab';
import type { AgentsPage } from '../../src/features/agents/agentsPage';
import type { AgentAccessState, AgentCopyResult } from '@shared/types';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

/** A real-looking token that must never reach the screen. */
const SECRET = 'lat_agent_1234567890abcdefSECRET';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/**
 * The panel as the Agents tab draws it: its state lives in `useAgentsTab`,
 * above the panel, and `shown` false stands for any page or tab in front of it.
 */
function Tab({ state, tokenId, shown, onNavigate }: { state: AgentAccessState; tokenId?: string; shown: boolean; onNavigate: (p: AgentsPage) => void }) {
  const tab = useAgentsTab();
  const { show } = tab;
  React.useEffect(() => show(tokenId ? { kind: 'connect', tokenId } : { kind: 'connect' }), [show, tokenId]);
  if (!shown || !tab.open || tab.page.kind !== 'connect') return null;
  return <ConnectAgentPanel state={state} tokenId={tab.page.tokenId} drafts={tab.connectDrafts} onAction={tab.connectAction} onNavigate={onNavigate} />;
}

function mount(state: AgentAccessState = agentState(), tokenId?: string) {
  const connect = deferred<AgentCopyResult>();
  const connectClient = vi.fn(() => connect.promise);
  const copySetup = vi.fn(async ({ id }: { id: string }) => ({ tokenId: id, copiedAt: '2026-11-27T11:30:00.000Z' }));
  installAtelierMock({ agentAccess: { connectClient, copySetup } });
  const onNavigate = vi.fn();
  let current = state;
  const view = render(<Tab state={state} tokenId={tokenId} shown onNavigate={onNavigate} />);
  return {
    connect,
    connectClient,
    copySetup,
    onNavigate,
    rerender: (next: AgentAccessState) => {
      current = next;
      view.rerender(<Tab state={next} tokenId={tokenId} shown onNavigate={onNavigate} />);
    },
    setShown: (shown: boolean) => view.rerender(<Tab state={current} tokenId={tokenId} shown={shown} onNavigate={onNavigate} />),
  };
}

const nameInput = () => screen.getByLabelText('Name') as HTMLInputElement;
const copyButton = () => within(screen.getByTestId('connect-step-1')).getByRole('button');
const chooseClient = (label: string) => fireEvent.click(within(screen.getByRole('tablist', { name: 'Client' })).getByRole('tab', { name: label }));

describe('the Connect an Agent panel', () => {
  it('reports copied only once main resolves, then turns step 1 green with the time and a toast', async () => {
    const { connect, connectClient } = mount();
    expect((copyButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(nameInput(), { target: { value: ' Work laptop ' } });
    chooseClient('Cursor');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Connect “Work laptop”');
    fireEvent.click(copyButton());
    expect(connectClient).toHaveBeenCalledWith({ name: 'Work laptop', client: 'cursor' });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('connect-copied')).toBeNull();
    expect(screen.getByTestId('connect-step-1').dataset.done).toBeUndefined();

    const copiedAt = new Date(2026, 10, 27, 11, 2).toISOString();
    await act(async () => connect.resolve({ tokenId: 'tok-1', copiedAt }));
    const copied = await screen.findByTestId('connect-copied');
    expect(copied.textContent).toContain('Copied to your clipboard at 11:02');
    expect(copied.textContent).toContain('If it is still in your clipboard at 11:07');
    expect(screen.getByTestId('connect-step-1').dataset.done).toBe('true');
    expect(await screen.findByText('Cursor setup copied')).toBeTruthy();
    expect(screen.getByText('It contains the Agent Token for “Work laptop”. Paste it into Cursor now.')).toBeTruthy();
    expect(screen.getByTestId('connect-waiting').textContent).toContain('Waiting for Cursor to connect with this token…');
  });

  it('leaves step 1 as it was on a cancel', async () => {
    const { connect } = mount();
    fireEvent.change(nameInput(), { target: { value: 'Work laptop' } });
    fireEvent.click(copyButton());
    await act(async () => connect.resolve({ cancelled: true }));
    expect(screen.queryByTestId('connect-copied')).toBeNull();
    expect(screen.queryByTestId('connect-waiting')).toBeNull();
    expect(screen.getByTestId('connect-step-1').dataset.done).toBeUndefined();
    expect(nameInput().readOnly).toBe(false);
    expect(copyButton().textContent).toBe('Copy Claude Code (command) setup…');
  });

  it('a second Copy regenerates the same Agent, never a second one', async () => {
    const { connect, connectClient, copySetup } = mount();
    fireEvent.change(nameInput(), { target: { value: 'Work laptop' } });
    fireEvent.click(copyButton());
    await act(async () => connect.resolve({ tokenId: 'tok-1', copiedAt: new Date().toISOString() }));
    await screen.findByTestId('connect-copied');
    expect(nameInput().readOnly).toBe(true);
    chooseClient('Claude Desktop');
    // The clipboard holds another client's setup: step 1 is open again.
    expect(screen.getByTestId('connect-step-1').dataset.done).toBeUndefined();
    expect(copyButton().textContent).toBe('Copy setup again…');
    fireEvent.click(copyButton());
    await waitFor(() => expect(copySetup).toHaveBeenCalledWith({ id: 'tok-1', client: 'claude-desktop' }));
    expect(connectClient).toHaveBeenCalledTimes(1);
  });

  it('keeps the panel across leaving and coming back: a second Copy regenerates, never a second Agent', async () => {
    const { connect, connectClient, copySetup, setShown } = mount();
    fireEvent.change(nameInput(), { target: { value: 'Work laptop' } });
    chooseClient('Cursor');
    fireEvent.click(copyButton());
    const copiedAt = new Date(2026, 10, 27, 11, 2).toISOString();
    await act(async () => connect.resolve({ tokenId: 'tok-1', copiedAt }));
    await screen.findByTestId('connect-copied');
    setShown(false);
    expect(screen.queryByTestId('connect-agent-panel')).toBeNull();
    setShown(true);
    expect(screen.getByTestId('connect-copied').textContent).toContain('Copied to your clipboard at 11:02');
    expect(nameInput().readOnly).toBe(true);
    fireEvent.click(copyButton());
    await waitFor(() => expect(copySetup).toHaveBeenCalledWith({ id: 'tok-1', client: 'cursor' }));
    expect(connectClient).toHaveBeenCalledTimes(1);
  });

  it('keeps a typed name across leaving before any copy', () => {
    const { setShown } = mount();
    fireEvent.change(nameInput(), { target: { value: 'Draft' } });
    setShown(false);
    setShown(true);
    expect(nameInput().value).toBe('Draft');
  });

  it('turns to Connected on the first session with that token, with a link to it', async () => {
    const { connect, rerender, onNavigate } = mount();
    fireEvent.change(nameInput(), { target: { value: 'Work laptop' } });
    fireEvent.click(copyButton());
    await act(async () => connect.resolve({ tokenId: 'tok-1', copiedAt: new Date().toISOString() }));
    rerender(agentState({ tokens: [token('tok-1', 'Work laptop')], sessions: [liveSession({ id: 'other', tokenId: 'tok-9' })] }));
    expect(screen.queryByTestId('connect-connected')).toBeNull();
    rerender(
      agentState({
        tokens: [token('tok-1', 'Work laptop')],
        sessions: [liveSession({ id: 'mine', tokenId: 'tok-1', tokenName: 'Work laptop', clientName: 'cursor', clientVersion: '1.4', folder: null })],
      }),
    );
    const connected = await screen.findByTestId('connect-connected');
    expect(connected.textContent).toContain('Connected: cursor 1.4');
    expect(screen.queryByTestId('connect-waiting')).toBeNull();
    fireEvent.click(within(connected).getByRole('button', { name: 'View session' }));
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'session', sessionId: 'mine', agentName: 'Work laptop', where: 'cursor' });
  });

  it("shows the client's setup with the placeholder, and no token ever", async () => {
    const { connect } = mount();
    const snippet = screen.getByTestId('connect-snippet');
    expect(snippet.textContent).toContain('claude mcp add latelier');
    expect(within(snippet).getByText('YOUR_TOKEN').tagName).toBe('MARK');
    chooseClient('Claude Code (JSON)');
    expect(screen.getByTestId('connect-snippet').textContent).toContain('"type":"stdio"');
    fireEvent.change(nameInput(), { target: { value: 'Work laptop' } });
    fireEvent.click(copyButton());
    await act(async () => connect.resolve({ tokenId: SECRET, copiedAt: new Date().toISOString() }));
    await screen.findByTestId('connect-copied');
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it('copies again for an existing Agent from the start', async () => {
    const { copySetup, connectClient } = mount(agentState({ tokens: [token('t-old', 'desktop')] }), 't-old');
    expect(nameInput().value).toBe('desktop');
    expect(nameInput().readOnly).toBe(true);
    fireEvent.click(copyButton());
    await waitFor(() => expect(copySetup).toHaveBeenCalledWith({ id: 't-old', client: 'claude-code-cli' }));
    expect(connectClient).not.toHaveBeenCalled();
  });

  it('goes back to Home', () => {
    const { onNavigate } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'home' });
  });
});
