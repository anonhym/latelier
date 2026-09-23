import React from 'react';
import { Button, type ButtonProps } from '@mantine/core';

type SubmitButtonProps = ButtonProps &
  React.ComponentPropsWithoutRef<'button'> & {
    submitting: boolean;
  };

/**
 * A confirm/submit button for a dialog (Modal/Drawer) that must survive its
 * own activation. Chromium blurs a focused element once it goes `disabled` —
 * moving focus to `<body>` — but not synchronously with the attribute
 * change: measured directly, a button read `disabled` and still focused
 * right after the change and on the next animation frame, and only showed
 * `<body>` focused around 50ms later. A button that goes
 * `disabled={submitting}` while still focused gets ejected from the dialog
 * a beat after the user clicks it; on a failure that leaves the dialog open,
 * nothing ever restores focus (#91). Fix: stay enabled while submitting and
 * fake the disabled *look* with `data-disabled`/`aria-disabled` — styling
 * only (`Button.mjs:74`), not the real DOM attribute. Don't use Mantine's
 * `loading` prop instead: it sets the real `disabled` (`Button.mjs:72`) and
 * reintroduces the blur.
 *
 * `onClick` is swallowed (and prevented, for a `type="submit"` button inside
 * a `<form>`) while submitting, but callers reachable another way — Enter in
 * an input, a form's own `onSubmit`, a keymap — still need their own
 * `submitting` guard in the handler; this only covers the click.
 */
export function SubmitButton({ submitting, disabled, onClick, ...props }: SubmitButtonProps) {
  return (
    <Button
      {...props}
      disabled={disabled}
      data-disabled={submitting || undefined}
      aria-disabled={submitting || undefined}
      onClick={(e) => {
        if (submitting) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
    />
  );
}
