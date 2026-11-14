// `Open monitor`, `Open users` and `Open roles` (X07 §13.5): offered with a
// Connection in context, they hand the Data View an intent to open that
// Connection's server tab on the section named, also when it is already showing.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '../helpers/render';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { CommandPaletteRoot, usePaletteApi, _resetPaletteStoreForTests } from '../../src/commands/CommandPalette';
import { PaletteContextProvider } from '../../src/commands/PaletteContext';
import { GlobalCommands } from '../../src/commands/GlobalCommands';
import { SettingsProvider } from '../../src/pages/SettingsContext';
import { commandRegistry } from '../../src/commands/registry';
import { setFocusedConnectionId } from '../../src/state/focusedConnection';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';

/** The Data View stand-in: shows the route intent a command handed it. */
function WorkspaceProbe() {
  const state = useLocation().state as { openServer?: unknown } | null;
  return <div data-testid="intent">{JSON.stringify(state?.openServer ?? null)}</div>;
}

function ToggleButton() {
  const palette = usePaletteApi();
  return <button onClick={palette.toggle}>toggle</button>;
}

function mount() {
  installAtelierMock({
    mongo: {
      status: async (id: string) => ({ id, status: 'disconnected' as const }),
      onStatus: () => () => {},
    },
  });
  render(
    <MemoryRouter initialEntries={['/workspace']}>
      <PaletteContextProvider>
        <SettingsProvider>
          <CommandPaletteRoot>
            <GlobalCommands />
            <ToggleButton />
            <Routes>
              <Route path="/workspace" element={<WorkspaceProbe />} />
            </Routes>
          </CommandPaletteRoot>
        </SettingsProvider>
      </PaletteContextProvider>
    </MemoryRouter>,
  );
}

function run(title: string) {
  fireEvent.click(screen.getByText('toggle'));
  fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: title } });
  const row = within(screen.getByRole('dialog', { name: 'Command palette' }))
    .getAllByRole('option')
    .find((o) => o.querySelector('[data-title]')?.getAttribute('data-title') === title)!;
  fireEvent.click(row);
}

const intent = () => JSON.parse(screen.getByTestId('intent').textContent ?? 'null');

afterEach(() => {
  uninstallAtelierMock();
  commandRegistry._resetForTests();
  _resetPaletteStoreForTests();
  act(() => setFocusedConnectionId(null));
  vi.restoreAllMocks();
});

describe('Connection screen commands', () => {
  it('are not offered with no Connection in context', () => {
    mount();
    fireEvent.click(screen.getByText('toggle'));
    fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: 'Open' } });
    const titles = within(screen.getByRole('dialog', { name: 'Command palette' }))
      .queryAllByRole('option')
      .map((o) => o.querySelector('[data-title]')?.getAttribute('data-title'));
    expect(titles).not.toContain('Open monitor');
    expect(titles).not.toContain('Open users');
    expect(titles).not.toContain('Open roles');
  });

  it('open the focused Connection’s server tab on the section named, again once there', async () => {
    act(() => setFocusedConnectionId('c1'));
    mount();
    run('Open users');
    await waitFor(() => expect(intent()).toEqual({ connectionId: 'c1', section: 'users' }));
    run('Open roles');
    await waitFor(() => expect(intent()).toEqual({ connectionId: 'c1', section: 'roles' }));
    run('Open monitor');
    await waitFor(() => expect(intent()).toEqual({ connectionId: 'c1', section: 'monitor' }));
  });
});
