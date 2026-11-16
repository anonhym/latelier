import { describe, it, expect, vi, afterEach } from 'vitest';
import { notifications } from '@mantine/notifications';
import userEvent from '@testing-library/user-event';
import { act, render, screen, waitFor } from '../helpers/render';
import { installAtelierMock } from '../helpers/atelierMock';
import { UpdateStateProvider } from '../../src/features/updates/UpdateStateProvider';
import { UpdateStatusPill } from '../../src/features/updates/UpdateStatusPill';
import type { UpdateState } from '../../shared/types';

afterEach(() => {
  notifications.clean();
});

function ready(over: Partial<Extract<UpdateState, { status: 'ready' }>> = {}): UpdateState {
  return {
    status: 'ready',
    version: '0.20.0',
    highlights: ['Faster filters.', 'Tabs reopen.', 'Dark mode fixes.'],
    changeCount: 13,
    releaseUrl: 'https://github.com/anonhym/latelier/releases/tag/v0.20.0',
    lastCheckedAt: '2026-11-16T10:00:00.000Z',
    downloadedAt: '2026-11-16T10:00:00.000Z',
    ...over,
  };
}

interface SetupOptions {
  restart?: () => Promise<{ restarting: boolean }>;
  restoreTabs?: unknown;
}

function setup(initial: UpdateState, opts: SetupOptions = {}) {
  let push: (s: UpdateState) => void = () => {};
  const restart = vi.fn(opts.restart ?? (async () => ({ restarting: true })));
  const openExternal = vi.fn(async () => ({ opened: true }));
  installAtelierMock({
    updates: {
      getState: async () => initial,
      restart,
      onState: (cb) => {
        push = cb;
        return () => {};
      },
    },
    prefs: { get: (async () => opts.restoreTabs ?? null) as never },
    app: { openExternal },
  });
  const parentClick = vi.fn();
  const parentKeyDown = vi.fn();
  const view = render(
    // The parent stands in for the status bar and anything behind it: a dismiss
    // that bubbled would reach these spies.
    <div onClick={parentClick} onKeyDown={parentKeyDown} data-testid="parent">
      <UpdateStateProvider>
        <UpdateStatusPill />
      </UpdateStateProvider>
      <button type="button">elsewhere</button>
    </div>,
  );
  return { view, restart, openExternal, parentClick, parentKeyDown, push: (s: UpdateState) => act(() => push(s)) };
}

const pill = () => screen.findByRole('button', { name: '0.20.0 ready · Restart' });
const popover = () => screen.queryByRole('dialog', { name: 'Version 0.20.0 is ready' });

async function openPopover() {
  await userEvent.click(await pill());
  return screen.findByRole('dialog', { name: 'Version 0.20.0 is ready' });
}

describe('UpdateStatusPill', () => {
  it.each<[string, UpdateState]>([
    ['off', { status: 'off', reason: 'development' }],
    ['idle', { status: 'idle' }],
    ['checking', { status: 'checking', lastCheckedAt: null }],
    ['up-to-date', { status: 'up-to-date', lastCheckedAt: '2026-11-16T10:00:00.000Z' }],
    ['failed', { status: 'failed', message: 'offline', lastCheckedAt: null }],
  ])('renders nothing while %s', async (_name, state) => {
    setup(state);
    await act(async () => {});
    expect(screen.queryByTestId('update-downloading')).toBeNull();
    expect(screen.queryByTestId('update-ready-pill')).toBeNull();
    expect(screen.queryByRole('button', { name: /Restart/ })).toBeNull();
    expect(screen.getByTestId('parent').textContent).toBe('elsewhere');
  });

  it('shows muted download progress, not a button, while downloading', async () => {
    setup({ status: 'downloading', version: '0.20.0', percent: 41.6, lastCheckedAt: '2026-11-16T10:00:00.000Z' });
    const text = await screen.findByTestId('update-downloading');
    expect(text.textContent).toContain('Downloading 0.20.0');
    expect(text.textContent).toContain('42%');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('42');
    expect(screen.queryByRole('button', { name: /0\.20\.0/ })).toBeNull();
  });

  it('follows a push from downloading to ready', async () => {
    const { push } = setup({ status: 'downloading', version: '0.20.0', percent: 99, lastCheckedAt: '2026-11-16T10:00:00.000Z' });
    await screen.findByTestId('update-downloading');
    push(ready());
    expect((await pill()).tagName).toBe('BUTTON');
    expect(screen.queryByTestId('update-downloading')).toBeNull();
  });

  it('clicking the ready pill opens the popover and does not restart', async () => {
    const { restart, parentClick } = setup(ready());
    const dialog = await openPopover();
    expect(dialog.textContent).toContain('Version 0.20.0 is ready');
    expect(restart).not.toHaveBeenCalled();
    // The pill's own click does not reach what sits behind it either.
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('says what you are on, and that restarting reopens tabs while that setting is on', async () => {
    setup(ready());
    const dialog = await openPopover();
    await waitFor(() =>
      expect(dialog.textContent).toContain(`You're on ${__APP_VERSION__}. Restarting reopens your tabs.`),
    );
  });

  it('leaves the reopen-tabs sentence out while that setting is off', async () => {
    setup(ready(), { restoreTabs: false });
    const dialog = await openPopover();
    await waitFor(() => expect(dialog.textContent).not.toContain('Restarting reopens your tabs.'));
    expect(dialog.textContent).toContain(`You're on ${__APP_VERSION__}.`);
  });

  it('lists at most three highlights', async () => {
    setup(ready({ highlights: ['One.', 'Two.', 'Three.', 'Four.'] }));
    const dialog = await openPopover();
    expect(Array.from(dialog.querySelectorAll('li')).map((li) => li.textContent)).toEqual(['One.', 'Two.', 'Three.']);
  });

  it('shows no list when there are no highlights', async () => {
    setup(ready({ highlights: [], changeCount: null }));
    const dialog = await openPopover();
    expect(dialog.querySelector('li')).toBeNull();
  });

  it('links "All 13 changes" to the release when the count is known', async () => {
    const { openExternal } = setup(ready());
    await openPopover();
    await userEvent.click(screen.getByRole('button', { name: 'All 13 changes' }));
    expect(openExternal).toHaveBeenCalledWith('https://github.com/anonhym/latelier/releases/tag/v0.20.0');
  });

  it('says "All 1 change" for a single change', async () => {
    setup(ready({ changeCount: 1 }));
    await openPopover();
    expect(screen.getByRole('button', { name: 'All 1 change' })).toBeTruthy();
  });

  it('links "Release notes" when the count is unknown', async () => {
    const { openExternal } = setup(ready({ highlights: [], changeCount: null }));
    await openPopover();
    await userEvent.click(screen.getByRole('button', { name: 'Release notes' }));
    expect(openExternal).toHaveBeenCalledWith('https://github.com/anonhym/latelier/releases/tag/v0.20.0');
  });

  it('shows a toast when the release page cannot be opened', async () => {
    const { openExternal } = setup(ready());
    openExternal.mockRejectedValueOnce({ code: 'VALIDATION', message: 'Blocked host' });
    await openPopover();
    await userEvent.click(screen.getByRole('button', { name: 'All 13 changes' }));
    expect(await screen.findByText('Blocked host')).toBeTruthy();
  });

  it('Restart now calls restart once', async () => {
    const { restart } = setup(ready());
    await openPopover();
    await userEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    await waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
  });

  it('Later closes the popover, keeps the pill, and does not restart', async () => {
    const { restart, parentClick } = setup(ready());
    await openPopover();
    await userEvent.click(screen.getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(popover()).toBeNull());
    expect(await pill()).toBeTruthy();
    expect(restart).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('Escape closes the popover and does not reach what sits behind it', async () => {
    const { parentKeyDown } = setup(ready());
    await openPopover();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(popover()).toBeNull());
    expect(parentKeyDown).not.toHaveBeenCalled();
    expect(await pill()).toBeTruthy();
  });

  it('Escape pressed on the pill itself closes it without bubbling', async () => {
    const { parentKeyDown } = setup(ready());
    await openPopover();
    (await pill()).focus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(popover()).toBeNull());
    expect(parentKeyDown).not.toHaveBeenCalled();
  });

  it('Escape with the popover closed is not swallowed', async () => {
    const { parentKeyDown } = setup(ready());
    (await pill()).focus();
    await userEvent.keyboard('{Escape}');
    expect(parentKeyDown).toHaveBeenCalledTimes(1);
  });

  it('a click outside closes the popover and does not restart', async () => {
    const { restart } = setup(ready());
    await openPopover();
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }));
    await waitFor(() => expect(popover()).toBeNull());
    expect(restart).not.toHaveBeenCalled();
  });

  it('a click inside the popover does not bubble to what sits behind it', async () => {
    const { parentClick } = setup(ready());
    const dialog = await openPopover();
    await userEvent.click(dialog);
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('clicking the pill again closes the popover', async () => {
    setup(ready());
    await openPopover();
    await userEvent.click(await pill());
    await waitFor(() => expect(popover()).toBeNull());
  });

  it('a cancelled restart closes the popover and keeps the pill, with no error', async () => {
    const { restart } = setup(ready(), { restart: async () => ({ restarting: false }) });
    await openPopover();
    await userEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    await waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(popover()).toBeNull());
    expect(await pill()).toBeTruthy();
    expect(screen.queryByText(/could not be applied/)).toBeNull();
  });

  it('a refused restart shows the error and keeps the pill', async () => {
    setup(ready(), {
      restart: async () => {
        throw { code: 'VALIDATION', message: 'No update is ready to install' };
      },
    });
    await openPopover();
    await userEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    expect(await screen.findByText(/No update is ready to install\. It will be applied when you quit\./)).toBeTruthy();
    expect(await pill()).toBeTruthy();
  });

  it('disappears when the state leaves ready', async () => {
    const { push } = setup(ready());
    await openPopover();
    push({ status: 'idle' });
    await waitFor(() => expect(screen.queryByTestId('update-ready-pill')).toBeNull());
    expect(popover()).toBeNull();
  });
});
