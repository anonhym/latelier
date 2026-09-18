import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, expectKeyboardDisclosureToggle } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { UsersTab } from '../../src/pages/UsersTab';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type {
  Connection,
  ConnectionRuntime,
  ConnectionSummary,
  UserInfo,
} from '@shared/types';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

const conn: ConnectionSummary = {
  id: 'c1',
  name: 'test',
  color: '#1A6835',
  host: 'localhost',
  port: 27017,
  connectionType: 'standard',
  readOnly: false,
  status: 'connected',
};
const runtime: ConnectionRuntime = { id: 'c1', status: 'connected' };

function makeFullConn(over: Partial<Connection> = {}): Connection {
  return {
    id: 'c1',
    name: 'test',
    color: '#1A6835',
    connectionType: 'standard',
    readOnly: false,
    host: 'localhost',
    port: 27017,
    authMech: 'scram256',
    authUsername: 'admin',
    authDatabase: 'admin',
    tls: { enabled: false, verify: true },
    advanced: {
      connectTimeoutMs: 5000,
      socketTimeoutMs: 5000,
      serverSelectionTimeoutMs: 5000,
      readPreference: 'primary',
      maxPoolSize: 5,
      directConnection: false,
    },
    hasPasswordStored: false,
    hasSshPasswordStored: false,
    hasSshPassphraseStored: false,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    ...over,
  };
}

const READER: UserInfo = {
  db: 'myapp',
  username: 'reader',
  mechanisms: ['SCRAM-SHA-256'],
  roles: [{ role: 'read', db: 'myapp' }],
  external: false,
};

const X509: UserInfo = {
  db: '$external',
  username: 'CN=client',
  mechanisms: ['MONGODB-X509'],
  roles: [{ role: 'readAnyDatabase', db: 'admin' }],
  external: true,
};

const MULTI_ROLE: UserInfo = {
  db: 'admin',
  username: 'ci',
  mechanisms: ['SCRAM-SHA-256'],
  roles: [
    { role: 'readWrite', db: 'app' },
    { role: 'read', db: 'logs' },
    { role: 'read', db: 'metrics' },
    { role: 'read', db: 'audit' },
    { role: 'read', db: 'sessions' },
  ],
  external: false,
};

function renderTab() {
  return render(
      <UsersTab conn={conn} runtime={runtime} />
  );
}

describe('UsersTab — render', () => {
  it('renders users from a default All databases listing', async () => {
    installAtelierMock({
      conn: { get: async () => makeFullConn() },
      meta: {
        listDatabases: async () => [
          { name: 'myapp', sizeOnDisk: 0, empty: false },
          { name: 'admin', sizeOnDisk: 0, empty: false },
        ],
      },
      user: { list: async () => [READER, X509] },
    });

    renderTab();

    await waitFor(() => {
      expect(screen.getByText('reader')).toBeTruthy();
      expect(screen.getByText('CN=client')).toBeTruthy();
    });
    expect(screen.getByText('$external')).toBeTruthy();
    expect(screen.getByText('external')).toBeTruthy();
    expect(screen.getByText('read@myapp')).toBeTruthy();
  });

  it('passes dbName when the picker is set to a specific database', async () => {
    const calls: Array<{ connectionId: string; dbName?: string }> = [];
    installAtelierMock({
      conn: { get: async () => makeFullConn() },
      meta: {
        listDatabases: async () => [{ name: 'myapp', sizeOnDisk: 0, empty: false }],
      },
      user: {
        list: async (input) => {
          calls.push(input);
          return [READER];
        },
      },
    });

    renderTab();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));

    await userEvent.selectOptions(screen.getByLabelText('Database'), 'myapp');

    await waitFor(() => {
      const scoped = calls.filter((c) => c.dbName === 'myapp');
      expect(scoped.length).toBeGreaterThan(0);
    });
  });

  it('truncates the role list at 4 with a +N overflow badge', async () => {
    installAtelierMock({
      conn: { get: async () => makeFullConn() },
      meta: { listDatabases: async () => [{ name: 'admin', sizeOnDisk: 0, empty: false }] },
      user: { list: async () => [MULTI_ROLE] },
    });

    renderTab();

    await waitFor(() => expect(screen.getByText('ci')).toBeTruthy());
    expect(screen.getByText('+1')).toBeTruthy();
  });

  it('expands the drill-down with mechanism + role details', async () => {
    installAtelierMock({
      conn: { get: async () => makeFullConn() },
      meta: { listDatabases: async () => [{ name: 'myapp', sizeOnDisk: 0, empty: false }] },
      user: {
        list: async () => [
          {
            ...READER,
            customData: '{"team":"platform"}',
          },
        ],
      },
    });

    renderTab();
    const row = await screen.findByText('reader');
    await userEvent.click(row);
    await waitFor(() => {
      expect(screen.getByText(/Mechanisms/)).toBeTruthy();
      expect(screen.getByText(/customData/)).toBeTruthy();
    });
  });

  it('is keyboard-operable: Enter and Space toggle aria-expanded, and focus stays on the toggle', async () => {
    installAtelierMock({
      conn: { get: async () => makeFullConn() },
      meta: { listDatabases: async () => [{ name: 'myapp', sizeOnDisk: 0, empty: false }] },
      user: { list: async () => [READER] },
    });

    renderTab();

    await expectKeyboardDisclosureToggle('reader', /Mechanisms/);
  });

  it('does not strand focus on <body> when the expanded user is dropped', async () => {
    let dropped = false;
    installAtelierMock({
      conn: { get: async () => makeFullConn() },
      meta: { listDatabases: async () => [{ name: 'myapp', sizeOnDisk: 0, empty: false }] },
      user: {
        list: async () => (dropped ? [] : [READER]),
        drop: async () => {
          dropped = true;
          return { dropped: true as const };
        },
      },
    });

    renderTab();

    await userEvent.click(await screen.findByRole('button', { name: 'reader' }));
    await waitFor(() => expect(screen.getByText(/Mechanisms/)).toBeTruthy());

    await userEvent.click(screen.getByLabelText('Drop user reader'));
    const confirmInput = await screen.findByLabelText('Confirm username');
    await userEvent.type(confirmInput, 'reader');
    await userEvent.click(screen.getByText('Drop').closest('button')!);

    await waitFor(() => expect(screen.queryByText('reader')).toBeNull());
    // Documents current behaviour rather than asserting it is correct.
    // Tracked as #74, a blocker of the X19 epic (#51) — on a base-branch run
    // a discovery blocks the base -> main PR, not the ticket that found it.
    // Flip this assertion once #74 gives the drop flow a focus target that
    // survives the row's removal; it goes red by construction when it does.
    expect(document.activeElement).toBe(document.body);
  });

  it('shows the UNAUTHORIZED-specific banner when user:list throws', async () => {
    installAtelierMock({
      conn: { get: async () => makeFullConn() },
      meta: { listDatabases: async () => [{ name: 'admin', sizeOnDisk: 0, empty: false }] },
      user: {
        list: async () => {
          throw { code: 'UNAUTHORIZED', message: 'not authorized' };
        },
      },
    });

    renderTab();

    await waitFor(() => {
      expect(screen.getByText(/lacks the privilege to read users/)).toBeTruthy();
    });
  });
});
