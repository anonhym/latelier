import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import { CommandPaletteRoot, _resetPaletteStoreForTests } from '../../src/commands/CommandPalette';
import { PaletteContextProvider } from '../../src/commands/PaletteContext';
import { commandRegistry } from '../../src/commands/registry';
import { TroubleshootingProvider } from '../../src/troubleshooting/TroubleshootingProvider';
import { TroubleshootingPaletteCommand } from '../../src/troubleshooting/TroubleshootingPaletteCommand';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';

afterEach(() => {
  commandRegistry._resetForTests();
  _resetPaletteStoreForTests();
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

function dispatchPaletteToggle() {
  // Mantine's useHotkeys (used by Spotlight) listens on document.documentElement,
  // not document — dispatch there so the shortcut handler fires.
  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const init: KeyboardEventInit = { key: 'k', bubbles: true, cancelable: true };
  if (isMac) init.metaKey = true;
  else init.ctrlKey = true;
  document.documentElement.dispatchEvent(new KeyboardEvent('keydown', init));
}

function Harness() {
  return (
      <MemoryRouter>
        <PaletteContextProvider>
          <CommandPaletteRoot>
            <TroubleshootingProvider>
              <TroubleshootingPaletteCommand />
            </TroubleshootingProvider>
          </CommandPaletteRoot>
        </PaletteContextProvider>
      </MemoryRouter>
  );
}

describe('TroubleshootingPaletteCommand', () => {
  it('opens the drawer on the unknown recipe when invoked from the palette', async () => {
    installAtelierMock({});
    render(<Harness />);

    act(() => dispatchPaletteToggle());

    // Filter to our command.
    fireEvent.change(screen.getByLabelText('Search commands'), {
      target: { value: 'troubleshoot' },
    });

    const item = await screen.findByText('Open connection troubleshooting');
    fireEvent.keyDown(item, { key: 'Enter' });

    // Drawer renders the unknown recipe.
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(screen.getByText('Connection failed')).toBeTruthy();
  });
});
