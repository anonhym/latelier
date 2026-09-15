import { describe, it, expect, afterEach, vi } from 'vitest';
import { Drawer, Modal } from '@mantine/core';
import { render, screen, within } from '../helpers/render';
import { uninstallAtelierMock } from '../helpers/atelierMock';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

/**
 * every dialog's ✕ has an accessible name, from one theme default.
 *
 * Mantine's `CloseButton` ships `defaultProps = { variant: 'subtle' }` and no
 * `aria-label`, so before this a dialog that didn't pass `closeButtonProps`
 * rendered a close control a screen reader announced as bare "button". Twelve
 * of the app's fourteen dialogs were in that state.
 *
 * These render bare Mantine primitives rather than app dialogs on purpose: the
 * claim under test is that the *theme* supplies the name, so pulling in a
 * component that passes its own `closeButtonProps` would prove nothing. The
 * last case pins the override direction, which is what makes the default safe
 * to apply globally.
 */
describe('CloseButton theme default', () => {
  it('names a Modal close button with no closeButtonProps', () => {
    render(
      <Modal opened onClose={() => undefined} title="Untouched modal">
        body
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Untouched modal' });
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('names a Drawer close button with no closeButtonProps', () => {
    render(
      <Drawer opened onClose={() => undefined} position="right" title="Untouched drawer">
        body
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Untouched drawer' });
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  /**
   * `useProps` merges theme defaults *under* explicit props. Without this, the
   * global default would be a ceiling rather than a floor and a dialog could
   * never give its ✕ a more specific name.
   */
  it('lets a call site override the default with a more specific name', () => {
    render(
      <Modal
        opened
        onClose={() => undefined}
        title="Specific"
        closeButtonProps={{ 'aria-label': 'Close explain' }}
      >
        body
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Specific' });
    expect(within(dialog).getByRole('button', { name: 'Close explain' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Close' })).toBeNull();
  });
});
