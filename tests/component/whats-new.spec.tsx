import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, within } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { installAtelierMock } from '../helpers/atelierMock';
import { HintsContext, type HintsContextValue } from '../../src/hints/HintsContext';
import { WhatsNewProvider } from '../../src/features/updates/WhatsNewProvider';
import { useWhatsNew } from '../../src/features/updates/whatsNewContext';
import { FULL_CHANGELOG_URL } from '../../src/features/updates/whatsNewFormat';
import { _resetPaletteOpenForTests, setPaletteOpen } from '../../src/commands/paletteOpenState';
import { resetLaunchRestore, settleRestoreHint } from '../../src/hints/launchRestore';

const KEY = 'whatsNew.lastSeenVersion';

function hints(over: Partial<HintsContextValue> = {}): HintsContextValue {
  return {
    loaded: true,
    settled: true,
    isDismissed: () => true,
    dismiss: () => {},
    reset: () => {},
    registerCandidate: () => {},
    unregisterCandidate: () => {},
    visibleId: null,
    recordSessionEvent: () => {},
    getSessionEventCount: () => 0,
    ...over,
  };
}

function Reopen() {
  const { open } = useWhatsNew();
  return <button onClick={open}>Reopen notes</button>;
}

function Tree({ h, current = '0.20.0' }: { h: HintsContextValue; current?: string }) {
  return (
    <HintsContext.Provider value={h}>
      <WhatsNewProvider currentVersion={current}>
        <Reopen />
      </WhatsNewProvider>
    </HintsContext.Provider>
  );
}

function setup(stored: unknown, opts: { h?: HintsContextValue; current?: string } = {}) {
  const set = vi.fn(async (_k: string, v: unknown) => v);
  const log = vi.fn(async () => {});
  const openExternal = vi.fn(async () => ({ opened: true }));
  installAtelierMock({
    prefs: { get: (async (k: string) => (k === KEY ? stored : null)) as never, set: set as never },
    app: { log, openExternal },
  });
  const view = render(<Tree h={opts.h ?? hints()} current={opts.current} />);
  return { set, log, openExternal, view };
}

const dialog = () => screen.queryByRole('dialog', { name: "What's new in L'Atelier" });

beforeEach(() => {
  _resetPaletteOpenForTests();
  resetLaunchRestore();
});
afterEach(() => {
  _resetPaletteOpenForTests();
  resetLaunchRestore();
});

describe('What’s new window launch trigger', () => {
  it('opens nothing and stores the current version when none is stored', async () => {
    const { set } = setup(null);
    await waitFor(() => expect(set).toHaveBeenCalledWith(KEY, '0.20.0'));
    expect(dialog()).toBeNull();
  });

  it.each([['garbage'], [42], [{}], ['0.20']])('treats a stored %j as no stored value', async (stored) => {
    const { set } = setup(stored);
    await waitFor(() => expect(set).toHaveBeenCalledWith(KEY, '0.20.0'));
    expect(dialog()).toBeNull();
  });

  it('opens with the two releases after 0.19.0, the older one collapsed', async () => {
    setup('0.19.0');
    const win = await screen.findByRole('dialog', { name: "What's new in L'Atelier" });
    expect(within(win).getByText('Updated from 0.19.0 to 0.20.0 · 2 releases')).toBeTruthy();
    expect(within(win).getByText('0.20.0 · 13 Nov 2026')).toBeTruthy();
    expect(within(win).getByText('Current')).toBeTruthy();
    // The newest release lists its leads.
    expect(within(win).getByText('The dark theme reads in layers.')).toBeTruthy();
    // The older one is a collapsed disclosure with the count wording.
    const older = within(win).getByRole('button', { name: /0\.19\.1 · 12 Nov 2026 · 1 fix/ });
    expect(older.getAttribute('aria-expanded')).toBe('false');
    expect(within(win).queryByText(/Scrolling the database navigator stays where you put it/)).toBeNull();
    await userEvent.click(older);
    expect(older.getAttribute('aria-expanded')).toBe('true');
    expect(within(win).getByText(/Scrolling the database navigator stays where you put it/)).toBeTruthy();
    // 0.19.0 itself is not in the range.
    expect(within(win).queryByRole('button', { name: /0\.19\.0 ·/ })).toBeNull();
  });

  it('stores the current version as it opens, and not before', async () => {
    const { set } = setup('0.19.0', { h: hints({ visibleId: 'startup.restore' }) });
    await act(async () => {});
    expect(set).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it('stores the version once the window opens', async () => {
    const { set } = setup('0.19.0');
    await screen.findByRole('dialog');
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    expect(set).toHaveBeenCalledWith(KEY, '0.20.0');
  });

  it('moves focus to the close button', async () => {
    setup('0.19.0');
    const win = await screen.findByRole('dialog');
    const close = within(win).getByRole('button', { name: 'Close' });
    await waitFor(() => expect(document.activeElement).toBe(close));
  });

  it('keeps the leadless item behind Show details', async () => {
    setup('0.19.0');
    const win = await screen.findByRole('dialog');
    expect(within(win).queryByText(/Run and Refresh look the same everywhere/)).toBeNull();
    const toggle = within(win).getByRole('button', { name: 'Show details' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(toggle);
    expect(within(win).getByText(/Run and Refresh look the same everywhere/)).toBeTruthy();
    // The full text of a lead item shows too, with its lead still bold.
    expect(within(win).getByText('The dark theme reads in layers').tagName).toBe('STRONG');
    expect(within(win).getByText(/Tinted buttons such as the filter/)).toBeTruthy();
    const hide = within(win).getByRole('button', { name: 'Hide details' });
    expect(hide.getAttribute('aria-expanded')).toBe('true');
    await userEvent.click(hide);
    expect(within(win).queryByText(/Run and Refresh look the same everywhere/)).toBeNull();
  });

  it('shows a preamble in the short view', async () => {
    setup('0.16.0', { current: '0.17.0' });
    const win = await screen.findByRole('dialog');
    expect(within(win).getByText(/Click "Always Allow"\./)).toBeTruthy();
    expect(within(win).getByText('Updated from 0.16.0 to 0.17.0 · 1 release')).toBeTruthy();
  });

  it('waits for the restored-tabs hint, then opens once it is gone', async () => {
    const stored = '0.19.0';
    const set = vi.fn(async (_k: string, v: unknown) => v);
    installAtelierMock({
      prefs: { get: (async () => stored) as never, set: set as never },
    });
    const view = render(<Tree h={hints({ visibleId: 'startup.restore' })} />);
    await act(async () => {});
    expect(dialog()).toBeNull();
    view.rerender(<Tree h={hints({ visibleId: null })} />);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(set).toHaveBeenCalledWith(KEY, '0.20.0');
  });

  it('waits for the hints to load', async () => {
    const stored = '0.19.0';
    installAtelierMock({ prefs: { get: (async () => stored) as never, set: (async (_k: string, v: unknown) => v) as never } });
    const view = render(<Tree h={hints({ loaded: false, settled: false })} />);
    await act(async () => {});
    expect(dialog()).toBeNull();
    view.rerender(<Tree h={hints()} />);
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('with tabs restored, waits for the restored-tabs hint to clear however long that takes, not the settle period', async () => {
    const stored = '0.19.0';
    installAtelierMock({
      prefs: { get: (async () => stored) as never, set: (async (_k: string, v: unknown) => v) as never },
      tabs: { list: (async () => [{ id: 't1' }]) as never },
    });
    // Hints loaded and settled, and no hint registered yet: the old timer-based
    // gate would open here, before a slow restore registers its hint.
    render(<Tree h={hints()} />);
    await act(async () => {});
    expect(dialog()).toBeNull();
    act(() => settleRestoreHint());
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('with nothing restored, opens without waiting on the workspace', async () => {
    setup('0.19.0');
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('does not open a window over another hint that is showing', async () => {
    setup('0.19.0', { h: hints({ visibleId: 'run.execute' }) });
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('does not open while the command palette is open, and opens when it closes', async () => {
    act(() => setPaletteOpen(true));
    const { set } = setup('0.19.0');
    await act(async () => {});
    expect(dialog()).toBeNull();
    expect(set).not.toHaveBeenCalled();
    act(() => setPaletteOpen(false));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(set).toHaveBeenCalledWith(KEY, '0.20.0');
  });

  it('stays open when the palette opens over it afterwards', async () => {
    setup('0.19.0');
    await screen.findByRole('dialog');
    act(() => setPaletteOpen(true));
    expect(dialog()).not.toBeNull();
  });

  it('opens nothing and stores the version after a downgrade', async () => {
    const { set } = setup('0.21.0');
    await waitFor(() => expect(set).toHaveBeenCalledWith(KEY, '0.20.0'));
    expect(dialog()).toBeNull();
  });

  it('opens nothing and writes nothing when the stored version is the current one', async () => {
    const { set } = setup('0.20.0');
    await act(async () => {});
    expect(dialog()).toBeNull();
    expect(set).not.toHaveBeenCalled();
  });

  it('opens nothing but stores the version when the range holds no release', async () => {
    const set = vi.fn(async (_k: string, v: unknown) => v);
    installAtelierMock({ prefs: { get: (async () => '0.19.0') as never, set: set as never } });
    render(
      <HintsContext.Provider value={hints()}>
        <WhatsNewProvider currentVersion="0.20.0" releases={[]}>
          <Reopen />
        </WhatsNewProvider>
      </HintsContext.Provider>,
    );
    await waitFor(() => expect(set).toHaveBeenCalledWith(KEY, '0.20.0'));
    expect(dialog()).toBeNull();
  });

  it('opens nothing and logs when the preference cannot be read', async () => {
    const log = vi.fn(async () => {});
    const set = vi.fn(async (_k: string, v: unknown) => v);
    installAtelierMock({
      prefs: {
        get: (async () => {
          throw new Error('disk gone');
        }) as never,
        set: set as never,
      },
      app: { log },
    });
    render(<Tree h={hints()} />);
    await waitFor(() => expect(log).toHaveBeenCalled());
    expect(JSON.stringify(log.mock.calls)).toContain('reading the last seen version');
    expect(dialog()).toBeNull();
    expect(set).not.toHaveBeenCalled();
  });

  it('logs and carries on when the version cannot be stored', async () => {
    const log = vi.fn(async () => {});
    installAtelierMock({
      prefs: {
        get: (async () => null) as never,
        set: (async () => {
          throw new Error('read-only');
        }) as never,
      },
      app: { log },
    });
    render(<Tree h={hints()} />);
    await waitFor(() => expect(log).toHaveBeenCalled());
    expect(JSON.stringify(log.mock.calls)).toContain('saving the last seen version');
  });
});

describe('What’s new window controls', () => {
  it('closes on Escape', async () => {
    setup('0.19.0');
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(dialog()).toBeNull());
  });

  it('closes on the close button and on Got it', async () => {
    setup('0.19.0');
    let win = await screen.findByRole('dialog');
    await userEvent.click(within(win).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(dialog()).toBeNull());

    await userEvent.click(screen.getByRole('button', { name: 'Reopen notes' }));
    win = await screen.findByRole('dialog');
    await userEvent.click(within(win).getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(dialog()).toBeNull());
  });

  it('does not open again after closing', async () => {
    setup('0.19.0');
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(dialog()).toBeNull());
    await act(async () => {});
    expect(dialog()).toBeNull();
  });

  it('opens the full changelog on GitHub', async () => {
    const { openExternal } = setup('0.19.0');
    const win = await screen.findByRole('dialog');
    await userEvent.click(within(win).getByRole('button', { name: /Full changelog/ }));
    expect(openExternal).toHaveBeenCalledWith(FULL_CHANGELOG_URL);
    expect(FULL_CHANGELOG_URL).toBe('https://github.com/anonhym/latelier/blob/main/CHANGELOG.md');
  });

  it('shows a toast when the changelog link cannot be opened', async () => {
    installAtelierMock({
      prefs: { get: (async () => '0.19.0') as never, set: (async (_k: string, v: unknown) => v) as never },
      app: {
        openExternal: async () => {
          throw new Error('blocked');
        },
      },
    });
    render(<Tree h={hints()} />);
    const win = await screen.findByRole('dialog');
    await userEvent.click(within(win).getByRole('button', { name: /Full changelog/ }));
    expect(await screen.findByText('Could not open the changelog')).toBeTruthy();
  });

  it('reopens on demand with the current release only', async () => {
    setup('0.20.0');
    await act(async () => {});
    expect(dialog()).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Reopen notes' }));
    const win = await screen.findByRole('dialog');
    expect(within(win).getByText('Version 0.20.0')).toBeTruthy();
    expect(within(win).getByText('0.20.0 · 13 Nov 2026')).toBeTruthy();
    expect(within(win).queryByRole('button', { name: /0\.19\.1/ })).toBeNull();
  });

  it('says so when the running version has no entry', async () => {
    setup('9.9.9', { current: '9.9.9' });
    await userEvent.click(screen.getByRole('button', { name: 'Reopen notes' }));
    const win = await screen.findByRole('dialog');
    expect(within(win).getByText('No release notes for this version.')).toBeTruthy();
    expect(within(win).queryByRole('button', { name: 'Show details' })).toBeNull();
  });

  it('useWhatsNew fails loudly outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Reopen />)).toThrow('useWhatsNew must be used inside <WhatsNewProvider>');
    spy.mockRestore();
  });
});
