import { it, expect } from 'vitest';
import userEvent from '@testing-library/user-event';
import { waitFor } from './render';

/**
 * #79 — every Popover-anchored trigger in the Data View owes the same three
 * cases: an Escape guard, a click-another-control guard, and the regression
 * itself (a click that closes the popover on a non-focusable area must not
 * drop focus to `<body>`). Column chooser, preview picker, and the table's
 * expand-cell popover were three near-identical copies of this block —
 * SonarCloud's new-code duplication gate on this repo, same shape #56/#72
 * already hit — so it lives here once.
 *
 * `open` renders and opens the popover fresh for each case (state must not
 * leak between them) and returns the now-focused trigger; `focusInside`, if
 * given, focuses a control inside the dropdown before the dismissing click,
 * matching a keyboard user's real state (sites with no focusable dropdown
 * content — the table's expand-cell popover — omit it).
 *
 * Every open here must be a real `userEvent` click, never `fireEvent.click`:
 * `fireEvent.click` doesn't focus the trigger, so Mantine's saved return
 * target would already be `<body>` and every case below would look fixed
 * whether or not it actually is.
 */
export function itReturnsFocusToPopoverTrigger(
  open: () => Promise<{ trigger: HTMLElement; focusInside?: () => Promise<void> }>,
) {
  it('guard: Escape returns focus to the trigger', async () => {
    const { trigger } = await open();

    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('guard: clicking another focusable control outside leaves focus there', async () => {
    await open();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    try {
      await userEvent.click(outside);
      await waitFor(() => expect(document.activeElement).toBe(outside));
    } finally {
      outside.remove();
    }
  });

  it('returns focus to the trigger, not <body>, when a click closes the popover on a non-focusable area', async () => {
    const { trigger, focusInside } = await open();
    if (focusInside) await focusInside();
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    try {
      await userEvent.click(outside);
      await waitFor(() => {
        expect(document.activeElement).toBe(trigger);
        expect(document.activeElement).not.toBe(document.body);
      });
    } finally {
      outside.remove();
    }
  });
}
