import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DetailPanel } from '../../src/pages/DetailPanel';
import { TroubleshootingProvider } from '../../src/troubleshooting/TroubleshootingProvider';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { ConnectionSummary } from '@shared/types';

/**
 * `CollectionsTab`'s `colls`/`expanded` maps are keyed by database name and
 * read with plain bracket access. A database named `constructor` is legal in
 * MongoDB: `expanded['constructor']` and `colls['constructor']` are both the
 * inherited `Object` function, truthy but not an array, so the row renders
 * permanently open with nothing inside, and `loadCollections` is never
 * called because the `!colls[name]` guard also reads the inherited value.
 */

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

const conn: ConnectionSummary = {
  id: 'c1',
  name: 'MyConn',
  color: '#1A6835',
  host: 'localhost',
  port: 27017,
  connectionType: 'standard',
  readOnly: false,
  status: 'connected',
};

function renderDetail() {
  return render(
    <TroubleshootingProvider>
      <MemoryRouter initialEntries={['/connections/c1']}>
        <DetailPanel selected={conn} loading={false} onDelete={() => {}} onDisconnect={() => {}} />
      </MemoryRouter>
    </TroubleshootingProvider>,
  );
}

describe('DetailPanel — CollectionsTab keyed by a db named "constructor"', () => {
  it('loads and renders the collection list instead of getting stuck open and empty', async () => {
    const listCollections = vi.fn(async ({ dbName }: { dbName: string }) => {
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
    });

    installAtelierMock({
      mongo: {
        status: async (id) => ({ id, status: 'connected' }),
        connect: async (id) => ({ id, status: 'connecting' }),
        disconnect: async (id) => ({ id }),
        ping: async () => ({ roundTripMs: 0 }),
        serverInfo: async () => { throw new Error('unused'); },
        onStatus: () => () => { /* noop */ },
      },
      meta: {
        // >2 databases so none auto-expand on load (that path writes via a
        // safe spread and would mask the bug in `toggleDb`) — the click
        // below has to be what drives expansion and the fetch.
        listDatabases: async () => [
          { name: 'alpha', sizeOnDisk: 0, empty: false },
          { name: 'beta', sizeOnDisk: 0, empty: false },
          { name: 'constructor', sizeOnDisk: 0, empty: false },
        ],
        listCollections,
      },
    });

    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: 'Collections' }));
    await userEvent.click(await screen.findByText('constructor'));

    // If the reads walk the prototype chain, `loadCollections` is never
    // invoked and neither "Loading collections…" nor "people" ever appears.
    await waitFor(() => expect(listCollections).toHaveBeenCalledWith({
      connectionId: 'c1',
      dbName: 'constructor',
    }));
    await screen.findByText('people');
  });
});
