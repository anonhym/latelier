// Where sharing with Agents is reached from Databases mode (X30 §10.2): the
// navigator root menu only. The status-bar control and the Settings shared
// list are gone; Agents Home holds the list and the Shared switch.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, act, within, navigatorRoot } from '../helpers/render';
import { installAtelierMock, uninstallAtelierMock, connectionFixture, AGENT_ACCESS_OFF } from '../helpers/atelierMock';
import { StatusBar } from '../../src/pages/Workspace/StatusBar';
import { SettingsProvider } from '../../src/pages/SettingsContext';
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

describe('the status bar', () => {
  it('carries no Agents control, on or off, shared or not', async () => {
    for (const [state, conn] of [
      [AGENT_ACCESS_OFF, prod()],
      [ON, prod({ shareWithAgents: true })],
    ] as const) {
      installAtelierMock({
        prefs: { get: async () => null, set: async (_k: string, v: unknown) => v } as never,
        agentAccess: { getState: async () => state } as never,
      });
      const view = render(
        <HintsProvider>
          <SettingsProvider>
            <StatusBar connection={conn} />
          </SettingsProvider>
        </HintsProvider>,
      );
      await act(async () => {});
      expect(screen.queryByTestId('agent-status')).toBeNull();
      expect(screen.queryByRole('button', { name: /Agent/ })).toBeNull();
      expect(screen.queryByText(/Agents/)).toBeNull();
      view.unmount();
      uninstallAtelierMock();
    }
  });
});

describe('the navigator root menu (X27 §12.3, kept by X30 §10.2)', () => {
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

  it('draws the shared marker before the Connection name, not after it', async () => {
    mountNavigator(prod({ shareWithAgents: true }));
    const root = navigatorRoot('Prod');
    const marker = await within(root).findByTestId('share-marker');
    const name = within(root).getByText('Prod');
    expect(marker.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
