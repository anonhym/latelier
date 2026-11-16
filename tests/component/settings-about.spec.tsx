import { describe, it, expect, vi, afterEach } from 'vitest';
import { notifications } from '@mantine/notifications';
import userEvent from '@testing-library/user-event';
import { act, render, screen, waitFor, within } from '../helpers/render';
import { installAtelierMock } from '../helpers/atelierMock';
import { HintsProvider } from '../../src/hints/HintsProvider';
import { SettingsModal } from '../../src/pages/SettingsModal';
import { UpdateStateProvider } from '../../src/features/updates/UpdateStateProvider';
import { WhatsNewContext } from '../../src/features/updates/whatsNewContext';
import type { UpdateState } from '../../shared/types';

afterEach(() => {
  notifications.clean();
  vi.useRealTimers();
});

const NOW_ISO = () => new Date().toISOString();
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

function ready(): UpdateState {
  return {
    status: 'ready',
    version: '0.20.0',
    highlights: [],
    changeCount: null,
    releaseUrl: 'https://github.com/anonhym/latelier/releases/tag/v0.20.0',
    lastCheckedAt: minutesAgo(30),
    downloadedAt: NOW_ISO(),
  };
}

interface Options {
  check?: () => Promise<UpdateState>;
  restart?: () => Promise<{ restarting: boolean }>;
  section?: 'about' | 'appearance';
  appInfo?: () => Promise<{ version: string; platform: string; arch: string }>;
  log?: () => Promise<void>;
}

function setup(initial: UpdateState, opts: Options = {}) {
  let push: (s: UpdateState) => void = () => {};
  const check = vi.fn(opts.check ?? (async () => initial));
  const restart = vi.fn(opts.restart ?? (async () => ({ restarting: true })));
  const openExternal = vi.fn(async () => ({ opened: true }));
  const openWhatsNew = vi.fn();
  installAtelierMock({
    updates: {
      getState: async () => initial,
      check,
      restart,
      onState: (cb) => {
        push = cb;
        return () => {};
      },
    },
    app: {
      openExternal,
      ...(opts.appInfo ? { getInfo: opts.appInfo } : {}),
      ...(opts.log ? { log: opts.log as never } : {}),
    },
  });
  render(
    <HintsProvider>
      <UpdateStateProvider>
        <WhatsNewContext.Provider value={{ open: openWhatsNew }}>
          <SettingsModal initialSection={opts.section ?? 'about'} onClose={() => {}} />
        </WhatsNewContext.Provider>
      </UpdateStateProvider>
    </HintsProvider>,
  );
  return { check, restart, openExternal, openWhatsNew, push: (s: UpdateState) => act(() => push(s)) };
}

const card = () => screen.queryByTestId('about-status-card');
const checkButton = () => screen.getByRole('button', { name: 'Check for updates' }) as HTMLButtonElement;

describe('Settings → About and updates', () => {
  it('has its own rail entry under Maintenance, and shows the version and the name', async () => {
    setup({ status: 'idle' });
    expect(await screen.findByRole('tab', { name: 'About and updates' })).toBeTruthy();
    expect(screen.getByLabelText("L'Atelier")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('about-version').textContent).toBe(`Version ${__APP_VERSION__} · macOS · Apple silicon`),
    );
  });

  it('shows the version alone, and logs, when the app info cannot be read', async () => {
    const log = vi.fn(async () => {});
    setup({ status: 'idle' }, { appInfo: async () => { throw { code: 'INTERNAL', message: 'no info' }; }, log });
    await waitFor(() =>
      expect(log).toHaveBeenCalledWith({
        level: 'warn',
        message: 'reading the app info failed: no info',
        source: 'component',
      }),
    );
    expect(screen.getByTestId('about-version').textContent).toBe(`Version ${__APP_VERSION__}`);
  });

  it('shows only the button, with no card, while idle', async () => {
    setup({ status: 'idle' });
    await screen.findByTestId('about-version');
    expect(card()).toBeNull();
    expect(checkButton().disabled).toBe(false);
    expect(screen.getByTestId('about-checked-line').textContent).toBe(
      'Not checked yet · checks at launch and every 4 hours',
    );
  });

  it('ready: an accent card with Restart now, which restarts once', async () => {
    const { restart } = setup(ready());
    const c = await screen.findByTestId('about-status-card');
    expect(c.getAttribute('data-tone')).toBe('accent');
    expect(c.textContent).toContain('Version 0.20.0 is ready to install');
    expect(c.textContent).toMatch(/Downloaded today at \d{2}:\d{2}\./);
    await userEvent.click(within(c).getByRole('button', { name: 'Restart now' }));
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('up to date: the check card with the version and when', async () => {
    setup({ status: 'up-to-date', lastCheckedAt: NOW_ISO() });
    const c = await screen.findByTestId('about-status-card');
    expect(c.textContent).toContain("You're up to date");
    expect(c.textContent).toContain(`${__APP_VERSION__} is the latest version. Checked just now.`);
    expect(within(c).queryByRole('button')).toBeNull();
  });

  it('checking: a spinner, and the Check button is disabled', async () => {
    setup({ status: 'checking', lastCheckedAt: null });
    const c = await screen.findByTestId('about-status-card');
    expect(c.textContent).toContain('Checking for updates…');
    expect(c.querySelector('.mantine-Loader-root')).not.toBeNull();
    expect(checkButton().disabled).toBe(true);
  });

  it('downloading: the version, a bar at the percent, and the reassurance', async () => {
    setup({ status: 'downloading', version: '0.20.0', percent: 42, lastCheckedAt: NOW_ISO() });
    const c = await screen.findByTestId('about-status-card');
    expect(c.textContent).toContain('Downloading 0.20.0');
    expect(c.textContent).toContain('42%');
    expect(c.textContent).toContain("Keep working; you'll be offered a restart when it's done.");
    expect(within(c).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('42');
  });

  it('failed: a warning card with the message, and Try again checks once', async () => {
    const { check } = setup({ status: 'failed', message: 'getaddrinfo ENOTFOUND', lastCheckedAt: null });
    const c = await screen.findByTestId('about-status-card');
    expect(c.getAttribute('data-tone')).toBe('warning');
    expect(c.textContent).toContain("Couldn't check for updates");
    expect(c.textContent).toContain('getaddrinfo ENOTFOUND');
    await userEvent.click(within(c).getByRole('button', { name: 'Try again' }));
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('off in development: the button is disabled with its reason, and there is no card', async () => {
    setup({ status: 'off', reason: 'development' });
    const reason = await screen.findByTestId('about-off-reason');
    expect(reason.textContent).toBe('Updates are off in development builds.');
    expect(checkButton().disabled).toBe(true);
    expect(card()).toBeNull();
    expect(screen.queryByTestId('about-checked-line')).toBeNull();
  });

  it('off on Linux: the reason links GitHub to the releases page', async () => {
    const { openExternal } = setup({ status: 'off', reason: 'linux' });
    const reason = await screen.findByTestId('about-off-reason');
    expect(reason.textContent).toBe("Updates aren't available on Linux yet. Download new versions from GitHub.");
    expect(checkButton().disabled).toBe(true);
    await userEvent.click(within(reason).getByRole('button', { name: 'GitHub' }));
    expect(openExternal).toHaveBeenCalledWith('https://github.com/anonhym/latelier/releases');
  });

  it('the Check button calls check once, and is disabled while the call is pending', async () => {
    let finish: (s: UpdateState) => void = () => {};
    const { check } = setup(
      { status: 'idle' },
      { check: () => new Promise<UpdateState>((resolve) => (finish = resolve)) },
    );
    await screen.findByTestId('about-version');
    await userEvent.click(checkButton());
    expect(check).toHaveBeenCalledTimes(1);
    expect(checkButton().disabled).toBe(true);
    await act(async () => finish({ status: 'idle' }));
    await waitFor(() => expect(checkButton().disabled).toBe(false));
  });

  it('follows the state through a check: checking, then up to date', async () => {
    const { push } = setup({ status: 'idle' });
    await screen.findByTestId('about-version');
    push({ status: 'checking', lastCheckedAt: null });
    expect((await screen.findByTestId('about-status-card')).textContent).toContain('Checking for updates…');
    expect(checkButton().disabled).toBe(true);
    push({ status: 'up-to-date', lastCheckedAt: NOW_ISO() });
    await waitFor(() => expect(screen.getByTestId('about-status-card').textContent).toContain("You're up to date"));
    expect(checkButton().disabled).toBe(false);
  });

  it('a check that throws shows an error toast and re-enables the button', async () => {
    setup(
      { status: 'idle' },
      {
        check: async () => {
          throw { code: 'INTERNAL', message: 'updater offline' };
        },
      },
    );
    await screen.findByTestId('about-version');
    await userEvent.click(checkButton());
    expect(await screen.findByText('updater offline')).toBeTruthy();
    expect(checkButton().disabled).toBe(false);
  });

  it('shows how long ago the last check was, and refreshes it every minute', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    setup({ status: 'up-to-date', lastCheckedAt: minutesAgo(2) });
    await act(async () => {});
    expect(screen.getByTestId('about-checked-line').textContent).toBe(
      'Last checked 2 minutes ago · checks at launch and every 4 hours',
    );
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByTestId('about-checked-line').textContent).toContain('Last checked 3 minutes ago');
    act(() => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(screen.getByTestId('about-checked-line').textContent).toContain('Last checked 5 minutes ago');
  });

  it('"What\'s new in <version>" reopens the window', async () => {
    const { openWhatsNew } = setup({ status: 'idle' });
    await userEvent.click(await screen.findByRole('button', { name: `What's new in ${__APP_VERSION__}` }));
    expect(openWhatsNew).toHaveBeenCalledTimes(1);
  });

  it('"Full release history on GitHub" opens the changelog', async () => {
    const { openExternal } = setup({ status: 'idle' });
    await userEvent.click(await screen.findByRole('button', { name: 'Full release history on GitHub' }));
    expect(openExternal).toHaveBeenCalledWith('https://github.com/anonhym/latelier/blob/main/CHANGELOG.md');
  });

  it('puts a dot on the rail entry only while an update is ready', async () => {
    const { push } = setup({ status: 'idle' }, { section: 'appearance' });
    await screen.findByRole('tab', { name: 'About and updates' });
    expect(screen.queryByTestId('about-update-dot')).toBeNull();
    push(ready());
    expect(await screen.findByTestId('about-update-dot')).toBeTruthy();
    // The dot is spoken as text, not left as a bare shape.
    expect(screen.getByRole('tab', { name: 'About and updates, update ready' })).toBeTruthy();
    push({ status: 'idle' });
    await waitFor(() => expect(screen.queryByTestId('about-update-dot')).toBeNull());
  });

  it('is not mounted until the section is opened', async () => {
    setup({ status: 'idle' }, { section: 'appearance' });
    await screen.findByRole('tab', { name: 'About and updates' });
    expect(screen.queryByTestId('about-version')).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'About and updates' }));
    expect(await screen.findByTestId('about-version')).toBeTruthy();
  });
});
