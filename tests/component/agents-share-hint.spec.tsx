// The agents.share hint (X06 §4, X30 §12): offered on a collection tab of an
// open Connection while Agent Access is off and nothing is shared, anchored on
// the sidebar's Agents mode switch; its Set up opens Agents mode on Home.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, waitFor, within } from '../helpers/render';
import { HintsProvider } from '../../src/hints/HintsProvider';
import { HINT_REGISTRY } from '../../src/hints/registry';
import Workspace from '../../src/pages/Workspace';
import { SettingsProvider } from '../../src/pages/SettingsContext';
import { installAtelierMock, uninstallAtelierMock, AGENT_ACCESS_OFF } from '../helpers/atelierMock';
import type { AgentAccessState, CollectionTab, ConnectionSummary, FeatureHintDismissalState, FeatureHintId } from '@shared/types';

const HINTS_KEY = 'ui.hints.dismissed';
const SETTLE_WAIT_MS = 1800;
const TITLE = HINT_REGISTRY['agents.share'].title;
// Every other hint a collection tab can raise, so this one is not waiting behind them.
const OTHERS: FeatureHintId[] = ['run.execute', 'refs.configure', 'tabs.pin', 'saved.create', 'palette.discover', 'startup.restore', 'find.options'];

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

const settle = () => new Promise((r) => setTimeout(r, SETTLE_WAIT_MS));
const hint = () => screen.queryByRole('dialog', { name: TITLE });

const now = '2026-06-01T12:00:00.000Z';
const tab: CollectionTab = {
  id: 't1',
  kind: 'collection',
  connectionId: 'c1',
  dbName: 'mydb',
  collection: 'users',
  position: 0,
  isActive: true,
  openedAt: now,
  pinned: false,
  state: {
    view: 'Tree',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
  },
};
const conn = (over: Partial<ConnectionSummary> = {}): ConnectionSummary => ({
  id: 'c1',
  name: 'Local',
  color: '#1A6835',
  host: 'localhost',
  port: 27017,
  connectionType: 'standard',
  readOnly: false,
  status: 'connected',
  shareWithAgents: false,
  ...over,
});

function mount({ state = AGENT_ACCESS_OFF, connection = conn() }: { state?: AgentAccessState; connection?: ConnectionSummary } = {}) {
  const store = new Map<string, unknown>([[HINTS_KEY, { dismissedIds: OTHERS } satisfies FeatureHintDismissalState]]);
  const prefs = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return value;
    }),
  };
  installAtelierMock({
    prefs: prefs as never,
    tabs: { list: async () => [tab], setActive: async (id) => ({ id }), update: async () => tab },
    conn: { list: async () => [connection] },
    agentAccess: { getState: async () => state } as never,
    query: {
      find: async () => ({ documents: [], durationMs: 1, hasMore: false }),
      count: async () => ({ count: 0 }),
    },
  });
  render(
    <MemoryRouter initialEntries={['/workspace']}>
      <SettingsProvider>
        <HintsProvider>
          <Workspace />
        </HintsProvider>
      </SettingsProvider>
    </MemoryRouter>,
  );
  return prefs;
}

describe('agents.share hint', () => {
  it('shows on a collection tab of an open Connection, anchored on the Agents side of the mode switch', async () => {
    mount();
    const dialog = await waitFor(() => screen.getByRole('dialog', { name: TITLE }), { timeout: 3000 });
    const anchor = document.querySelector('[data-hint-anchor="agents.share"]');
    expect(anchor).toBe(within(screen.getByRole('tablist', { name: 'Sidebar mode' })).getByRole('tab', { name: /Agents/ }));
    // Below the switch, which sits at the top of the sidebar.
    expect(dialog.style.top).not.toBe('');
    expect(screen.queryByTestId('agent-status')).toBeNull();
  });

  it('opens Agents mode on Home from its call to action, and stays dismissed', async () => {
    const prefs = mount();
    const dialog = await waitFor(() => screen.getByRole('dialog', { name: TITLE }), { timeout: 3000 });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Set up' }));
    expect((await screen.findByTestId('agents-tab')).getAttribute('aria-label')).toBe('Agents · Home');
    const modes = screen.getByRole('tablist', { name: 'Sidebar mode' });
    expect(within(modes).getByRole('tab', { name: /Agents/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
    await waitFor(() => expect(hint()).toBeNull());
    await waitFor(() =>
      expect(prefs.set).toHaveBeenCalledWith(HINTS_KEY, expect.objectContaining({ dismissedIds: expect.arrayContaining(['agents.share']) })),
    );
  });

  it('stays hidden while Agent Access is on', async () => {
    mount({ state: { ...AGENT_ACCESS_OFF, enabled: true } });
    await screen.findByRole('tablist', { name: 'Sidebar mode' });
    await settle();
    expect(hint()).toBeNull();
  });

  it('stays hidden once a Connection is shared', async () => {
    mount({ connection: conn({ shareWithAgents: true }) });
    await screen.findByRole('tablist', { name: 'Sidebar mode' });
    await settle();
    expect(hint()).toBeNull();
  });

  it('stays hidden while the Connection is not open', async () => {
    mount({ connection: conn({ status: 'disconnected' }) });
    await screen.findByRole('tablist', { name: 'Open tabs' });
    await settle();
    expect(hint()).toBeNull();
  });
});
