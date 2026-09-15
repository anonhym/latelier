import { describe, it, expect, afterEach, vi } from 'vitest';
import { notifications } from '@mantine/notifications';
import { render, screen, act } from '../helpers/render';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { disconnectConnection } from '../../src/features/connections/disconnectConnection';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
  // Mantine's notification queue lives outside the React tree RTL tears
  // down, so a toast shown in one test is still mounted for the next.
  notifications.clean();
});

// one disconnect error policy, stated once, used by every caller
// (Workspace's Switcher-row disconnect, DetailPanel's two disconnect/cancel
// buttons, DbCollectionNavigator's context-menu Disconnect). Each caller's own
// test already covers the success path and that it calls
// `api.mongo.disconnect` with the right id; this is the one place the
// failure-is-visible half of the policy needs proving, since it would
// otherwise need repeating at every call site.
describe('disconnectConnection', () => {
  it('a failing disconnect surfaces a toast instead of failing silently', async () => {
    installAtelierMock({
      mongo: {
        disconnect: async () => {
          throw { code: 'SYSTEM', message: 'socket hang up' };
        },
      },
    });
    render(<></>);

    await act(() => disconnectConnection('c1'));

    expect(await screen.findByText('socket hang up')).toBeTruthy();
    expect(screen.getByText('Could not disconnect')).toBeTruthy();
  });

  it('a successful disconnect surfaces no toast', async () => {
    installAtelierMock({
      mongo: { disconnect: async (id: string) => ({ id }) },
    });
    render(<></>);

    await act(() => disconnectConnection('c1'));

    expect(screen.queryByText('Could not disconnect')).toBeNull();
  });
});
