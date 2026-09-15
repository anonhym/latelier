import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { UsersTab } from '../../src/pages/UsersTab';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type {
  Connection,
  ConnectionRuntime,
  ConnectionSummary,
  UserDropInput,
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

function makeFullConn(): Connection {
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
    hasPasswordStored: true,
    hasSshPasswordStored: false,
    hasSshPassphraseStored: false,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
  };
}

const READER: UserInfo = {
  db: 'myapp',
  username: 'reader',
  mechanisms: ['SCRAM-SHA-256'],
  roles: [{ role: 'read', db: 'myapp' }],
  external: false,
};

const SELF: UserInfo = {
  db: 'admin',
  username: 'admin',
  mechanisms: ['SCRAM-SHA-256'],
  roles: [{ role: 'root', db: 'admin' }],
  external: false,
};

function renderTab() {
  return render(
      <UsersTab conn={conn} runtime={runtime} />
  );
}

describe('UsersTab — drop confirm', () => {
  it('Drop disabled until typed name matches; success refetches', async () => {
    const dropCalls: UserDropInput[] = [];
    let listCallNo = 0;
    installAtelierMock({
      conn: { get: async () => makeFullConn() },
      meta: { listDatabases: async () => [{ name: 'myapp', sizeOnDisk: 0, empty: false }] },
      user: {
        list: async () => {
          listCallNo++;
          return listCallNo === 1 ? [READER] : [];
        },
        drop: async (input) => {
          dropCalls.push(input);
          return { dropped: true as const };
        },
      },
    });

    renderTab();
    await waitFor(() => expect(screen.getByText('reader')).toBeTruthy());

    await userEvent.click(screen.getByLabelText('Drop user reader'));

    const input = await screen.findByLabelText('Confirm username');
    const dropBtn = screen.getByText('Drop').closest('button')! as HTMLButtonElement;
    expect(dropBtn.disabled).toBe(true);

    await userEvent.type(input, 'wrong');
    expect(dropBtn.disabled).toBe(true);

    await userEvent.clear(input);
    await userEvent.type(input, 'reader');
    expect(dropBtn.disabled).toBe(false);

    await userEvent.click(dropBtn);

    await waitFor(() => expect(dropCalls).toEqual([
      { connectionId: 'c1', dbName: 'myapp', username: 'reader' },
    ]));
    await waitFor(() => expect(screen.queryByText('reader')).toBeNull());
  });

  it('does not render Edit/Drop buttons on the self row', async () => {
    installAtelierMock({
      conn: { get: async () => makeFullConn() },
      meta: { listDatabases: async () => [{ name: 'admin', sizeOnDisk: 0, empty: false }] },
      user: { list: async () => [SELF, READER] },
    });
    renderTab();
    await waitFor(() => expect(screen.getByText('reader')).toBeTruthy());
    expect(screen.queryByLabelText('Edit user admin')).toBeNull();
    expect(screen.queryByLabelText('Drop user admin')).toBeNull();
    // The non-self row still has its actions.
    expect(screen.getByLabelText('Edit user reader')).toBeTruthy();
    expect(screen.getByLabelText('Drop user reader')).toBeTruthy();
    // The "this connection" badge marks the self row.
    expect(screen.getByText('this connection')).toBeTruthy();
  });
});
