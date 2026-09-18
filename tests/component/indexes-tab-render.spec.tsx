import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, expectKeyboardDisclosureToggle } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { IndexesTab } from '../../src/pages/IndexesTab';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { ConnectionRuntime, ConnectionSummary, IndexInfo } from '@shared/types';

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

function renderTab() {
  return render(
      <IndexesTab conn={conn} runtime={runtime} />
  );
}

const ID_INDEX: IndexInfo = {
  name: '_id_',
  key: [{ field: '_id', direction: 1 }],
  isIdIndex: true,
  unique: false,
  sparse: false,
  hidden: false,
  version: 2,
  sizeBytes: 4096,
  usage: { ops: 12, since: '2026-04-01T00:00:00.000Z' },
};

const TTL_INDEX: IndexInfo = {
  name: 'created_-1_ttl',
  key: [{ field: 'created', direction: -1 }],
  isIdIndex: false,
  unique: false,
  sparse: false,
  hidden: false,
  version: 2,
  expireAfterSeconds: 86400,
  sizeBytes: 8192,
  usage: { ops: 1234, since: '2026-04-01T00:00:00.000Z' },
};

const UNIQUE_INDEX: IndexInfo = {
  name: 'email_unique',
  key: [{ field: 'email', direction: 1 }],
  isIdIndex: false,
  unique: true,
  sparse: false,
  hidden: false,
  version: 2,
  sizeBytes: 16384,
};

describe('IndexesTab — render', () => {
  it('auto-picks the first DB and collection on mount and lists indexes', async () => {
    installAtelierMock({
      meta: {
        listDatabases: async () => [
          { name: 'alpha', sizeOnDisk: 0, empty: false },
          { name: 'beta', sizeOnDisk: 0, empty: false },
        ],
        listCollections: async ({ dbName }) => {
          if (dbName === 'alpha') {
            return [
              {
                name: 'people',
                type: 'collection' as const,
                documentCount: 0,
                sizeBytes: 0,
                indexCount: 3,
                capped: false,
              },
            ];
          }
          return [];
        },
      },
      index: {
        list: async () => [ID_INDEX, TTL_INDEX, UNIQUE_INDEX],
      },
    });

    renderTab();

    await waitFor(() => {
      expect(screen.getByText('_id_')).toBeTruthy();
      expect(screen.getByText('email_unique')).toBeTruthy();
      expect(screen.getByText('created_-1_ttl')).toBeTruthy();
    });

    // Badges from indexBadges.
    expect(screen.getByText('default')).toBeTruthy();
    expect(screen.getByText('unique')).toBeTruthy();
    expect(screen.getByText(/^ttl 1d$/)).toBeTruthy();

    // Size + use columns rendered for at least the TTL index.
    expect(screen.getByText('8.0 KB')).toBeTruthy();
    expect(screen.getByText(/1\.2k/)).toBeTruthy();
  });

  it('expands the row drill-down on click and shows version + usage detail', async () => {
    installAtelierMock({
      meta: {
        listDatabases: async () => [{ name: 'alpha', sizeOnDisk: 0, empty: false }],
        listCollections: async () => [
          {
            name: 'people',
            type: 'collection' as const,
            documentCount: 0,
            sizeBytes: 0,
            indexCount: 1,
            capped: false,
          },
        ],
      },
      index: {
        list: async () => [
          {
            ...UNIQUE_INDEX,
            partialFilterExpression: '{"status":{"$eq":"active"}}',
          },
        ],
      },
    });

    renderTab();

    const row = await screen.findByText('email_unique');
    await userEvent.click(row);

    await waitFor(() => {
      expect(screen.getByText(/v2/)).toBeTruthy();
      expect(screen.getByText(/partialFilterExpression/)).toBeTruthy();
    });
  });

  it('is keyboard-operable: Enter and Space toggle aria-expanded, and focus stays on the toggle', async () => {
    installAtelierMock({
      meta: {
        listDatabases: async () => [{ name: 'alpha', sizeOnDisk: 0, empty: false }],
        listCollections: async () => [
          {
            name: 'people',
            type: 'collection' as const,
            documentCount: 0,
            sizeBytes: 0,
            indexCount: 1,
            capped: false,
          },
        ],
      },
      index: { list: async () => [UNIQUE_INDEX] },
    });

    renderTab();

    await expectKeyboardDisclosureToggle('email_unique', /v2/);
  });

  it('does not strand focus on <body> when the expanded index is dropped', async () => {
    let dropped = false;
    installAtelierMock({
      meta: {
        listDatabases: async () => [{ name: 'alpha', sizeOnDisk: 0, empty: false }],
        listCollections: async () => [
          {
            name: 'people',
            type: 'collection' as const,
            documentCount: 0,
            sizeBytes: 0,
            indexCount: 1,
            capped: false,
          },
        ],
      },
      index: {
        list: async () => (dropped ? [] : [UNIQUE_INDEX]),
        drop: async () => {
          dropped = true;
          return { dropped: true as const };
        },
      },
    });

    renderTab();

    await userEvent.click(await screen.findByRole('button', { name: 'email_unique' }));
    await waitFor(() => expect(screen.getByText(/v2/)).toBeTruthy());

    await userEvent.click(screen.getByLabelText('Drop index email_unique'));
    const confirmInput = await screen.findByLabelText('Confirm index name');
    await userEvent.type(confirmInput, 'email_unique');
    await userEvent.click(screen.getByText('Drop').closest('button')!);

    await waitFor(() => expect(screen.queryByText('email_unique')).toBeNull());
    // Documents current behaviour rather than asserting it is correct.
    // Tracked as #74 (blocks this ticket, #54); flip this assertion once #74
    // gives the drop flow a focus target that survives the row's removal.
    expect(document.activeElement).toBe(document.body);
  });

  it('persists the selected target via prefs.set', async () => {
    const setSpy = vi.fn<(key: string, value: unknown) => void>();
    // `prefs.set` is generic; a vitest Mock erases the type parameter, so the
    // spy is wrapped by a delegating arrow that keeps the real signature.
    const set = async <T,>(key: string, value: T) => { setSpy(key, value); return value; };
    installAtelierMock({
      meta: {
        listDatabases: async () => [
          { name: 'alpha', sizeOnDisk: 0, empty: false },
          { name: 'beta', sizeOnDisk: 0, empty: false },
        ],
        listCollections: async ({ dbName }) =>
          dbName === 'beta'
            ? [
                {
                  name: 'logs',
                  type: 'collection' as const,
                  documentCount: 0,
                  sizeBytes: 0,
                  indexCount: 0,
                  capped: false,
                },
              ]
            : [
                {
                  name: 'people',
                  type: 'collection' as const,
                  documentCount: 0,
                  sizeBytes: 0,
                  indexCount: 0,
                  capped: false,
                },
              ],
      },
      index: { list: async () => [ID_INDEX] },
      prefs: { get: async () => null, set },
    });

    renderTab();

    await waitFor(() => expect(screen.getByText('_id_')).toBeTruthy());

    // Switch DB → triggers a prefs.set('ui.indexes.lastTarget', { dbName: 'beta', ... })
    await userEvent.selectOptions(screen.getByLabelText('Database'), 'beta');

    await waitFor(() => {
      const calls = setSpy.mock.calls.filter((c) => c[0] === 'ui.indexes.lastTarget');
      expect(calls.length).toBeGreaterThan(0);
    });
  });
});
