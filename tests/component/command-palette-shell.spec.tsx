import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import {
  CommandPaletteRoot,
  usePaletteApi,
  _resetPaletteStoreForTests,
} from '../../src/commands/CommandPalette';
import { PaletteContextProvider } from '../../src/commands/PaletteContext';
import { useRegisterCommands } from '../../src/commands/useRegisterCommands';
import { commandRegistry } from '../../src/commands/registry';

function harness(ui: React.ReactElement) {
  return (
      <MemoryRouter>
        <PaletteContextProvider>
          <CommandPaletteRoot>{ui}</CommandPaletteRoot>
        </PaletteContextProvider>
      </MemoryRouter>
  );
}

// X12 Phase 5: Mantine's useHotkeys listens on document.documentElement, not
// document itself — so synthetic keyboard events must be dispatched on the
// documentElement to reach Spotlight's shortcut handler.
function dispatchToggle() {
  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const init: KeyboardEventInit = { key: 'k', bubbles: true, cancelable: true };
  if (isMac) init.metaKey = true;
  else init.ctrlKey = true;
  document.documentElement.dispatchEvent(new KeyboardEvent('keydown', init));
}

function ToggleButton() {
  const palette = usePaletteApi();
  return <button onClick={palette.toggle}>toggle</button>;
}

function RegisterTest({ perform }: { perform: () => void }) {
  useRegisterCommands(
    [
      { id: 'test.alpha', title: 'Test Alpha', group: 'general', perform },
      { id: 'test.beta', title: 'Test Beta', group: 'general', perform: () => {} },
    ],
    [perform],
  );
  return null;
}

afterEach(() => {
  commandRegistry._resetForTests();
  // Module-level Spotlight store persists across tests; reset its open/query
  // state so each test starts with the palette closed.
  _resetPaletteStoreForTests();
});

describe('<CommandPalette>', () => {
  it('opens on ⌘K and closes on Esc', async () => {
    render(harness(<RegisterTest perform={() => {}} />));

    act(() => dispatchToggle());
    expect(screen.getByRole('dialog')).toBeTruthy();

    // Mantine Modal listens for Escape on the focus trap root; fire on the
    // dialog itself rather than document so the listener picks it up.
    act(() => {
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('dialog')).not.toBeTruthy();
  });

  it('renders registered commands and filters on substring', () => {
    render(harness(<RegisterTest perform={() => {}} />));
    act(() => dispatchToggle());
    expect(screen.getByText('Test Alpha')).toBeTruthy();
    expect(screen.getByText('Test Beta')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: 'alpha' } });
    expect(screen.getByText('Test Alpha')).toBeTruthy();
    expect(screen.queryByText('Test Beta')).not.toBeTruthy();
  });

  it('Enter performs the cursor command and closes', () => {
    const perform = vi.fn();
    render(harness(<RegisterTest perform={perform} />));
    act(() => dispatchToggle());
    fireEvent.keyDown(screen.getByRole('dialog').querySelector('[role="option"]')!, {
      key: 'Enter',
    });
    expect(perform).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeTruthy();
  });

  it('shows a no-matches message when the query matches nothing', () => {
    render(harness(<RegisterTest perform={() => {}} />));
    act(() => dispatchToggle());
    fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: 'zzz' } });
    expect(screen.getByText(/No matches for "zzz"/)).toBeTruthy();
  });

  it('exposes a stable api: toggle button works before keyboard listener fires', () => {
    render(harness(<><RegisterTest perform={() => {}} /><ToggleButton /></>));
    fireEvent.click(screen.getByText('toggle'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByText('toggle'));
    expect(screen.queryByRole('dialog')).not.toBeTruthy();
  });
});

describe('useRegisterCommands', () => {
  it('registers on mount and unregisters on unmount', () => {
    const { unmount } = render(harness(<RegisterTest perform={() => {}} />));
    expect(commandRegistry.list().map((c) => c.id).sort()).toEqual(['test.alpha', 'test.beta']);
    unmount();
    expect(commandRegistry.list()).toHaveLength(0);
  });
});
