import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '../helpers/render';
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

function makeFullConn(authUsername: string, authDatabase = 'admin'): Connection {
  return {
    id: 'c1',
    name: 'test',
    color: '#1A6835',
    connectionType: 'standard',
    readOnly: false,
    host: 'localhost',
    port: 27017,
    authMech: 'scram256',
    authUsername,
    authDatabase,
    tls: { enabled: false, verify: true },
    advanced: {
      connectTimeoutMs: 5000,
      socketTimeoutMs: 5000,
      serverSelectionTimeoutMs: 5000,
      readPreference: 'primary',
      maxPoolSize: 5,
      directConnection: false,
    },
    hasPasswordStored: true,
    hasSshPasswordStored: false,
    hasSshPassphraseStored: false,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
  };
}

const ALICE_ADMIN: UserInfo = {
  db: 'admin',
  username: 'alice',
  mechanisms: ['SCRAM-SHA-256'],
  roles: [{ role: 'root', db: 'admin' }],
  external: false,
};

const BOB_ADMIN: UserInfo = {
  db: 'admin',
  username: 'bob',
  mechanisms: ['SCRAM-SHA-256'],
  roles: [{ role: 'readWrite', db: 'app' }],
  external: false,
};

const ALICE_MYAPP: UserInfo = {
  db: 'myapp',
  username: 'alice',
  mechanisms: ['SCRAM-SHA-256'],
  roles: [{ role: 'read', db: 'myapp' }],
  external: false,
};

function renderTab() {
  return render(
      <UsersTab conn={conn} runtime={runtime} />
  );
}

describe('UsersTab — self-protection', () => {
  it('marks the row whose username + db match auth_username + auth_database', async () => {
    installAtelierMock({
      conn: { get: async () => makeFullConn('alice', 'admin') },
      meta: { listDatabases: async () => [{ name: 'admin', sizeOnDisk: 0, empty: false }] },
      user: { list: async () => [ALICE_ADMIN, BOB_ADMIN, ALICE_MYAPP] },
    });

    renderTab();

    await waitFor(() => expect(screen.getAllByText('alice').length).toBe(2));

    // The pill renders only on the (alice, admin) row, not the (alice, myapp) row.
    const pills = screen.getAllByText('this connection');
    expect(pills.length).toBe(1);
  });

  it('does not mark any row when the connection has no auth_username', async () => {
    installAtelierMock({
      conn: {
        get: async () => ({
          ...makeFullConn('alice', 'admin'),
          authMech: 'none',
          authUsername: undefined,
          authDatabase: undefined,
        }),
      },
      meta: { listDatabases: async () => [{ name: 'admin', sizeOnDisk: 0, empty: false }] },
      user: { list: async () => [ALICE_ADMIN, BOB_ADMIN] },
    });

    renderTab();
    await waitFor(() => expect(screen.getByText('alice')).toBeTruthy());
    expect(screen.queryByText('this connection')).toBeNull();
  });

  it('defaults the connection auth db to admin when authDatabase is omitted', async () => {
    installAtelierMock({
      conn: {
        get: async () => ({
          ...makeFullConn('alice', 'admin'),
          authDatabase: undefined,
        }),
      },
      meta: { listDatabases: async () => [{ name: 'admin', sizeOnDisk: 0, empty: false }] },
      user: { list: async () => [ALICE_ADMIN, ALICE_MYAPP] },
    });

    renderTab();
    await waitFor(() => expect(screen.getAllByText('alice').length).toBe(2));
    expect(screen.getAllByText('this connection').length).toBe(1);
  });
});
