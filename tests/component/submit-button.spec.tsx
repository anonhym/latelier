import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '../helpers/render';
import { SubmitButton } from '../../src/components/SubmitButton';

/**
 * #91 — the contract this component exists to hold: `submitting` never sets
 * the real `disabled` attribute (that's what let Chromium blur a focused
 * confirm button to `<body>` on activation, with nothing to restore it on a
 * failure — see the e2e spec `x19-submit-failure-focus.e2e.ts`; jsdom does
 * not implement that blur at all, so it can't be asserted here). What jsdom
 * *can* see is the guard: `aria-disabled` for styling/AT, and a swallowed
 * click.
 */
describe('SubmitButton', () => {
  it('stays real-enabled while submitting, but marks aria-disabled and swallows the click', async () => {
    const onClick = vi.fn();
    render(
      <SubmitButton submitting onClick={onClick}>
        Save
      </SubmitButton>,
    );

    const button = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    // The disabled *look* — Mantine styles on `data-disabled`, not on the attribute.
    expect(button.getAttribute('data-disabled')).toBe('true');

    button.click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('calls onClick when not submitting', () => {
    const onClick = vi.fn();
    render(
      <SubmitButton submitting={false} onClick={onClick}>
        Save
      </SubmitButton>,
    );

    screen.getByRole('button', { name: 'Save' }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps a real disabled when the caller passes one, independent of submitting', () => {
    const onClick = vi.fn();
    render(
      <SubmitButton submitting={false} disabled onClick={onClick}>
        Save
      </SubmitButton>,
    );

    const button = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    button.click();
    expect(onClick).not.toHaveBeenCalled();
  });
});
