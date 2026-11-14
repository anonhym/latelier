import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '../helpers/render';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import ConnectionManager from '../../src/pages/ConnectionManager';
import { ServerTab } from '../../src/pages/Workspace/ServerTab';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { ConnectionSummary, ServerSection, ServerTab as ServerTabType } from '@shared/types';

// The server screen is a tab in the Data View (C05 §11): what remains of the
// old `/connections/:id` page is the redirect and the tab's own content.

function summary(overrides: Partial<ConnectionSummary> = {}): ConnectionSummary {
  return {
    id: 'a',
    name: 'Alpha',
    color: '#1A6835',
    host: 'localhost',
    port: 27017,
    connectionType: 'standard',
    readOnly: false,
    status: 'connected',
    ...overrides,
  };
}

function tabOf(section: ServerSection = 'overview'): ServerTabType {
  return {
    id: 's1',
    kind: 'server',
    connectionId: 'a',
    dbName: '',
    collection: '',
    position: 0,
    isActive: true,
    openedAt: '2026-01-01T00:00:00.000Z',
    pinned: false,
    state: { section },
  };
}

const serverInfoStub = async () => ({
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
});

function mountTab(opts: {
  connection?: ConnectionSummary | null;
  section?: ServerSection;
  status?: 'connected' | 'connecting' | 'disconnected';
  disconnect?: ReturnType<typeof vi.fn>;
}) {
  const onSection = vi.fn();
  const onDelete = vi.fn();
  const onDisconnect = vi.fn();
  const onClose = vi.fn();
  installAtelierMock({
    mongo: {
      status: async (id) => ({ id, status: opts.status ?? 'connected' }),
      onStatus: () => () => {},
      serverInfo: serverInfoStub,
      ...(opts.disconnect ? { disconnect: opts.disconnect as never } : {}),
    },
  });
  render(
    <MemoryRouter>
      <ServerTab
        tab={tabOf(opts.section)}
        connection={opts.connection === undefined ? summary() : opts.connection}
        onSection={onSection}
        onDelete={onDelete}
        onDisconnect={onDisconnect}
        onClose={onClose}
      />
    </MemoryRouter>,
  );
  return { onSection, onDelete, onDisconnect, onClose };
}

const selected = (name: string) => screen.getByRole('button', { name }).style.fontWeight === '600';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('server tab content', () => {
  it('names the Connection and offers all five sections, the stored one selected', async () => {
    mountTab({ section: 'users' });
    expect((await screen.findAllByText('Alpha')).length).toBeGreaterThanOrEqual(1);
    for (const name of ['Overview', 'Monitor', 'Collections', 'Users', 'Roles']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(selected('Users')).toBe(true);
    expect(selected('Overview')).toBe(false);
  });

  it('reports a section click to the tab state, leaving the stored section to the tab', async () => {
    const { onSection } = mountTab({ section: 'overview' });
    await screen.findAllByText('Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Roles' }));
    expect(onSection).toHaveBeenCalledExactlyOnceWith('s1', 'roles');
    // The tab owns the section: with the state unchanged, Overview stays selected.
    expect(selected('Overview')).toBe(true);
  });

  it('puts Edit, Delete and Disconnect in the Overview header only', async () => {
    const { onDelete, onDisconnect } = mountTab({ section: 'overview' });
    await screen.findAllByText('Alpha');
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('a');
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(onDisconnect).toHaveBeenCalledWith('a');
  });

  it('draws no header actions on the other sections', async () => {
    mountTab({ section: 'monitor' });
    await screen.findAllByText('Alpha');
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
  });

  it('offers Connect on Overview for a Dormant Connection, and no Disconnect', async () => {
    mountTab({ connection: summary({ status: 'unknown' }), status: 'disconnected' });
    expect(await screen.findByRole('button', { name: 'Connect' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
  });

  it('"Cancel connection" while connecting disconnects at once, with no confirmation', async () => {
    const disconnect = vi.fn(async (id: string) => ({ id }));
    mountTab({ connection: summary({ status: 'unknown' }), status: 'connecting', disconnect });
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel connection' }));
    await waitFor(() => expect(disconnect).toHaveBeenCalledWith('a'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('says the Connection no longer exists when it cannot be resolved', async () => {
    const { onClose } = mountTab({ connection: null });
    expect(await screen.findByText(/no longer exists/i)).toBeTruthy();
    // The tab is the only thing left to leave: the action closes it.
    expect(screen.queryByRole('button', { name: 'Back to Data View' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close tab' }));
    expect(onClose).toHaveBeenCalledExactlyOnceWith('s1');
  });
});

describe('/connections/:id', () => {
  function Intent() {
    const state = useLocation().state as { openServer?: unknown } | null;
    return <div data-testid="intent">{JSON.stringify(state?.openServer ?? null)}</div>;
  }

  it('redirects to the Data View carrying the open-server intent, and no full-page screen remains', async () => {
    render(
      <MemoryRouter initialEntries={['/connections/a']}>
        <Routes>
          <Route path="/connections/:id" element={<ConnectionManager />} />
          <Route path="/workspace" element={<Intent />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('intent').textContent).toBe('{"connectionId":"a"}'));
    expect(screen.queryByRole('button', { name: /Data View/i })).toBeNull();
  });
});
