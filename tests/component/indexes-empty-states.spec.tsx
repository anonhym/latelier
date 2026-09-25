import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DetailPanel } from '../../src/pages/DetailPanel';
import { IndexesTab } from '../../src/pages/IndexesTab';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { ConnectionSummary } from '@shared/types';

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

describe('IndexesHost — empty / error states (the picker, now in DetailPanel.tsx)', () => {
  it('renders the disconnected state when runtime is not connected', async () => {
    installAtelierMock({
      mongo: {
        status: async (id) => ({ id, status: 'disconnected' as const }),
        connect: async (id) => ({ id, status: 'connecting' as const }),
        disconnect: async (id) => ({ id }),
        ping: async () => ({ roundTripMs: 0 }),
        onStatus: () => () => { /* ok */ },
      },
    });
    renderDetail();
    await userEvent.click(await screen.findByText('Indexes'));
    expect(await screen.findByText(/Not connected/)).toBeTruthy();
  });

  it('renders the empty-pick prompt when no databases exist on the server', async () => {
    installAtelierMock({
      mongo: {
        status: async (id) => ({ id, status: 'connected' as const }),
        connect: async (id) => ({ id, status: 'connected' as const }),
        disconnect: async (id) => ({ id }),
        ping: async () => ({ roundTripMs: 1 }),
        onStatus: () => () => { /* ok */ },
      },
      meta: {
        listDatabases: async () => [],
        listCollections: async () => [],
      },
    });
    renderDetail();
    await userEvent.click(await screen.findByText('Indexes'));
    await waitFor(() => {
      expect(screen.getByText(/Pick a database and collection/)).toBeTruthy();
    });
  });
});

describe('IndexesTab — error states', () => {
  it('shows an UNAUTHORIZED-specific banner when index:list throws', async () => {
    installAtelierMock({
      index: {
        list: async () => {
          throw { code: 'UNAUTHORIZED', message: 'not authorized on alpha' };
        },
      },
    });
    render(<IndexesTab connectionId="c1" dbName="alpha" collection="people" />);
    await waitFor(() => {
      expect(
        screen.getByText(/lacks the privilege to read indexes on alpha\.people/),
      ).toBeTruthy();
    });
  });
});
