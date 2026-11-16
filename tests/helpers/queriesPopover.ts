import { fireEvent, screen, within } from '@testing-library/react';

/**
 * Opens the Filter Bar row's `Queries ▾` popover (W05 §10.2) on one of its two
 * lists. The popover opens on the list last used in the workspace tab, which
 * outlives a test, so the list is always chosen explicitly.
 */
export async function openQueriesTab(tab: 'Saved' | 'History', options?: { timeout?: number }): Promise<HTMLElement> {
  const trigger = await screen.findByTestId('query-bar-saved-btn', undefined, options);
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(await within(dialog).findByRole('tab', { name: tab }));
  return dialog;
}
