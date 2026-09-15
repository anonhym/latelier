import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '../helpers/render';
import { IndexesTab } from '../../src/pages/IndexesTab';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { ConnectionRuntime, ConnectionSummary } from '@shared/types';

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

function renderTab(runtime: ConnectionRuntime) {
  return render(
      <IndexesTab conn={conn} runtime={runtime} />
  );
}

describe('IndexesTab — empty / error states', () => {
  it('renders the disconnected state when runtime is not connected', () => {
    installAtelierMock({});
    renderTab({ id: 'c1', status: 'disconnected' });
    expect(screen.getByText(/Not connected/)).toBeTruthy();
  });

  it('renders the empty-pick prompt when no databases exist on the server', async () => {
    installAtelierMock({
      meta: {
        listDatabases: async () => [],
        listCollections: async () => [],
      },
    });
    renderTab({ id: 'c1', status: 'connected' });
    await waitFor(() => {
      expect(screen.getByText(/Pick a database and collection/)).toBeTruthy();
    });
  });

  it('shows an UNAUTHORIZED-specific banner when index:list throws', async () => {
    installAtelierMock({
      meta: {
        listDatabases: async () => [{ name: 'alpha', sizeOnDisk: 0, empty: false }],
        listCollections: async () => [
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
        list: async () => {
          throw { code: 'UNAUTHORIZED', message: 'not authorized on alpha' };
        },
      },
    });
    renderTab({ id: 'c1', status: 'connected' });
    await waitFor(() => {
      expect(
        screen.getByText(/lacks the privilege to read indexes on alpha\.people/),
      ).toBeTruthy();
    });
  });
});
