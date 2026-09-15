import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { UsersTab } from '../../src/pages/UsersTab';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type {
  Connection,
  ConnectionRuntime,
  ConnectionSummary,
  UserCreateInput,
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

function renderTab() {
  return render(
      <UsersTab conn={conn} runtime={runtime} />
  );
}

async function pickMyapp() {
  await userEvent.selectOptions(screen.getByLabelText('Database'), 'myapp');
}

describe('UsersTab — create drawer', () => {
  it('disables + New user when picker is on All databases', async () => {
    installAtelierMock({
      conn: { get: async () => makeFullConn() },
      meta: { listDatabases: async () => [{ name: 'myapp', sizeOnDisk: 0, empty: false }] },
      user: { list: async () => [READER] },
    });
    renderTab();
    await waitFor(() => expect(screen.getByText('reader')).toBeTruthy());
    expect((screen.getByText('+ New user').closest('button') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('submits the typed payload with default mechanisms = SCRAM-SHA-256', async () => {
    const calls: UserCreateInput[] = [];
    installAtelierMock({
      conn: { get: async () => makeFullConn() },
      meta: { listDatabases: async () => [{ name: 'myapp', sizeOnDisk: 0, empty: false }] },
      user: {
        list: async () => [READER],
        create: async (input) => {
          calls.push(input);
          return { ok: true as const };
        },
      },
    });
    renderTab();
    await waitFor(() => expect(screen.getByText('reader')).toBeTruthy());

    await pickMyapp();
    await userEvent.click(screen.getByText('+ New user'));

    await waitFor(() => expect(screen.getByLabelText('Username')).toBeTruthy());

    await userEvent.type(screen.getByLabelText('Username'), 'newby');
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'hunter2');
    await userEvent.click(screen.getByText('+ Add role'));
    // role row defaults to { role: 'read', db: 'myapp' } — accept defaults.

    await userEvent.click(screen.getByText('Create user'));

    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]).toMatchObject({
      connectionId: 'c1',
      dbName: 'myapp',
      username: 'newby',
      password: 'hunter2',
      roles: [{ role: 'read', db: 'myapp' }],
      mechanisms: ['SCRAM-SHA-256'],
    });
  });

  it('keeps the drawer open with an inline error on CONFLICT', async () => {
    installAtelierMock({
      conn: { get: async () => makeFullConn() },
      meta: { listDatabases: async () => [{ name: 'myapp', sizeOnDisk: 0, empty: false }] },
      user: {
        list: async () => [READER],
        create: async () => {
          throw { code: 'CONFLICT', message: 'user "newby" already exists' };
        },
      },
    });
    renderTab();
    await waitFor(() => expect(screen.getByText('reader')).toBeTruthy());

    await pickMyapp();
    await userEvent.click(screen.getByText('+ New user'));

    await userEvent.type(screen.getByLabelText('Username'), 'newby');
    await userEvent.type(screen.getByLabelText('Password'), 'p');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'p');
    await userEvent.click(screen.getByText('+ Add role'));
    await userEvent.click(screen.getByText('Create user'));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/already exists/);
    });
    expect(screen.getByLabelText('Username')).toBeTruthy();
  });

  it('rejects mismatched passwords locally without calling the API', async () => {
    const calls: unknown[] = [];
    installAtelierMock({
      conn: { get: async () => makeFullConn() },
      meta: { listDatabases: async () => [{ name: 'myapp', sizeOnDisk: 0, empty: false }] },
      user: {
        list: async () => [READER],
        create: async (input) => {
          calls.push(input);
          return { ok: true as const };
        },
      },
    });
    renderTab();
    await waitFor(() => expect(screen.getByText('reader')).toBeTruthy());

    await pickMyapp();
    await userEvent.click(screen.getByText('+ New user'));

    await userEvent.type(screen.getByLabelText('Username'), 'a');
    await userEvent.type(screen.getByLabelText('Password'), 'one');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'two');
    await userEvent.click(screen.getByText('+ Add role'));
    await userEvent.click(screen.getByText('Create user'));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/do not match/);
    });
    expect(calls.length).toBe(0);
  });
});
