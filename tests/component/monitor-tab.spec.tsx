import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor, within } from '../helpers/render';
import { modals } from '@mantine/modals';
import { MonitorTab } from '../../src/pages/MonitorTab';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { ConnectionRuntime, ConnectionSummary, CurrentOpSummary } from '@shared/types';

const conn: ConnectionSummary = {
  id: 'c1',
  name: 'MyConn',
  color: '#1A6835',
  host: 'localhost',
  port: 27017,
  connectionType: 'standard',
  readOnly: false,
  status: 'connected',
  defaultDb: 'shop',
};
const connected: ConnectionRuntime = { id: 'c1', status: 'connected' };

const op: CurrentOpSummary = {
  opid: '4242',
  op: 'query',
  ns: 'shop.orders',
  secsRunning: 12,
  client: '127.0.0.1:5000',
  planSummary: 'COLLSCAN',
  command: '{"find":"orders"}',
};

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

afterEach(() => {
  modals.closeAll();
  uninstallAtelierMock();
  vi.useRealTimers();
  vi.restoreAllMocks();
  setVisibility('visible');
});

describe('MonitorTab', () => {
  it('shows the Not connected text when disconnected and calls nothing', () => {
    const currentOp = vi.fn(async () => ({ ops: [] }));
    installAtelierMock({ admin: { currentOp } });
    render(<MonitorTab conn={conn} runtime={{ id: 'c1', status: 'disconnected' }} />);
    expect(screen.getByText('Not connected. Open the Overview tab to connect.')).toBeTruthy();
    expect(currentOp).not.toHaveBeenCalled();
  });

  it('renders ops from currentOp and expands the command as text', async () => {
    installAtelierMock({ admin: { currentOp: async () => ({ ops: [op] }) } });
    render(<MonitorTab conn={conn} runtime={connected} />);
    const ops = screen.getByRole('region', { name: 'Current operations' });
    expect(await within(ops).findByText('shop.orders')).toBeTruthy();
    expect(within(ops).getByText('COLLSCAN')).toBeTruthy();
    expect(within(ops).getByText('127.0.0.1:5000')).toBeTruthy();

    const toggle = within(ops).getByRole('button', { expanded: false });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(within(ops).getByText('{"find":"orders"}')).toBeTruthy();
  });

  it('asks before killing, and kills only once confirmed', async () => {
    const killOp = vi.fn(async () => ({ ok: true as const }));
    installAtelierMock({ admin: { currentOp: async () => ({ ops: [op] }), killOp } });
    render(<MonitorTab conn={conn} runtime={connected} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Kill operation 4242' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Kill operation 4242?');
    expect(killOp).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Kill' }));
    await waitFor(() => expect(killOp).toHaveBeenCalledWith({ connectionId: 'c1', opid: '4242' }));
  });

  it('cancelling the confirm does not kill', async () => {
    const killOp = vi.fn(async () => ({ ok: true as const }));
    installAtelierMock({ admin: { currentOp: async () => ({ ops: [op] }), killOp } });
    render(<MonitorTab conn={conn} runtime={connected} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Kill operation 4242' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(killOp).not.toHaveBeenCalled();
  });

  it('a read-only connection disables Kill and the profiler controls', async () => {
    installAtelierMock({ admin: { currentOp: async () => ({ ops: [op] }) } });
    render(<MonitorTab conn={{ ...conn, readOnly: true }} runtime={connected} />);
    const kill = await screen.findByRole('button', { name: 'Kill operation 4242' });
    expect((kill as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('slowms') as HTMLInputElement).disabled).toBe(true);
  });

  it('polls every 5s while visible, skips while hidden, and stops on Pause', async () => {
    vi.useFakeTimers();
    setVisibility('visible');
    const currentOp = vi.fn(async () => ({ ops: [] }));
    installAtelierMock({ admin: { currentOp } });
    render(<MonitorTab conn={conn} runtime={connected} />);
    await act(async () => {});
    expect(currentOp).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(currentOp).toHaveBeenCalledTimes(2);

    setVisibility('hidden');
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(currentOp).toHaveBeenCalledTimes(2);

    setVisibility('visible');
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(currentOp).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(currentOp).toHaveBeenCalledTimes(3);
    expect(screen.getByText('Paused')).toBeTruthy();
  });

  it('sends the filters: active only by default, and the minimum seconds once typed', async () => {
    const currentOp = vi.fn(async () => ({ ops: [] }));
    installAtelierMock({ admin: { currentOp } });
    render(<MonitorTab conn={conn} runtime={connected} />);
    await waitFor(() =>
      expect(currentOp).toHaveBeenLastCalledWith({ connectionId: 'c1', activeOnly: true }),
    );

    fireEvent.change(screen.getByLabelText('Minimum seconds running'), { target: { value: '3' } });
    await waitFor(() =>
      expect(currentOp).toHaveBeenLastCalledWith({ connectionId: 'c1', activeOnly: true, minSecsRunning: 3 }),
    );

    fireEvent.click(screen.getByLabelText('Active only'));
    await waitFor(() =>
      expect(currentOp).toHaveBeenLastCalledWith({ connectionId: 'c1', activeOnly: false, minSecsRunning: 3 }),
    );
  });

  it('profiler: shows the level, reads canonical EJSON rows, and applies a new level', async () => {
    const setProfileLevel = vi.fn(async () => ({ ok: true as const }));
    installAtelierMock({
      meta: { listDatabases: async () => [{ name: 'shop', sizeOnDisk: 0, empty: false }] },
      admin: {
        profileStatus: async () => ({ level: 1 as const, slowms: 20 }),
        setProfileLevel,
        profileTail: async () => ({
          docs: [
            {
              op: 'query',
              ns: 'shop.orders',
              millis: { $numberInt: '37' },
              planSummary: 'IXSCAN { a: 1 }',
              ts: { $date: { $numberLong: '1760000000000' } },
            },
          ],
        }),
      },
    });
    render(<MonitorTab conn={conn} runtime={connected} />);
    const prof = screen.getByRole('region', { name: 'Profiler' });
    expect(await within(prof).findByText('Current: Slow, slowms 20')).toBeTruthy();
    expect(within(prof).getByText('37')).toBeTruthy();
    expect(within(prof).getByText('IXSCAN { a: 1 }')).toBeTruthy();
    expect(within(prof).getByText(new Date(1760000000000).toLocaleString())).toBeTruthy();

    fireEvent.click(within(prof).getByText('All'));
    fireEvent.click(within(prof).getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(setProfileLevel).toHaveBeenCalledWith({ connectionId: 'c1', dbName: 'shop', level: 2, slowms: 20 }),
    );
  });
});
