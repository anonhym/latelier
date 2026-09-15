import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, fireEvent, waitFor, within, act } from '../helpers/render';
import { EditDrawer } from '../../src/pages/Workspace/EditDrawer';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

/**
 * X15 T1 — the dialog shell and the unsaved-changes guard.
 *
 * The behavioural specs for this drawer live in `edit-drawer-*.spec.tsx`; this
 * file covers only what the Mantine migration is responsible for — the a11y
 * set the hand-rolled overlay never had, and the guard that stops a stray
 * dismissal from discarding typed text.
 *
 * Two of these tests are the ticket's mutation targets and are named as such.
 */

const DOC = { _id: 42, sku: 'abc', qty: 5 };

function renderDrawer(onClose: () => void = vi.fn()) {
  installAtelierMock({});
  render(
    <EditDrawer
      connectionId="c1"
      dbName="db"
      collection="coll"
      doc={DOC}
      onClose={onClose}
      onSaved={() => undefined}
    />,
  );
  return onClose;
}

const drawer = () => screen.getByRole('dialog', { name: 'Edit document' });
const discardPrompt = () => screen.queryByRole('dialog', { name: 'Discard changes?' });
/** The overlay carries no role by design, so it has no accessible handle. */
const overlay = () => document.body.querySelector('.mantine-Drawer-overlay') as HTMLElement;
const textarea = () => screen.getByRole('textbox') as HTMLTextAreaElement;

/** Let a click's async handler settle so a *negative* assertion means something. */
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('EditDrawer — dialog shell (X15 T1)', () => {
  it('puts role="dialog" on the panel — the element holding the editor, not the backdrop', () => {
    renderDrawer();
    expect(within(drawer()).getByRole('textbox')).toBeTruthy();
    expect(overlay()).not.toBeNull();
    expect(overlay().getAttribute('role')).toBeNull();
  });

  it('names the dialog "Edit document" and gives the close control an aria-label', () => {
    renderDrawer();
    // `getByRole('dialog', { name: … })` above already proves the accessible
    // name; the ✕ had no label at all before the migration.
    expect(within(drawer()).getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('moves focus into the panel on open', async () => {
    renderDrawer();
    await waitFor(() => expect(drawer().contains(document.activeElement)).toBe(true));
  });

  it('returns focus to the trigger when the drawer closes', async () => {
    installAtelierMock({});
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open editor</button>
          {open && (
            <EditDrawer
              connectionId="c1"
              dbName="db"
              collection="coll"
              doc={DOC}
              onClose={() => setOpen(false)}
              onSaved={() => undefined}
            />
          )}
        </>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open editor' });
    await user.click(trigger);
    await waitFor(() => expect(drawer().contains(document.activeElement)).toBe(true));

    fireEvent.keyDown(document.body, { key: 'Escape' });

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Edit document' })).toBeNull(),
    );
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('Escape closes a clean drawer without prompting', async () => {
    const onClose = renderDrawer();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(discardPrompt()).toBeNull();
  });

  it('closing a clean drawer from Cancel does not prompt', async () => {
    const onClose = renderDrawer();
    fireEvent.click(within(drawer()).getByRole('button', { name: 'Cancel' }));
    await settle();
    expect(discardPrompt()).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('EditDrawer — unsaved-changes guard (X15 T1)', () => {
  it('Escape with a dirty buffer prompts, and Cancel leaves the typed text intact', async () => {
    const onClose = renderDrawer();
    const typed = '{"sku": "edited-by-hand"}';
    fireEvent.change(textarea(), { target: { value: typed } });

    fireEvent.keyDown(document.body, { key: 'Escape' });

    const prompt = await screen.findByRole('dialog', { name: 'Discard changes?' });
    fireEvent.click(within(prompt).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(discardPrompt()).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect(textarea().value).toBe(typed);
  });

  it('Escape with a dirty buffer closes once Discard is confirmed', async () => {
    const onClose = renderDrawer();
    fireEvent.change(textarea(), { target: { value: '{"sku": "edited"}' } });

    fireEvent.keyDown(document.body, { key: 'Escape' });

    const prompt = await screen.findByRole('dialog', { name: 'Discard changes?' });
    fireEvent.click(within(prompt).getByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  /**
   * MUTATION TARGET 1 — delete `closeOnClickOutside={false}` from EditDrawer
   * and the last assertion must go red: the backdrop starts routing through
   * `requestClose` and raises a prompt the user never asked for. The other two
   * assertions stay green under that mutation, which is exactly why "no prompt"
   * has to be asserted rather than "text survived".
   *
   * Do not "fix" this test into expecting a prompt. An inert backdrop is the
   * point: `closeOnClickOutside={false}` is what stops one stray click from
   * reaching the close path at all.
   */
  it('a backdrop click with a dirty buffer is inert — no close, no prompt, text intact', async () => {
    const onClose = renderDrawer();
    const typed = '{"sku": "half-typed';
    fireEvent.change(textarea(), { target: { value: typed } });

    fireEvent.click(overlay());
    await settle();

    expect(textarea().value).toBe(typed);
    expect(onClose).not.toHaveBeenCalled();
    expect(discardPrompt()).toBeNull();
  });

  /**
   * MUTATION TARGET 2 — narrow `isDirty` in EditDrawer to the active buffer
   * (`mode === 'replace' ? docJson !== initialDocJson.current : patchJson !== '{}'`)
   * and this must go red. `switchMode` preserves both buffers, so the typed
   * $set patch is still there and still lost on close.
   */
  it('a dirty $set patch prompts even while Replace mode is the one on screen', async () => {
    const onClose = renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: /Update fields/i }));
    fireEvent.change(textarea(), { target: { value: '{"status": "shipped"}' } });

    // Back to Replace: the visible buffer is the untouched document again.
    fireEvent.click(screen.getByRole('button', { name: /Replace document/i }));
    expect(textarea().value).toContain('"sku"');

    fireEvent.click(within(drawer()).getByRole('button', { name: 'Cancel' }));

    const prompt = await screen.findByRole('dialog', { name: 'Discard changes?' });
    fireEvent.click(within(prompt).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(discardPrompt()).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
  });
});
