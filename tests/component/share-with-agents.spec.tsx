import { describe, it, expect, vi, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, act } from '../helpers/render';
import { installAtelierMock, uninstallAtelierMock, connectionFixture, AGENT_ACCESS_OFF } from '../helpers/atelierMock';
import { ShareMarker } from '../../src/features/agentAccess/ShareMarker';
import { connectionRowMenu } from '../../src/features/connections/connectionRowMenu';
import { shareWithAgents, stopSharingWithAgents } from '../../src/features/agentAccess/useShareWithAgents';
import { privilegeText } from '../../src/features/agentAccess/agentAccessCopy';
import type { AgentAccessState, PrivilegeResult } from '../../shared/types';

afterEach(uninstallAtelierMock);

const shared = { ...connectionFixture(), id: 'c1', shareWithAgents: true };
const unshared = { ...connectionFixture(), id: 'c2', shareWithAgents: false };

function mount(conn: { id: string; shareWithAgents?: boolean }, state: AgentAccessState, onClick = vi.fn()) {
  installAtelierMock({ agentAccess: { getState: async () => state } as never });
  render(
    <div onClick={onClick} onKeyDown={onClick} role="presentation">
      <ShareMarker connection={conn} />
    </div>,
  );
  return onClick;
}

describe('ShareMarker', () => {
  it('shows only while Agent Access is on AND the Connection is shared', async () => {
    mount(shared, AGENT_ACCESS_OFF);
    await act(async () => {});
    expect(screen.queryByTestId('share-marker')).toBeNull();
  });

  it('shows nothing for an unshared Connection even while on, and reads no state', async () => {
    const getState = vi.fn(async () => ({ ...AGENT_ACCESS_OFF, enabled: true }));
    installAtelierMock({ agentAccess: { getState } as never });
    render(<ShareMarker connection={unshared} />);
    await act(async () => {});
    expect(screen.queryByTestId('share-marker')).toBeNull();
    expect(getState).not.toHaveBeenCalled();
  });

  it('shows for a shared Connection while on, spoken as an image, with "Not checked this session"', async () => {
    mount(shared, { ...AGENT_ACCESS_OFF, enabled: true });
    const marker = await screen.findByRole('img', { name: /Shared with Agents/ });
    expect(marker.getAttribute('aria-label')).toBe('Shared with Agents. Not checked this session');
  });

  it('carries the last privilege text of this run, and hovering it shows that tooltip', async () => {
    const privilege: Record<string, PrivilegeResult> = { c1: { kind: 'beyond-read', roles: ['readWrite'] } };
    mount(shared, { ...AGENT_ACCESS_OFF, enabled: true, privilege });
    const marker = await screen.findByTestId('share-marker');
    expect(marker.getAttribute('aria-label')).toContain('readWrite');
    await userEvent.hover(marker);
    expect((await screen.findByRole('tooltip')).textContent).toContain('readWrite');
  });

  it('is not interactive: a click on it reaches the row it sits in', async () => {
    const onClick = mount(shared, { ...AGENT_ACCESS_OFF, enabled: true });
    await userEvent.click(await screen.findByTestId('share-marker'));
    expect(onClick).toHaveBeenCalled();
  });

  it('privilegeText never reads a failed or unauthenticated check as a pass', () => {
    expect(privilegeText({ kind: 'read-only', roles: [] })).toBe('This user can only read.');
    expect(privilegeText({ kind: 'no-auth', roles: [] })).toMatch(/^Cannot verify/);
    expect(privilegeText({ kind: 'failed', roles: [], errorCode: 'Unauthorized' })).toContain('Unauthorized');
  });
});

describe('Share actions in the connection menu', () => {
  const base = { onManage: vi.fn(), onEdit: vi.fn(), onDisconnect: vi.fn(), onDelete: vi.fn() };
  const labels = (items: ReturnType<typeof connectionRowMenu>) =>
    items.flatMap((i) => (i.kind === 'item' ? [i.label] : []));

  it('offers Share when not shared, Stop sharing when shared, neither without the callbacks', () => {
    const onShareWithAgents = vi.fn();
    const onStopSharing = vi.fn();
    const withActions = { ...base, onShareWithAgents, onStopSharing };
    expect(labels(connectionRowMenu(unshared, withActions))).toContain('Share with Agents…');
    expect(labels(connectionRowMenu(unshared, withActions))).not.toContain('Stop sharing with Agents');
    expect(labels(connectionRowMenu(shared, withActions))).toContain('Stop sharing with Agents');
    expect(labels(connectionRowMenu(shared, withActions))).not.toContain('Share with Agents…');
    expect(labels(connectionRowMenu(unshared, base)).join()).not.toMatch(/Agents/);
    const item = connectionRowMenu(unshared, withActions).find((i) => i.kind === 'item' && i.label === 'Share with Agents…');
    if (item?.kind === 'item') item.onClick();
    expect(onShareWithAgents).toHaveBeenCalledWith('c2');
  });

  it('shareWithAgents / stopSharing ask main with the right flag', async () => {
    const setShared = vi.fn(async ({ shared: s }: { shared: boolean }) => ({ shared: s }));
    installAtelierMock({ agentAccess: { setShared } as never });
    await shareWithAgents('c2');
    await stopSharingWithAgents('c1');
    expect(setShared).toHaveBeenNthCalledWith(1, { connectionId: 'c2', shared: true });
    expect(setShared).toHaveBeenNthCalledWith(2, { connectionId: 'c1', shared: false });
  });

  it('a refusal (an SSH Connection) is surfaced, not swallowed', async () => {
    const setShared = vi.fn(async () => {
      throw { code: 'VALIDATION', message: 'A Connection that uses an SSH tunnel cannot be shared with Agents yet.' };
    });
    installAtelierMock({ agentAccess: { setShared } as never });
    render(<div />);
    await shareWithAgents('c2');
    expect(await screen.findByText(/SSH tunnel/)).toBeTruthy();
  });
});
