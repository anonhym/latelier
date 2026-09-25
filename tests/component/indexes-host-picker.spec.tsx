import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DetailPanel } from '../../src/pages/DetailPanel';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { ConnectionSummary } from '@shared/types';

/**
 * ADR 0003 / W16 Tier 1 moved the Indexes tab's DB/collection drill-in out
 * of `IndexesTab` (now namespace-scoped) and into `IndexesHost`, a wrapper
 * local to `DetailPanel.tsx` — and retired the `ui.indexes.lastTarget`
 * preference along with it (W16 §9, Tier 1 AC), rather than carrying it
 * over. These are the auto-pick and picker-switch cases that used to live in
 * `IndexesTab`'s own render tests.
 */

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

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/connections/c1']}>
      <DetailPanel selected={conn} loading={false} onDelete={() => {}} onDisconnect={() => {}} />
    </MemoryRouter>,
  );
}

const CONNECTED_MONGO = {
  status: async (id: string) => ({ id, status: 'connected' as const }),
  connect: async (id: string) => ({ id, status: 'connected' as const }),
  disconnect: async (id: string) => ({ id }),
  ping: async () => ({ roundTripMs: 1 }),
  onStatus: () => () => { /* ok */ },
};

async function openIndexesTab() {
  renderDetail();
  await userEvent.click(await screen.findByText('Indexes'));
}

describe('IndexesHost — DB/collection picker', () => {
  it('auto-picks the first DB and collection on mount and lists its indexes', async () => {
    installAtelierMock({
      mongo: CONNECTED_MONGO,
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
                indexCount: 1,
                capped: false,
              },
            ];
          }
          return [];
        },
      },
      index: {
        list: async () => [
          {
            name: '_id_',
            key: [{ field: '_id', direction: 1 }],
            isIdIndex: true,
            unique: false,
            sparse: false,
            hidden: false,
            version: 2,
          },
        ],
      },
    });

    await openIndexesTab();

    await waitFor(() => {
      const dbSelect = screen.getByLabelText('Database') as HTMLSelectElement;
      const collSelect = screen.getByLabelText('Collection') as HTMLSelectElement;
      expect(dbSelect.value).toBe('alpha');
      expect(collSelect.value).toBe('people');
    });

    await waitFor(() => expect(screen.getByText('_id_')).toBeTruthy());
  });

  it('does not read or persist the selected target, and switching DBs reloads the index list', async () => {
    const setSpy = vi.fn<(key: string, value: unknown) => void>();
    const getSpy = vi.fn<(key: string) => void>();
    const set = async <T,>(key: string, value: T) => { setSpy(key, value); return value; };
    const get = async (key: string) => { getSpy(key); return null; };
    installAtelierMock({
      mongo: CONNECTED_MONGO,
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
      index: {
        list: async ({ dbName }) =>
          dbName === 'beta'
            ? []
            : [
                {
                  name: '_id_',
                  key: [{ field: '_id', direction: 1 }],
                  isIdIndex: true,
                  unique: false,
                  sparse: false,
                  hidden: false,
                  version: 2,
                },
              ],
      },
      prefs: { get, set },
    });

    await openIndexesTab();

    await waitFor(() => expect(screen.getByText('_id_')).toBeTruthy());

    await userEvent.selectOptions(screen.getByLabelText('Database'), 'beta');

    await waitFor(() => {
      const collSelect = screen.getByLabelText('Collection') as HTMLSelectElement;
      expect(collSelect.value).toBe('logs');
    });
    await waitFor(() => expect(screen.queryByText('_id_')).toBeNull());

    // `ui.showSystemDbs` is legitimately read; only `ui.indexes.lastTarget`
    // — the picked namespace — must never be read or written.
    expect(getSpy.mock.calls.filter((c) => c[0] === 'ui.indexes.lastTarget')).toEqual([]);
    expect(setSpy.mock.calls.filter((c) => c[0] === 'ui.indexes.lastTarget')).toEqual([]);
  });
});
