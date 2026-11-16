import { describe, it, expect, vi, afterEach } from 'vitest';
import { notifications } from '@mantine/notifications';
import { MemoryRouter } from 'react-router-dom';
import { useState } from 'react';
import { act, render, screen, waitFor, fireEvent } from '../helpers/render';
import { installAtelierMock } from '../helpers/atelierMock';
import { UpdateReadyPrompt } from '../../src/features/updates/UpdateReadyPrompt';
import { UpdateStateProvider } from '../../src/features/updates/UpdateStateProvider';
import { UpdateStatusPill } from '../../src/features/updates/UpdateStatusPill';
import type { IpcApi } from '@shared/ipc';
import type { UpdateState } from '../../shared/types';

const SHOWN_KEY = 'update.toastShownFor';

afterEach(() => {
  notifications.clean();
});

function ready(version: string): UpdateState {
  return {
    status: 'ready',
    version,
    highlights: [],
    changeCount: null,
    releaseUrl: `https://github.com/anonhym/latelier/releases/tag/v${version}`,
    lastCheckedAt: '2026-11-16T10:00:00.000Z',
    downloadedAt: '2026-11-16T10:00:00.000Z',
  };
}

/** Stands in for the workspace's status bar, which some screens draw and others (the welcome canvas) do not. */
function StatusBarToggle({ initial }: { initial: boolean }) {
  const [shown, setShown] = useState(initial);
  return (
    <>
      <button onClick={() => setShown((v) => !v)}>{shown ? 'hide status bar' : 'show status bar'}</button>
      {shown && <UpdateStatusPill />}
    </>
  );
}

interface SetupOptions {
  restart?: () => Promise<{ restarting: boolean }>;
  /** The version the toast was last shown for, as stored. */
  shownFor?: unknown;
  /** Whether a status bar (and so the pill) is on screen at first. */
  statusBar?: boolean;
}

function setup(initial: UpdateState = { status: 'idle' }, opts: SetupOptions = {}) {
  let push: (s: UpdateState) => void = () => {};
  const unsubscribe = vi.fn();
  const restart = vi.fn(opts.restart ?? (async () => ({ restarting: true })));
  const set = vi.fn(async (_k: string, v: unknown) => v);
  installAtelierMock({
    updates: {
      getState: async () => initial,
      restart,
      onState: (cb) => {
        push = cb;
        return unsubscribe;
      },
    },
    prefs: { get: (async (k: string) => (k === SHOWN_KEY ? (opts.shownFor ?? null) : null)) as never, set: set as never },
  });
  // helpers/render already mounts <Notifications />.
  const view = render(
    <UpdateStateProvider>
      <UpdateReadyPrompt />
      <StatusBarToggle initial={opts.statusBar ?? false} />
    </UpdateStateProvider>,
  );
  return { view, restart, set, unsubscribe, push: (s: UpdateState) => act(() => push(s)) };
}

const restartButton = () => screen.queryByRole('button', { name: 'Restart to update' });

describe('UpdateReadyPrompt', () => {
  it('shows nothing while idle', async () => {
    setup();
    await act(async () => {});
    expect(screen.queryByText(/is ready/)).toBeNull();
  });

  it('away from the workspace, shows the version and a Restart button when ready on mount', async () => {
    setup(ready('1.2.3'));
    expect(await screen.findByText('Version 1.2.3 is ready')).toBeTruthy();
    expect(restartButton()).toBeTruthy();
  });

  it('records the version it showed the toast for', async () => {
    const { set } = setup(ready('1.2.3'));
    await screen.findByText('Version 1.2.3 is ready');
    await waitFor(() => expect(set).toHaveBeenCalledWith(SHOWN_KEY, '1.2.3'));
    expect(set).toHaveBeenCalledTimes(1);
  });

  it('shows nothing while the status bar pill is on screen, and stores nothing', async () => {
    const { set } = setup(ready('1.2.3'), { statusBar: true });
    await act(async () => {});
    expect(screen.queryByText(/is ready/)).toBeNull();
    expect(set).not.toHaveBeenCalled();
  });

  it('shows the toast once the status bar goes away', async () => {
    setup(ready('1.2.3'), { statusBar: true });
    await act(async () => {});
    expect(screen.queryByText(/is ready/)).toBeNull();
    fireEvent.click(screen.getByText('hide status bar'));
    expect(await screen.findByText('Version 1.2.3 is ready')).toBeTruthy();
  });

  it('shows nothing for a version it already showed the toast for', async () => {
    const { set } = setup(ready('1.2.3'), { shownFor: '1.2.3' });
    await act(async () => {});
    expect(screen.queryByText(/is ready/)).toBeNull();
    expect(set).not.toHaveBeenCalled();
  });

  it('shows the toast for a newer version than the one stored', async () => {
    const { set } = setup(ready('1.3.0'), { shownFor: '1.2.3' });
    expect(await screen.findByText('Version 1.3.0 is ready')).toBeTruthy();
    await waitFor(() => expect(set).toHaveBeenCalledWith(SHOWN_KEY, '1.3.0'));
  });

  it('closing it is final: the status bar coming and going does not bring it back', async () => {
    const { set } = setup(ready('1.2.3'));
    await screen.findByText('Version 1.2.3 is ready');
    act(() => notifications.clean());
    await waitFor(() => expect(screen.queryByText(/is ready/)).toBeNull());
    fireEvent.click(screen.getByText('show status bar'));
    fireEvent.click(screen.getByText('hide status bar'));
    await act(async () => {});
    expect(screen.queryByText(/is ready/)).toBeNull();
    expect(set).toHaveBeenCalledTimes(1);
  });

  it('shows a pushed ready event once, and a second push of the same version does not stack or repeat', async () => {
    const { push, set } = setup();
    push(ready('1.0.0'));
    expect(await screen.findByText('Version 1.0.0 is ready')).toBeTruthy();
    act(() => notifications.clean());
    await waitFor(() => expect(screen.queryByText(/is ready/)).toBeNull());
    push(ready('1.0.0'));
    await act(async () => {});
    expect(screen.queryByText(/is ready/)).toBeNull();
    expect(set).toHaveBeenCalledTimes(1);
  });

  it('a newer ready version replaces the toast rather than stacking', async () => {
    const { push } = setup();
    push(ready('1.0.0'));
    await screen.findByText('Version 1.0.0 is ready');
    push(ready('1.1.0'));
    expect(await screen.findByText('Version 1.1.0 is ready')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Restart to update' })).toHaveLength(1));
    expect(screen.queryByText('Version 1.0.0 is ready')).toBeNull();
  });

  it('ignores a pushed idle state', async () => {
    const { push } = setup();
    push({ status: 'idle' });
    expect(screen.queryByText(/is ready/)).toBeNull();
  });

  it('calls updates.restart once when Restart is clicked', async () => {
    const { restart } = setup(ready('1.2.3'));
    fireEvent.click(await screen.findByRole('button', { name: 'Restart to update' }));
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('shows a non-modal error when restart fails', async () => {
    setup(ready('1.2.3'), {
      restart: async () => {
        throw { code: 'VALIDATION', message: 'No update is ready to install' };
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Restart to update' }));
    expect(await screen.findByText(/No update is ready to install\. It will be applied when you quit\./)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a cancelled restart shows no error, and the toast it hid does not come back for the same version', async () => {
    const { push, restart } = setup(ready('1.2.3'), { restart: async () => ({ restarting: false }) });
    fireEvent.click(await screen.findByRole('button', { name: 'Restart to update' }));
    await waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(restartButton()).toBeNull());
    // Main re-sends ready after a cancel; the toast is once per version, so the
    // pill and Settings are what keep offering it.
    push(ready('1.2.3'));
    await act(async () => {});
    expect(restartButton()).toBeNull();
    expect(screen.queryByText(/could not be applied|will be applied when you quit/)).toBeNull();
  });

  it('is not a modal', async () => {
    setup(ready('1.2.3'));
    await screen.findByText('Version 1.2.3 is ready');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('unsubscribes on unmount', async () => {
    const { view, unsubscribe } = setup();
    await act(async () => {});
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('sends a failed state read to the main log and shows nothing', async () => {
    const log = vi.fn<IpcApi['app']['log']>(async () => undefined);
    installAtelierMock({
      updates: {
        getState: async () => {
          throw { code: 'INTERNAL', message: 'updater offline' };
        },
        onState: () => () => {},
      },
      app: { log },
    });
    render(
      <MemoryRouter initialEntries={['/connections/new']}>
        <UpdateStateProvider>
          <UpdateReadyPrompt />
        </UpdateStateProvider>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(log).toHaveBeenCalledWith({
        level: 'warn',
        message: 'reading the update state failed: updater offline',
        source: 'component',
      }),
    );
    expect(screen.queryByText(/is ready/)).toBeNull();
  });

  it('sends a failed read of the shown-for version to the main log and shows nothing', async () => {
    const log = vi.fn<IpcApi['app']['log']>(async () => undefined);
    installAtelierMock({
      updates: { getState: async () => ready('1.2.3'), onState: () => () => {} },
      prefs: {
        get: (async () => {
          throw { code: 'INTERNAL', message: 'db locked' };
        }) as never,
      },
      app: { log },
    });
    render(
      <MemoryRouter initialEntries={['/connections/new']}>
        <UpdateStateProvider>
          <UpdateReadyPrompt />
        </UpdateStateProvider>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(log).toHaveBeenCalledWith({
        level: 'warn',
        message: 'reading the version the update toast was shown for failed: db locked',
        source: 'component',
      }),
    );
    expect(screen.queryByText(/is ready/)).toBeNull();
  });
});
