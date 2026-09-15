import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, fireEvent, waitFor, within, act } from '../helpers/render';
import { ReferenceRulesEditor } from '../../src/features/references/ReferenceRulesEditor';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { ReferenceRule } from '@shared/types';

/**
 * X15 T8 — the dialog shell and the unsaved-changes guard.
 *
 * The rule CRUD behaviour lives in `reference-rules-editor.spec.tsx`; this file
 * covers only what the Mantine migration owns — the a11y set the hand-rolled
 * overlay never had, and the guard that stops a stray dismissal from discarding
 * a half-filled rule. Three tests are this ticket's mutation targets and are
 * named as such.
 */

const RULE: ReferenceRule = {
  id: 'rule-1',
  connectionId: 'conn-1',
  sourceDb: 'shop',
  sourceCollection: 'orders',
  sourceField: 'contact_id',
  targetDb: 'shop',
  targetCollection: 'contacts',
  targetField: '_id',
  projection: [],
  enabled: true,
  createdAt: '2026-04-24T00:00:00.000Z',
  updatedAt: '2026-04-24T00:00:00.000Z',
};

beforeEach(() => {
  installAtelierMock({
    refs: { list: (async () => [RULE]) as never } as never,
  });
});

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

const editor = () => screen.getByRole('dialog', { name: 'Reference rules' });
const discardPrompt = () => screen.queryByRole('dialog', { name: 'Discard changes?' });
/** The overlay carries no role by design, so it has no accessible handle. */
const overlay = () => document.body.querySelector('.mantine-Modal-overlay') as HTMLElement;

/** Let a click's async handler settle so a *negative* assertion means something. */
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

function renderEditor(onClose: () => void = vi.fn()) {
  render(
    <ReferenceRulesEditor
      connectionId="conn-1"
      dbName="shop"
      collection="orders"
      onClose={onClose}
    />,
  );
  return { onClose };
}

/** Open the rule form the way the user does, and hand back its fields. */
async function openNewRuleForm() {
  fireEvent.click(await screen.findByRole('button', { name: 'New rule' }));
  return {
    sourceField: (await screen.findByLabelText('Source field')) as HTMLInputElement,
    targetCollection: screen.getByLabelText('Target collection') as HTMLInputElement,
    targetDb: screen.getByLabelText('Target database') as HTMLInputElement,
    displayTemplate: screen.getByLabelText('Display template') as HTMLInputElement,
    enabled: screen.getByLabelText('Enabled') as HTMLInputElement,
  };
}

describe('ReferenceRulesEditor — dialog shell (X15 T8)', () => {
  /**
   * MUTATION TARGET 1 — put the role back on the backdrop with
   * `overlayProps={{ role: 'dialog' }}` and the last assertion goes red.
   *
   * The `role` has to be asserted null explicitly. A name-filtered
   * `getByRole('dialog', { name: 'Reference rules' })` stays green under that
   * mutation because the overlay has no accessible name and so never matches
   * the filter — which is exactly how a screen-reader user ends up being read
   * the scrim. Do not "simplify" this back to a name lookup.
   */
  it('puts role="dialog" on the panel, and the backdrop carries no role', async () => {
    renderEditor();
    await screen.findByLabelText('Delete rule');
    expect(within(editor()).getByRole('button', { name: 'New rule' })).toBeTruthy();
    expect(overlay()).not.toBeNull();
    expect(overlay().getAttribute('role')).toBeNull();
  });

  it('names the dialog "Reference rules" and gives the close control an aria-label', async () => {
    renderEditor();
    await screen.findByLabelText('Delete rule');
    // `editor()` above already proves the accessible name is exactly
    // "Reference rules" — the `db.collection` subtitle moved into the body
    // rather than into the title for that reason.
    expect(within(editor()).getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(within(editor()).getByText('shop.orders')).toBeTruthy();
  });

  it('moves focus into the panel on open', async () => {
    renderEditor();
    await waitFor(() => expect(editor().contains(document.activeElement)).toBe(true));
  });

  it('returns focus to the trigger when the editor closes', async () => {
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Reference rules</button>
          {open && (
            <ReferenceRulesEditor
              connectionId="conn-1"
              dbName="shop"
              collection="orders"
              onClose={() => setOpen(false)}
            />
          )}
        </>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Reference rules' });
    await user.click(trigger);
    await waitFor(() => expect(editor().contains(document.activeElement)).toBe(true));

    fireEvent.keyDown(document.body, { key: 'Escape' });

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Reference rules' })).toBeNull(),
    );
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('Escape closes a clean editor without prompting', async () => {
    const { onClose } = renderEditor();
    await screen.findByLabelText('Delete rule');

    fireEvent.keyDown(document.body, { key: 'Escape' });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(discardPrompt()).toBeNull();
  });
});

describe('ReferenceRulesEditor — unsaved-changes guard (X15 T8)', () => {
  /**
   * MUTATION TARGET 2 — delete `closeOnClickOutside={false}` and the last
   * assertion goes red: the backdrop starts routing through `requestClose` and
   * raises a prompt the user never asked for.
   *
   * Do not "fix" this into expecting a prompt. An inert backdrop is the point —
   * with `onClose={requestClose}` a prompting backdrop would survive the
   * mutation unchanged, so "no prompt" is the only assertion that discriminates
   * (spec §3).
   */
  it('a backdrop click with a half-filled rule is inert — no close, no prompt, fields intact', async () => {
    const { onClose } = renderEditor();
    const f = await openNewRuleForm();
    fireEvent.change(f.targetCollection, { target: { value: 'contacts' } });

    fireEvent.click(overlay());
    await settle();

    expect((screen.getByLabelText('Target collection') as HTMLInputElement).value).toBe('contacts');
    expect(onClose).not.toHaveBeenCalled();
    expect(discardPrompt()).toBeNull();
  });

  it('Escape with a half-filled rule prompts, and Cancel keeps every field', async () => {
    const { onClose } = renderEditor();
    const f = await openNewRuleForm();
    fireEvent.change(f.sourceField, { target: { value: 'contact_id' } });
    fireEvent.change(f.targetCollection, { target: { value: 'contacts' } });
    fireEvent.change(f.displayTemplate, { target: { value: '{name}' } });

    fireEvent.keyDown(document.body, { key: 'Escape' });

    const prompt = await screen.findByRole('dialog', { name: 'Discard changes?' });
    fireEvent.click(within(prompt).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(discardPrompt()).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Source field') as HTMLInputElement).value).toBe('contact_id');
    expect((screen.getByLabelText('Target collection') as HTMLInputElement).value).toBe('contacts');
    expect((screen.getByLabelText('Display template') as HTMLInputElement).value).toBe('{name}');
  });

  it('Escape with a half-filled rule closes once Discard is confirmed', async () => {
    const { onClose } = renderEditor();
    const f = await openNewRuleForm();
    fireEvent.change(f.targetCollection, { target: { value: 'contacts' } });

    fireEvent.keyDown(document.body, { key: 'Escape' });

    const prompt = await screen.findByRole('dialog', { name: 'Discard changes?' });
    fireEvent.click(within(prompt).getByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  /**
   * MUTATION TARGET 3 — narrow `isDirty` to a single field (say
   * `form.sourceField !== formInitialSourceField`) and this goes red. The
   * `enabled` checkbox is chosen on purpose: it is the field furthest from the
   * one the user starts in, and it is a boolean defaulting to `true`, so a
   * bare-truthy `form.enabled ||` term would read dirty on a clean open and
   * clean once unticked — exactly backwards. The clean-close test below pins
   * the other side of that.
   */
  it('unticking Enabled — no text typed at all — still prompts', async () => {
    const { onClose } = renderEditor();
    const f = await openNewRuleForm();
    expect(f.enabled.checked).toBe(true);

    fireEvent.click(f.enabled);
    fireEvent.click(within(editor()).getByRole('button', { name: 'Close' }));

    await screen.findByRole('dialog', { name: 'Discard changes?' });
    expect(onClose).not.toHaveBeenCalled();
  });

  /**
   * MUTATION TARGET 4 — swap the snapshot comparison for literal emptiness
   * checks (`form.targetDb !== '' || form.targetField !== '' || form.enabled`)
   * and this goes red. `emptyForm` seeds `targetDb`, `targetField: '_id'` and
   * `enabled: true`, so a freshly opened form is *pre-filled* and every one of
   * those literals reports dirty before the user has typed anything.
   */
  it('closing with an untouched rule form open does not prompt', async () => {
    const { onClose } = renderEditor();
    await openNewRuleForm();

    fireEvent.click(within(editor()).getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(discardPrompt()).toBeNull();
  });

  it('an existing rule opened for edit is clean until it is changed', async () => {
    const { onClose } = renderEditor();
    fireEvent.click(await screen.findByLabelText('Edit rule'));
    await screen.findByLabelText('Target collection');

    fireEvent.click(within(editor()).getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(discardPrompt()).toBeNull();
  });
});
