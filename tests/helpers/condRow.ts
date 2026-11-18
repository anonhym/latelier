import { fireEvent, screen } from '@testing-library/react';

/** Opens a condition's value-type menu (the chip in its value box) and picks `type`. */
export async function pickValueType(type: string, index = 0): Promise<void> {
  const chips = screen.getAllByRole('button', { name: /^Value type: / });
  fireEvent.click(chips[index]!);
  fireEvent.click(await screen.findByRole('menuitem', { name: type }));
}

/** Opens the row menu of condition `position` (its path label, e.g. `1`) and removes it. */
export async function removeCondition(position = '1'): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: `Condition options ${position}` }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));
}
