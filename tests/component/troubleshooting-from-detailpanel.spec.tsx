import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DetailPanel } from '../../src/pages/DetailPanel';
import { TroubleshootingProvider } from '../../src/troubleshooting/TroubleshootingProvider';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { ConnectionSummary } from '@shared/types';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

const baseConn: ConnectionSummary = {
  id: 'c1',
  name: 'MyConn',
  color: '#1A6835',
  host: 'localhost',
  port: 27017,
  connectionType: 'standard',
  readOnly: false,
  status: 'error',
};

function renderDetail() {
  return render(
      <TroubleshootingProvider>
        <MemoryRouter initialEntries={['/connections/c1']}>
          <DetailPanel selected={baseConn} loading={false} onDelete={() => {}} onDisconnect={() => {}} />
        </MemoryRouter>
      </TroubleshootingProvider>
  );
}

describe('DetailPanel — troubleshooting trigger', () => {
  it('shows the help link in the error state and opens the matching recipe', async () => {
    installAtelierMock({
      mongo: {
        status: async (id) => ({
          id,
          status: 'error',
          errorCode: 'AUTH',
          errorMessage: 'auth failed',
        }),
        connect: async (id) => ({ id, status: 'connecting' }),
        disconnect: async (id) => ({ id }),
        ping: async () => ({ roundTripMs: 0 }),
        serverInfo: async () => { throw new Error('unused'); },
        onStatus: () => () => { /* noop */ },
      },
    });
    renderDetail();

    await waitFor(() => expect(screen.getByText(/Connection error/)).toBeTruthy());

    const help = await screen.findByText(/Help me fix this/);
    await userEvent.click(help);

    await waitFor(() => expect(screen.getByText('Authentication failed')).toBeTruthy());
  });

  it('hides the help link when status is merely disconnected (no error)', async () => {
    installAtelierMock({
      mongo: {
        status: async (id) => ({ id, status: 'disconnected' }),
        connect: async (id) => ({ id, status: 'connecting' }),
        disconnect: async (id) => ({ id }),
        ping: async () => ({ roundTripMs: 0 }),
        serverInfo: async () => { throw new Error('unused'); },
        onStatus: () => () => { /* noop */ },
      },
    });
    render(
        <TroubleshootingProvider>
          <MemoryRouter initialEntries={['/connections/c1']}>
            <DetailPanel selected={{ ...baseConn, status: 'unknown' }} loading={false} onDelete={() => {}} onDisconnect={() => {}} />
          </MemoryRouter>
        </TroubleshootingProvider>
    );

    await waitFor(() => expect(screen.getByText('Connect')).toBeTruthy());
    expect(screen.queryByText(/Help me fix this/)).toBeNull();
  });
});
