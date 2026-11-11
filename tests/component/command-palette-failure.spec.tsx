import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import {
  CommandPaletteRoot,
  usePaletteApi,
  _resetPaletteStoreForTests,
} from '../../src/commands/CommandPalette';
import { PaletteContextProvider } from '../../src/commands/PaletteContext';
import { useRegisterCommands } from '../../src/commands/useRegisterCommands';
import { commandRegistry } from '../../src/commands/registry';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';

function ToggleButton() {
  const palette = usePaletteApi();
  return <button onClick={palette.toggle}>toggle</button>;
}

/** Whether the palette was still open at each moment a command ran. */
const openAtPerform: boolean[] = [];

function Register({ perform }: { perform: () => void | Promise<void> }) {
  const palette = usePaletteApi();
  useRegisterCommands(
    [
      {
        id: 'test.export',
        title: 'Export collection…',
        group: 'general',
        perform: () => {
          openAtPerform.push(palette.isOpen());
          return perform();
        },
      },
    ],
    [perform, palette],
  );
  return null;
}

function mount(perform: () => void | Promise<void>) {
  installAtelierMock({});
  return render(
    <MemoryRouter>
      <PaletteContextProvider>
        <CommandPaletteRoot>
          <Register perform={perform} />
          <ToggleButton />
        </CommandPaletteRoot>
      </PaletteContextProvider>
    </MemoryRouter>,
  );
}

async function run() {
  fireEvent.click(screen.getByText('toggle'));
  fireEvent.click(await screen.findByText('Export collection…'));
}

afterEach(() => {
  openAtPerform.length = 0;
  // The notification store outlives a test.
  notifications.clean();
  commandRegistry._resetForTests();
  _resetPaletteStoreForTests();
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('a command that fails', () => {
  it('toasts once, naming the command and carrying the error message, after the palette closes', async () => {
    mount(() => Promise.reject(new Error('The connection to Production was lost.')));
    await run();

    expect(await screen.findByText('Couldn\'t run "Export collection…"')).toBeTruthy();
    expect(screen.getByText('The connection to Production was lost.')).toBeTruthy();
    expect(screen.getAllByText(/Couldn't run/)).toHaveLength(1);
    await waitFor(() => expect(screen.queryByLabelText('Search commands')).toBeNull());
    // The palette was already closed when the command ran, so the toast follows it.
    expect(openAtPerform).toEqual([false]);
  });

  it('toasts for a synchronous throw as well', async () => {
    mount(() => {
      throw new Error('boom');
    });
    await run();

    expect(await screen.findByText('boom')).toBeTruthy();
    expect(screen.getAllByText(/Couldn't run/)).toHaveLength(1);
  });

  it('toasts in a production build, where nothing is logged', async () => {
    vi.stubEnv('DEV', false);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mount(() => Promise.reject(new Error('nope')));
      await run();
      expect(await screen.findByText('nope')).toBeTruthy();
      expect(error).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('falls back to a plain message when the failure carries none', async () => {
    mount(() => Promise.reject(undefined));
    await run();
    expect(await screen.findByText('The command failed.')).toBeTruthy();
  });

  it('toasts nothing when the command succeeds', async () => {
    mount(() => {});
    await run();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText(/Couldn't run/)).toBeNull();
  });
});
