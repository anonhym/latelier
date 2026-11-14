import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, titleBar, waitFor, act, fireEvent } from '../helpers/render';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import ConnectionManager from '../../src/pages/ConnectionManager';
import { notify } from '../../src/theme/notifications';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { ConnectionSummary, CollectionTab, ServerTab } from '@shared/types';

const now = '2026-07-31T12:00:00.000Z';

function conn(overrides: Partial<ConnectionSummary> = {}): ConnectionSummary {
  return {
    id: 'c1',
    name: 'Prod',
    color: '#1A6835',
    host: 'localhost',
    port: 27017,
    connectionType: 'standard',
    readOnly: false,
    status: 'connected',
    ...overrides,
  };
}

const CONNECTIONS: ConnectionSummary[] = [
  conn({ id: 'c1', name: 'Prod' }),
  conn({ id: 'c9', name: 'Legacy Reporting' }),
];

function collectionTab(overrides: Partial<CollectionTab> = {}): CollectionTab {
  return {
    id: 't1',
    kind: 'collection',
    connectionId: 'c1',
    dbName: 'db',
    collection: 'orders',
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
    ...overrides,
  };
}

/** The TitleBar lives in the AppShell header; scope queries to it. */
function app(initialEntries: Array<string | { pathname: string; state: unknown }>) {
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/workspace" element={<Workspace />} />
        <Route path="/connections/:id" element={<div>connection detail screen</div>} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('"Open workspace" / openConnectionId nav-state', () => {
  it('a fresh mount onto the Connection that already owns the open tabs keeps them, and connects', async () => {
    // DetailPanel's "Open workspace" / row double-click always mounts
    // Workspace fresh (the whole point of this nav-state key). At that
    // instant `useWorkspaceTabs()`'s first `refresh()` hasn't resolved, and
    // deciding "already on this Connection" too early used to destroy every
    // persisted tab. X16.4 deletes the decision along with the
    // teardown it fed: arriving connects, and closes nothing, ever.
    const closeSpy = vi.fn(async () => undefined as never);
    const connect = vi.fn(async (id: string) => ({ id, status: 'connecting' as const }));
    installAtelierMock({
      tabs: {
        list: async () => [collectionTab({ id: 't-c1', connectionId: 'c1' })],
        close: closeSpy,
      },
      conn: { list: async () => CONNECTIONS },
      mongo: { connect },
    });

    render(app([{ pathname: '/workspace', state: { openConnectionId: 'c1' } }]));

    await waitFor(() => expect(titleBar().getByText('Prod')).toBeTruthy());
    // Give any (bugged) in-flight tab teardown a chance to actually run.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await new Promise((r) => setTimeout(r, 20));

    expect(closeSpy).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Close orders')).toBeTruthy();
    // The other defect this covers: this flow never called `api.mongo.connect`.
    await waitFor(() => expect(connect).toHaveBeenCalledWith('c1'));
  });

  it('a fresh mount onto a DIFFERENT Connection leaves the other one\'s tabs open', async () => {
    // X16.4 — the inverse of what this test used to assert. Arriving
    // at c1 with tabs open on c9 used to close them, because one Connection
    // owned the Data View. Two Connections now coexist: c9's tab is still on
    // screen, and c1 is merely connected.
    const closeSpy = vi.fn(async () => undefined as never);
    const connect = vi.fn(async (id: string) => ({ id, status: 'connecting' as const }));
    installAtelierMock({
      tabs: {
        list: async () => [
          collectionTab({ id: 't-c9', connectionId: 'c9', collection: 'invoices' }),
        ],
        close: closeSpy,
      },
      conn: { list: async () => CONNECTIONS },
      mongo: { connect },
    });

    render(app([{ pathname: '/workspace', state: { openConnectionId: 'c1' } }]));

    await waitFor(() => expect(connect).toHaveBeenCalledWith('c1'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await new Promise((r) => setTimeout(r, 20));

    expect(closeSpy).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Close invoices')).toBeTruthy();
    // The Focused Tab is still c9's, so the TitleBar still names it — the
    // Connection just opened is not "where you are".
    expect(titleBar().getByText('Legacy Reporting')).toBeTruthy();
  });

  it('a connect that FAILS closes no tabs — not its own, not the other Connection\'s', async () => {
    // X16.6, spec §4.2 — "a transient outage should cost you nothing".
    // Two Connections with a tab each, and the connect rejects: both tabs are
    // still there afterwards, and nothing was closed on either.
    const closeSpy = vi.fn(async () => undefined as never);
    const connect = vi.fn(async () => {
      throw { code: 'DB_ERROR', message: 'getaddrinfo ENOTFOUND prod.internal' };
    });
    installAtelierMock({
      tabs: {
        list: async () => [
          collectionTab({ id: 't-c1', connectionId: 'c1', collection: 'orders' }),
          collectionTab({
            id: 't-c9',
            connectionId: 'c9',
            collection: 'invoices',
            position: 1,
            isActive: false,
          }),
        ],
        close: closeSpy,
      },
      conn: { list: async () => CONNECTIONS },
      mongo: { connect: connect as never },
    });

    render(app([{ pathname: '/workspace', state: { openConnectionId: 'c1' } }]));

    await waitFor(() => expect(connect).toHaveBeenCalledWith('c1'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await new Promise((r) => setTimeout(r, 20));

    expect(closeSpy).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Close orders')).toBeTruthy();
    expect(screen.getByLabelText('Close invoices')).toBeTruthy();
  });

  it('opens the collection the nav state names, on the Connection it names', async () => {
    // The `openCollection` half of the same intent: DetailPanel's per-row
    // "Open" carries a namespace, and that is the one path that still creates
    // a tab. An earlier revision kept it and dropped the teardown that used to precede it.
    const openCollection = vi.fn(async () => collectionTab({ id: 't-new', connectionId: 'c1' }));
    const connect = vi.fn(async (id: string) => ({ id, status: 'connecting' as const }));
    installAtelierMock({
      tabs: {
        list: async () => [collectionTab({ id: 't-c9', connectionId: 'c9', collection: 'invoices' })],
        openCollection: openCollection as never,
      },
      conn: { list: async () => CONNECTIONS },
      mongo: { connect },
    });

    render(
      app([
        {
          pathname: '/workspace',
          state: {
            openConnectionId: 'c1',
            openCollection: { dbName: 'shop', collection: 'orders' },
          },
        },
      ]),
    );

    await waitFor(() =>
      expect(openCollection).toHaveBeenCalledWith({
        connectionId: 'c1',
        dbName: 'shop',
        collection: 'orders',
      }),
    );
  });
});

function serverTab(overrides: Partial<ServerTab> = {}): ServerTab {
  return {
    id: 's1',
    kind: 'server',
    connectionId: 'c1',
    dbName: '',
    collection: '',
    position: 0,
    isActive: true,
    openedAt: now,
    pinned: false,
    state: { section: 'overview' },
    ...overrides,
  };
}

const serverMongo = {
  status: async (id: string) => ({ id, status: 'connected' as const }),
  onStatus: () => () => {},
  serverInfo: async () => ({
    version: '7.0.5',
    uptimeSeconds: 1,
    connectionsCurrent: 1,
    connectionsAvailable: 1,
    opcountersPerSec: 1,
    databaseCount: 1,
    dataSizeBytes: 1,
    storageSizeBytes: 1,
    indexCount: 1,
    topology: 'Single' as const,
    serverStatsAvailable: true,
  }),
};

describe('server tab (C05 §11)', () => {
  it('an openServer route intent opens that Connection\'s server tab on the section named', async () => {
    const openServer = vi.fn(async (input: { connectionId: string }) => serverTab({ connectionId: input.connectionId }));
    const update = vi.fn(async () => serverTab({ state: { section: 'users' } }));
    installAtelierMock({
      tabs: { list: async () => [], openServer: openServer as never, update: update as never },
      conn: { list: async () => CONNECTIONS },
      mongo: serverMongo,
    });

    render(app([{ pathname: '/workspace', state: { openServer: { connectionId: 'c9', section: 'users' } } }]));

    await waitFor(() => expect(openServer).toHaveBeenCalledWith({ connectionId: 'c9' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('s1', { state: { section: 'users' } }));
  });

  it('an unknown id opens no tab and says the connection no longer exists', async () => {
    const openServer = vi.fn(async () => serverTab());
    const error = vi.spyOn(notify, 'error').mockImplementation(() => undefined as never);
    installAtelierMock({
      tabs: { list: async () => [], openServer: openServer as never },
      conn: { list: async () => CONNECTIONS },
      mongo: serverMongo,
    });

    render(app([{ pathname: '/workspace', state: { openServer: { connectionId: 'gone' } } }]));

    await waitFor(() => expect(error).toHaveBeenCalledWith('This connection no longer exists.'));
    expect(openServer).not.toHaveBeenCalled();
  });

  it('a server tab shows its sections inside the workspace, labelled Server, on the section it stored', async () => {
    const update = vi.fn(async () => serverTab({ state: { section: 'monitor' } }));
    installAtelierMock({
      tabs: {
        list: async () => [serverTab({ state: { section: 'roles' } })],
        update: update as never,
      },
      conn: { list: async () => CONNECTIONS },
      mongo: serverMongo,
    });

    render(app([{ pathname: '/workspace', state: null }]));

    const roles = await screen.findByRole('button', { name: 'Roles' });
    expect(roles.style.fontWeight).toBe('600');
    for (const name of ['Overview', 'Monitor', 'Collections', 'Users']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.getByLabelText('Close Server')).toBeTruthy();
    expect(titleBar().getByText('Server')).toBeTruthy();
    // Edit, Disconnect and Delete belong to Overview.
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Monitor' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Monitor' }).style.fontWeight).toBe('600'));
    await waitFor(() => expect(update).toHaveBeenCalledWith('s1', { state: { section: 'monitor' } }));
  });

  it('a Dormant Connection\'s server tab shows Overview with Connect', async () => {
    installAtelierMock({
      tabs: { list: async () => [serverTab()] },
      conn: { list: async () => [conn({ id: 'c1', name: 'Prod', status: 'unknown' })] },
      mongo: { ...serverMongo, status: async (id: string) => ({ id, status: 'disconnected' as const }) },
    });

    render(app([{ pathname: '/workspace', state: null }]));

    expect(await screen.findByRole('button', { name: 'Connect' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Overview' }).style.fontWeight).toBe('600');
  });

  it('/connections/:id redirects to the Data View with the open-server intent', async () => {
    const openServer = vi.fn(async (input: { connectionId: string }) => serverTab({ connectionId: input.connectionId }));
    installAtelierMock({
      tabs: { list: async () => [], openServer: openServer as never },
      conn: { list: async () => CONNECTIONS },
      mongo: serverMongo,
    });

    render(
      <MemoryRouter initialEntries={['/connections/c1']}>
        <Routes>
          <Route path="/workspace" element={<Workspace />} />
          <Route path="/connections/:id" element={<ConnectionManager />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(openServer).toHaveBeenCalledWith({ connectionId: 'c1' }));
  });
});
