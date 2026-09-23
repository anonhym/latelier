import { describe, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render } from '../helpers/render';
import { itReturnsFocusToPopoverTrigger } from '../helpers/popoverFocusReturn';
import { PreviewPicker } from '../../src/pages/Workspace/PreviewPicker';

const KNOWN_FIELDS = ['_id', 'apple', 'banana'];

function renderPicker(currentFields: string[] = [], onChange = vi.fn()) {
  return {
    ...render(
      <PreviewPicker
        knownFields={KNOWN_FIELDS}
        currentFields={currentFields}
        onChange={onChange}
      />,
    ),
    onChange,
  };
}

// #79 — closing the popover on a click that lands on a non-focusable area
// used to drop focus to <body>. `returnFocus` fixes it here because nothing
// in this dropdown autofocuses on open (see the prop's comment on
// `PreviewPicker.tsx`). Shared with column-chooser/table-view specs — see
// the helper's docstring.
describe('PreviewPicker — focus return on close (#79)', () => {
  itReturnsFocusToPopoverTrigger(async () => {
    const ctx = renderPicker();
    const trigger = ctx.getByRole('button', { name: /preview fields/i });
    await userEvent.click(trigger);
    return {
      trigger,
      focusInside: () => userEvent.click(ctx.getByRole('checkbox', { name: 'apple' })),
    };
  });
});
