import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '../helpers/render';
import { IndexesTab } from '../../src/pages/IndexesTab';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { ConnectionRuntime, ConnectionSummary } from '@shared/types';

/**
 * `collsByDb` (`Record<string, CollectionInfo[]>`) is read with plain
 * bracket truthiness (`if (collsByDb[dbName])`) and `?? []`. A database
 * named `constructor` is legal in MongoDB, and `{}['constructor']` is the
 * inherited `Object` function — truthy, and not rescued by `?? []` since a
 * function is neither `null` nor `undefined`.
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

const runtime: ConnectionRuntime = { id: 'c1', status: 'connected' };

describe('IndexesTab — collsByDb keyed by a db named "constructor"', () => {
  it('loads the collection list instead of returning the inherited Object constructor', async () => {
    installAtelierMock({
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

    render(<IndexesTab conn={conn} runtime={runtime} />);

    // Auto-pick calls loadCollections('constructor'); if the guard at :161
    // reads the inherited function instead of fetching, `rows.find` throws
    // inside the auto-pick effect and `collection` never populates.
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
