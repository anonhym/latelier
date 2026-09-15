import { describe, it, expect, afterEach, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, fireEvent, waitFor, within } from '../helpers/render';
import { ConnectionForm } from '../../src/features/connections/ConnectionForm';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

/**
 * X15 T8 — the dialog shell for `PlaintextFallbackModal`.
 *
 * The behaviour that gets the user from a `SECRETS_UNAVAILABLE` save to a
 * retried one is already covered by `new-connection.spec.tsx` and
 * `connection-form-modal.spec.tsx`; this file covers only what the Mantine
 * migration owns — the a11y set the hand-rolled overlay never had.
 *
 * There is NO guard test here, and that is deliberate. This modal holds no
 * typed input, so `closeOnClickOutside={false}` would be an equivalent mutation:
 * nothing a test could watch survive a backdrop click. Focus-in, focus-return
 * and Escape are asserted instead — see the ticket's "Verify by mutation".
 */

/** The overlay carries no role by design, so it has no accessible handle. */
const overlay = () => document.body.querySelector('.mantine-Modal-overlay') as HTMLElement;
const fallback = () => screen.getByTestId('plaintext-fallback-modal');

/**
 * Fill the minimum SCRAM connection and save, with `conn.create` rejecting
 * `SECRETS_UNAVAILABLE` so the plaintext modal opens. Returns the Save button —
 * the trigger focus must come back to.
 */
async function openFallback() {
  const createSpy = vi.fn(async () => {
    throw { code: 'SECRETS_UNAVAILABLE', message: 'OS keychain not accessible' };
  });
  installAtelierMock({
    conn: { create: createSpy as never },
    prefs: { get: async () => null, set: vi.fn(async (_k: string, v: unknown) => v) } as never,
  });
  render(<ConnectionForm mode="create" onSaved={vi.fn()} onCancel={vi.fn()} />);

  await userEvent.type(await screen.findByPlaceholderText(/My MongoDB Server/i), 'X');
  await userEvent.type(screen.getByPlaceholderText(/cluster.mongodb.net/i), 'localhost');
  await userEvent.click(screen.getByText('Auth'));
  await userEvent.selectOptions(screen.getAllByRole('combobox')[0]!, 'scram256');
  await userEvent.type(screen.getAllByPlaceholderText('admin')[0]!, 'alice');
  await userEvent.type(await screen.findByPlaceholderText(/^••••••••$/), 'pw');

  // `userEvent`, not `fireEvent` — the click has to actually focus Save for the
  // focus-return assertion below to mean anything. `.closest('button')` because
  // Mantine's Button wraps its label in a <span>, and focus lands on the button.
  const save = screen.getByText(/^Save$/).closest('button')!;
  await userEvent.click(save);

  await screen.findByTestId('plaintext-fallback-modal');
  return { save, createSpy };
}

describe('PlaintextFallbackModal — dialog shell (X15 T8)', () => {
  /**
   * MUTATION TARGET — put the role back on the backdrop with
   * `overlayProps={{ role: 'dialog' }}` and the last assertion goes red.
   *
   * The `role` had to be asserted null explicitly: a name-filtered
   * `getByRole('dialog', { name: … })` stays green under that mutation, because
   * the overlay has no accessible name and so never matches the filter. Do not
   * "simplify" this back to a name lookup.
   */
  it('puts role="dialog" on the panel, and the backdrop carries no role', async () => {
    await openFallback();
    const panel = fallback();
    expect(panel.getAttribute('role')).toBe('dialog');
    // The testid moved from the backdrop to the panel in this migration; the
    // consuming specs' `within(...)` scoping depends on it landing here.
    expect(within(panel).getByText(/Store as plaintext/i)).toBeTruthy();
    expect(overlay()).not.toBeNull();
    expect(overlay().getAttribute('role')).toBeNull();
  });

  it('names the dialog and gives the close control an aria-label', async () => {
    await openFallback();
    expect(screen.getByRole('dialog', { name: 'OS keychain unavailable' })).toBe(fallback());
    expect(within(fallback()).getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('moves focus into the panel on open', async () => {
    await openFallback();
    await waitFor(() => expect(fallback().contains(document.activeElement)).toBe(true));
  });

  it('Escape closes it and leaves the connection form standing', async () => {
    await openFallback();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByTestId('plaintext-fallback-modal')).toBeNull(),
    );
    // The security decision is declined, not made — the form is still standing
    // on its Auth tab, with the typed username intact, so the user can switch
    // to X.509 instead.
    expect((screen.getAllByPlaceholderText('admin')[0] as HTMLInputElement).value).toBe('alice');
  });

  it('returns focus to the Save button that opened it', async () => {
    const { save } = await openFallback();
    await waitFor(() => expect(fallback().contains(document.activeElement)).toBe(true));

    fireEvent.keyDown(document.body, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByTestId('plaintext-fallback-modal')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(save));
  });

  it('the ✕ declines without enabling plaintext storage', async () => {
    const { createSpy } = await openFallback();
    fireEvent.click(within(fallback()).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByTestId('plaintext-fallback-modal')).toBeNull());
    expect(createSpy).toHaveBeenCalledTimes(1);
  });
});
