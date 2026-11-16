// X22 §7: Restart to update, Check for updates and What's new, registered through
// the same registry every other command uses.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { notifications } from '@mantine/notifications';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, render, screen, waitFor, within } from '../helpers/render';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { CommandPaletteRoot, usePaletteApi, _resetPaletteStoreForTests } from '../../src/commands/CommandPalette';
import { PaletteContextProvider } from '../../src/commands/PaletteContext';
import { commandRegistry } from '../../src/commands/registry';
import { UpdateCommands } from '../../src/features/updates/UpdateCommands';
import { UpdateStateProvider } from '../../src/features/updates/UpdateStateProvider';
import { WhatsNewContext } from '../../src/features/updates/whatsNewContext';
import type { UpdateState } from '../../shared/types';

function ToggleButton() {
  const palette = usePaletteApi();
  return <button onClick={palette.toggle}>toggle</button>;
}

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

function ready(): UpdateState {
  return {
    status: 'ready',
    version: '0.20.0',
    highlights: [],
    changeCount: null,
    releaseUrl: 'https://github.com/anonhym/latelier/releases/tag/v0.20.0',
    lastCheckedAt: minutesAgo(1),
    downloadedAt: minutesAgo(1),
  };
}

function mount(initial: UpdateState, check: () => Promise<UpdateState> = async () => initial) {
  let push: (s: UpdateState) => void = () => {};
  const checkSpy = vi.fn(check);
  const restart = vi.fn(async () => ({ restarting: true }));
  const openWhatsNew = vi.fn();
  installAtelierMock({
    updates: {
      getState: async () => initial,
      check: checkSpy,
      restart,
      onState: (cb) => {
        push = cb;
        return () => {};
      },
    },
    prefs: { get: async () => null, set: async (_k: string, v: unknown) => v } as never,
  });
  render(
    <MemoryRouter>
      <PaletteContextProvider>
        <UpdateStateProvider>
          <WhatsNewContext.Provider value={{ open: openWhatsNew }}>
            <CommandPaletteRoot>
              <UpdateCommands />
              <ToggleButton />
            </CommandPaletteRoot>
          </WhatsNewContext.Provider>
        </UpdateStateProvider>
      </PaletteContextProvider>
    </MemoryRouter>,
  );
  return { check: checkSpy, restart, openWhatsNew, push: (s: UpdateState) => act(() => push(s)) };
}

async function search(text: string) {
  fireEvent.click(screen.getByText('toggle'));
  await act(async () => {});
  fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: text } });
}

const dialog = () => screen.getByRole('dialog', { name: 'Command palette' });
const titles = () =>
  within(dialog())
    .queryAllByRole('option')
    .map((o) => o.querySelector('[data-title]')?.getAttribute('data-title'));
const row = (title: string) =>
  within(dialog())
    .getAllByRole('option')
    .find((o) => o.querySelector('[data-title]')?.getAttribute('data-title') === title)!;

afterEach(() => {
  uninstallAtelierMock();
  commandRegistry._resetForTests();
  _resetPaletteStoreForTests();
  notifications.clean();
  vi.restoreAllMocks();
});

describe('update palette commands', () => {
  it('lists Check for updates and What’s new always, and no restart before an update is ready', async () => {
    mount({ status: 'idle' });
    await search('e');
    expect(titles()).toContain('Check for updates');
    expect(titles()).toContain(`What's new in ${__APP_VERSION__}`);
    expect(titles().some((t) => t?.startsWith('Restart to update'))).toBe(false);
  });

  it('lists Restart to update to <v> only while ready, and it restarts', async () => {
    const { restart } = mount(ready());
    await search('Restart to update');
    await waitFor(() => expect(titles()).toContain('Restart to update to 0.20.0'));
    fireEvent.click(row('Restart to update to 0.20.0'));
    await waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
  });

  it('drops the restart command when the state leaves ready', async () => {
    const { push } = mount(ready());
    await search('Restart to update');
    await waitFor(() => expect(titles()).toContain('Restart to update to 0.20.0'));
    push({ status: 'idle' });
    await waitFor(() => expect(titles()).not.toContain('Restart to update to 0.20.0'));
  });

  it('hints how long ago the last check was', async () => {
    mount({ status: 'up-to-date', lastCheckedAt: minutesAgo(3) });
    await search('Check for updates');
    await waitFor(() =>
      expect(row('Check for updates').querySelector('[data-subtitle]')?.getAttribute('data-subtitle')).toBe(
        'last checked 3 min ago',
      ),
    );
  });

  it('hints that nothing was checked yet', async () => {
    mount({ status: 'idle' });
    await search('Check for updates');
    expect(row('Check for updates').querySelector('[data-subtitle]')?.getAttribute('data-subtitle')).toBe(
      'not checked yet',
    );
  });

  it.each([
    ['development' as const, 'Updates are off in development builds.'],
    ['linux' as const, "Updates aren't available on Linux yet. Download new versions from GitHub."],
  ])('is disabled with the reason as its hint while off (%s), and does nothing', async (reason, text) => {
    const { check } = mount({ status: 'off', reason });
    await search('Check for updates');
    const r = row('Check for updates');
    expect(r.getAttribute('aria-disabled')).toBe('true');
    expect(r.querySelector('[data-subtitle]')?.getAttribute('data-subtitle')).toBe(text);
    fireEvent.click(r);
    await act(async () => {});
    expect(check).not.toHaveBeenCalled();
  });

  it.each<[string, UpdateState, string]>([
    ['up to date', { status: 'up-to-date', lastCheckedAt: minutesAgo(0) }, "You're up to date"],
    [
      'downloading',
      { status: 'downloading', version: '0.20.0', percent: 0, lastCheckedAt: minutesAgo(0) },
      'Found 0.20.0, downloading',
    ],
    ['ready', ready(), 'Update ready'],
    ['failed', { status: 'failed', message: 'offline', lastCheckedAt: null }, "Couldn't check for updates: offline"],
  ])('Check for updates calls check once and toasts once when %s', async (_name, outcome, message) => {
    const { check } = mount({ status: 'idle' }, async () => outcome);
    await search('Check for updates');
    fireEvent.click(row('Check for updates'));
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getAllByText(/up to date|downloading|Update ready|Couldn't check/i)).toHaveLength(1);
  });

  it('toasts nothing for a check that was already running', async () => {
    const { check } = mount({ status: 'idle' }, async () => ({ status: 'checking', lastCheckedAt: null }));
    await search('Check for updates');
    fireEvent.click(row('Check for updates'));
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.queryByText(/up to date|downloading|Update ready|Couldn't check/i)).toBeNull();
  });

  it('a check that throws toasts the failure', async () => {
    mount({ status: 'idle' }, async () => {
      throw { code: 'INTERNAL', message: 'updater offline' };
    });
    await search('Check for updates');
    fireEvent.click(row('Check for updates'));
    expect(await screen.findByText("Couldn't check for updates: updater offline")).toBeTruthy();
  });

  it('What’s new in <current> opens the window', async () => {
    const { openWhatsNew } = mount({ status: 'idle' });
    await search("What's new");
    fireEvent.click(row(`What's new in ${__APP_VERSION__}`));
    await waitFor(() => expect(openWhatsNew).toHaveBeenCalledTimes(1));
  });

  it('registers each command once', async () => {
    mount(ready());
    await search('');
    await waitFor(() => expect(titles().filter((t) => t === 'Check for updates')).toHaveLength(1));
    expect(titles().filter((t) => t === `What's new in ${__APP_VERSION__}`)).toHaveLength(1);
    expect(titles().filter((t) => t === 'Restart to update to 0.20.0')).toHaveLength(1);
  });
});
