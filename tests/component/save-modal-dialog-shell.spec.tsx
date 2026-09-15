import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, fireEvent, waitFor, within, act } from '../helpers/render';
import { SaveModal } from '../../src/pages/Workspace/SaveModal';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { BuilderState } from '@shared/types';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

/**
 * X15 T5 — the dialog shell, the unsaved-changes guard, and Enter.
 *
 * The payload behaviour lives in `save-modal.spec.tsx`; this file covers only
 * what the Mantine migration owns — the a11y set the hand-rolled overlay never
 * had, the guard that stops a stray dismissal from discarding a typed name,
 * and the `<form>` that makes Enter submit. Two tests are the ticket's mutation
 * targets and are named as such.
 */

const builderState: BuilderState = { projection: [], sort: '', limit: '' };

function renderModal(onClose: () => void = vi.fn()) {
  const created: unknown[] = [];
  installAtelierMock({
    saved: {
      create: (async (input: unknown) => {
        created.push(input);
        return { id: 'q1' };
      }) as never,
    },
  });
  render(
    <SaveModal
      connectionId="c1"
      dbName="shop"
      collection="orders"
      builderState={builderState}
      queryRaw="{}"
      onClose={onClose}
      onSaved={() => undefined}
    />,
  );
  return { onClose, created };
}

const modal = () => screen.getByRole('dialog', { name: 'Save query' });
const discardPrompt = () => screen.queryByRole('dialog', { name: 'Discard changes?' });
/** The overlay carries no role by design, so it has no accessible handle. */
const overlay = () => document.body.querySelector('.mantine-Modal-overlay') as HTMLElement;
const nameInput = () => screen.getByLabelText(/Name/) as HTMLInputElement;
const descriptionInput = () => screen.getByLabelText(/Description/) as HTMLTextAreaElement;

/** Let a click's async handler settle so a *negative* assertion means something. */
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('SaveModal — dialog shell (X15 T5)', () => {
  it('puts role="dialog" on the panel — the element holding the fields, not the backdrop', () => {
    renderModal();
    expect(within(modal()).getByLabelText(/Name/)).toBeTruthy();
    expect(overlay()).not.toBeNull();
    expect(overlay().getAttribute('role')).toBeNull();
  });

  it('names the dialog "Save query" and gives the close control an aria-label', () => {
    renderModal();
    // `getByRole('dialog', { name: … })` above already proves the accessible
    // name; the ✕ did not exist at all before the migration.
    expect(within(modal()).getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('moves focus into the panel on open', async () => {
    renderModal();
    await waitFor(() => expect(modal().contains(document.activeElement)).toBe(true));
  });

  it('returns focus to the trigger when the modal closes', async () => {
    installAtelierMock({});
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Save query</button>
          {open && (
            <SaveModal
              connectionId="c1"
              dbName="shop"
              collection="orders"
              builderState={builderState}
              queryRaw="{}"
              onClose={() => setOpen(false)}
              onSaved={() => undefined}
            />
          )}
        </>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Save query' });
    await user.click(trigger);
    await waitFor(() => expect(modal().contains(document.activeElement)).toBe(true));

    fireEvent.keyDown(document.body, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Save query' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('Escape closes a clean modal without prompting', async () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(discardPrompt()).toBeNull();
  });

  it('closing a clean modal from Cancel does not prompt', async () => {
    const { onClose } = renderModal();
    fireEvent.click(within(modal()).getByRole('button', { name: 'Cancel' }));
    await settle();
    expect(discardPrompt()).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('SaveModal — unsaved-changes guard (X15 T5)', () => {
  /**
   * MUTATION TARGET 1 — delete `closeOnClickOutside={false}` from SaveModal
   * and the last assertion must go red: the backdrop starts routing through
   * `requestClose` and raises a prompt the user never asked for. The other two
   * assertions stay green under that mutation, which is exactly why "no prompt"
   * has to be asserted rather than "text survived".
   *
   * Do not "fix" this test into expecting a prompt. An inert backdrop is the
   * point — see the spec's §3 note on why the prompting variant would make this
   * mutation a no-op.
   */
  it('a backdrop click with a typed name is inert — no close, no prompt, text intact', async () => {
    const { onClose } = renderModal();
    fireEvent.change(nameInput(), { target: { value: 'Half-typed name' } });

    fireEvent.click(overlay());
    await settle();

    expect(nameInput().value).toBe('Half-typed name');
    expect(onClose).not.toHaveBeenCalled();
    expect(discardPrompt()).toBeNull();
  });

  it('Escape with a typed name prompts, and Cancel leaves the text intact', async () => {
    const { onClose } = renderModal();
    fireEvent.change(nameInput(), { target: { value: 'Top skus' } });

    fireEvent.keyDown(document.body, { key: 'Escape' });

    const prompt = await screen.findByRole('dialog', { name: 'Discard changes?' });
    fireEvent.click(within(prompt).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(discardPrompt()).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect(nameInput().value).toBe('Top skus');
  });

  it('Escape with a typed name closes once Discard is confirmed', async () => {
    const { onClose } = renderModal();
    fireEvent.change(nameInput(), { target: { value: 'Top skus' } });

    fireEvent.keyDown(document.body, { key: 'Escape' });

    const prompt = await screen.findByRole('dialog', { name: 'Discard changes?' });
    fireEvent.click(within(prompt).getByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('a description alone is dirty too', async () => {
    const { onClose } = renderModal();
    fireEvent.change(descriptionInput(), { target: { value: 'a note' } });

    fireEvent.click(within(modal()).getByRole('button', { name: 'Cancel' }));

    await screen.findByRole('dialog', { name: 'Discard changes?' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('SaveModal — Enter submits (X15 T5)', () => {
  /**
   * MUTATION TARGET 2 — remove the `<form>` wrapper (or `type="submit"` from
   * Save) and this goes red: the fields become bare siblings again and Enter
   * does nothing, which is the original defect verbatim.
   *
   * `type="button"` on Cancel is part of the same wiring — without it, the
   * first submit button in tree order is Cancel, and Enter would dismiss the
   * dialog instead of saving.
   */
  it('Enter in the name field runs the same save as clicking Save', async () => {
    const user = userEvent.setup();
    const { created } = renderModal();

    await user.type(nameInput(), 'Top skus{Enter}');

    await waitFor(() => expect(created.length).toBe(1));
    expect(created[0]).toMatchObject({ name: 'Top skus' });
  });

  it('Enter in the description field submits as well', async () => {
    const user = userEvent.setup();
    const { created } = renderModal();

    await user.type(nameInput(), 'Top skus');
    await user.type(descriptionInput(), 'a note{Enter}');

    await waitFor(() => expect(created.length).toBe(1));
    expect(created[0]).toMatchObject({ payload: { description: 'a note' } });
  });

  it('Shift+Enter in the description newlines instead of submitting', async () => {
    const user = userEvent.setup();
    const { created } = renderModal();

    await user.type(nameInput(), 'Top skus');
    await user.type(descriptionInput(), 'line one{Shift>}{Enter}{/Shift}line two');

    expect(created.length).toBe(0);
    expect(descriptionInput().value).toBe('line one\nline two');
  });

  it('Enter with an empty name newlines instead of submitting', async () => {
    const user = userEvent.setup();
    const { created } = renderModal();

    await user.type(descriptionInput(), 'orphan note{Enter}');

    await settle();
    expect(created.length).toBe(0);
    // MUTATION TARGET — hoist `e.preventDefault()` back above the `!canSubmit`
    // guard and this line goes red while the one above stays green: the
    // keystroke is neither a save nor a newline, so a user drafting a
    // multi-line note before naming the query cannot get a line break.
    expect(descriptionInput().value).toBe('orphan note\n');
  });

  /**
   * MUTATION TARGET — drop the `isComposing` guard and this goes red. An IME
   * commit is a keydown with `key === 'Enter'`; treating it as submit saves
   * the query with a half-composed description, which is a CJK-only data bug
   * no other test in this file can see.
   */
  it('Enter that commits an IME candidate does not submit', async () => {
    const user = userEvent.setup();
    const { created } = renderModal();

    await user.type(nameInput(), 'Top skus');
    await user.type(descriptionInput(), 'nihon');
    fireEvent.keyDown(descriptionInput(), { key: 'Enter', isComposing: true });

    await settle();
    expect(created.length).toBe(0);
  });
});
