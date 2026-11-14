import { describe, it, expect, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useConnections } from '../../src/state/connections';
import { connectionFixture, installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { ConnectionRuntime } from '@shared/types';

afterEach(() => uninstallAtelierMock());

describe('useConnections — status events', () => {
  it('merges connectedAt from a status event, and clears it when the client drops', async () => {
    let emit: (r: ConnectionRuntime) => void = () => {};
    installAtelierMock({
      conn: { list: async () => [connectionFixture({ id: 'c1', status: 'unknown' })] },
      mongo: {
        onStatus: (cb: (r: ConnectionRuntime) => void) => {
          emit = cb;
          return () => {};
        },
      },
    });
    const { result } = renderHook(() => useConnections());
    await waitFor(() => expect(result.current.connections).toHaveLength(1));

    act(() => emit({ id: 'c1', status: 'connected', connectedAt: '2026-11-14T10:00:00.000Z' }));
    expect(result.current.connections[0]!.connectedAt).toBe('2026-11-14T10:00:00.000Z');

    // Same status, a later connect time (a reconnect): still merged.
    act(() => emit({ id: 'c1', status: 'connected', connectedAt: '2026-11-14T11:00:00.000Z' }));
    expect(result.current.connections[0]!.connectedAt).toBe('2026-11-14T11:00:00.000Z');

    act(() => emit({ id: 'c1', status: 'disconnected' }));
    expect(result.current.connections[0]!.connectedAt).toBeUndefined();
  });
});
