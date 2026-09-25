import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DetailPanel } from '../../src/pages/DetailPanel';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { ConnectionSummary } from '@shared/types';

/**
 * `collsByDb` (`Record<string, CollectionInfo[]>`) is read with plain
 * bracket truthiness (`if (collsByDb[dbName])`) and `?? []`. A database
 * named `constructor` is legal in MongoDB, and `{}['constructor']` is the
 * inherited `Object` function — truthy, and not rescued by `?? []` since a
 * function is neither `null` nor `undefined`.
 *
 * This lives in `IndexesHost` (`DetailPanel.tsx`) now — ADR 0003 moved the
 * DB/collection picker out of `IndexesTab`, which is namespace-scoped.
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

describe('IndexesHost — collsByDb keyed by a db named "constructor"', () => {
  it('loads the collection list instead of returning the inherited Object constructor', async () => {
    installAtelierMock({
      mongo: {
        status: async (id) => ({ id, status: 'connected' as const }),
        connect: async (id) => ({ id, status: 'connected' as const }),
        disconnect: async (id) => ({ id }),
        ping: async () => ({ roundTripMs: 1 }),
        onStatus: () => () => { /* ok */ },
      },
      meta: {
        listDatabases: async () => [{ name: 'constructor', sizeOnDisk: 0, empty: false }],
        listCollections: async ({ dbName }) => {
          expect(dbName).toBe('constructor');
          return [
            {
              name: 'people',
              type: 'collection' as const,
              documentCount: 0,
              sizeBytes: 0,
              indexCount: 0,
              capped: false,
            },
          ];
        },
      },
      index: { list: async () => [] },
    });

    renderDetail();
    await userEvent.click(await screen.findByText('Indexes'));

    // Auto-pick calls loadCollections('constructor'); if the guard reads the
    // inherited function instead of fetching, `rows.find` throws inside the
    // auto-pick effect and `collection` never populates.
    await waitFor(() => {
      const collectionSelect = screen.getByLabelText('Collection') as HTMLSelectElement;
      expect(collectionSelect.value).toBe('people');
    });

    const options = Array.from(
      (screen.getByLabelText('Collection') as HTMLSelectElement).options,
    ).map((o) => o.value);
    expect(options).toContain('people');
  });
});
