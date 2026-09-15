import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '../helpers/render';
import { ConnectionDeleteDialog } from '../../src/features/connections/ConnectionDeleteDialog';
import { uninstallAtelierMock } from '../helpers/atelierMock';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

/**
 * `returnFocusTo`, for openers the render-time capture cannot see.
 *
 * `useDialogFocusReturn` normally captures `document.activeElement` during the
 * dialog's first render. That works whenever the trigger is still on screen at
 * that moment — and it is not, when a surface unmounts itself and mounts a
 * dialog in the same commit. `ConnectionExpandedTable` does exactly that: a row
 * action closes the table and opens the dialog together, so the row button is
 * already detached before the dialog renders, `.focus()` on it is a silent
 * no-op, and focus falls to `<body>` — the same defect this file set out to remove,
 * reached by a different route.
 *
 * The harness below reproduces that shape rather than mocking it: the trigger
 * is genuinely unmounted in the same state update that mounts the dialog.
 */

/** Mirrors `Workspace.tsx`: the row unmounts as the dialog mounts. */
function Harness({ withReturnFocus }: { withReturnFocus: boolean }) {
  const [open, setOpen] = React.useState(false);
  // A callback ref into state, not a `useRef`: this is read during render to
  // build the dialog's props, and `react-hooks/refs` refuses that for a ref —
  // the same constraint that shaped `Workspace.tsx`'s side of this.
  const [survivor, setSurvivor] = React.useState<HTMLButtonElement | null>(null);

  return (
    <>
      {/* Stands in for the Switcher control the table itself was opened from —
          the one element still on screen once both table and dialog are gone. */}
      <button ref={setSurvivor}>Switcher</button>

      {!open && (
        <button onClick={() => setOpen(true)}>Delete row</button>
      )}

      {open && (
        <ConnectionDeleteDialog
          name="Prod"
          tabCount={0}
          onCancel={() => setOpen(false)}
          onConfirm={() => undefined}
          returnFocusTo={withReturnFocus ? survivor : undefined}
        />
      )}
    </>
  );
}

describe('useDialogFocusReturn — returnFocusTo', () => {
  /**
   * MUTATION TARGET — drop the `returnFocusTo` parameter from the hook (or
   * stop threading the prop) and this goes red: focus falls to `<body>`,
   * because the row button it would otherwise capture no longer exists.
   */
  it('returns focus to the supplied element when the trigger is already gone', async () => {
    const user = userEvent.setup();
    render(<Harness withReturnFocus />);

    await user.click(screen.getByRole('button', { name: 'Delete row' }));
    await screen.findByRole('alertdialog');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Switcher' })),
    );
  });

  /**
   * The control: the same flow WITHOUT the prop lands on `<body>`. Without this
   * the test above would pass just as well against a hook that always focused
   * the survivor for some unrelated reason.
   */
  it('lands on <body> without it — the defect this prop exists for', async () => {
    const user = userEvent.setup();
    render(<Harness withReturnFocus={false} />);

    await user.click(screen.getByRole('button', { name: 'Delete row' }));
    await screen.findByRole('alertdialog');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Switcher' }));
  });
});
