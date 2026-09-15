import { test, expect } from '@playwright/test';
import {
  baseConnInput,
  startMemoryServer,
  stopAllMemoryServers,
  withApp,
} from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import { seedActiveConnectionWithDocs } from './helpers/uiSeed';
import { expectConsoleClean, expectStatusDot } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

/**
 * W07 — Field autocomplete. Run a query so the suggestion sources have field
 * data, add a builder condition, focus the field input, click a suggestion,
 * and verify the input filled with the selected field path.
 *
 * SuggestionPopover renders `role="listbox"` (aria-label "Field suggestions")
 * + `role="option"` items (`src/features/fieldSuggestions/SuggestionPopover.tsx`).
 * The aria-label disambiguates it from the builder's "Value type" Select, which
 * also exposes role="listbox".
 */
test('autocomplete: focusing builder field input lists known fields; click fills the input', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      await seedActiveConnectionWithDocs(
        win,
        { ...baseConnInput(host, port), name: 'Autocomplete Target' },
        {
          dbName: 'shop',
          collection: 'orders',
          docs: [
            { sku: 'apple', stockLevel: 12, status: 'paid' },
            { sku: 'banana', stockLevel: 3, status: 'pending' },
          ],
        },
      );
      await expectStatusDot(win, 'Autocomplete Target', 'connected');

      const ws = new WorkspacePage(win);
      await ws.openCollectionFromNavigator('shop', 'orders');

      // Run once so suggestions ingest the schema from rendered docs.
      await ws.queryBarRunButton.click();
      await expect(win.getByText('apple')).toBeVisible({ timeout: 8000 });

      // Add a condition row, focus its field input → popover opens on focus
      // (`BuilderPane.tsx:109` — onFocus={() => setFieldPopoverOpen(true)}).
      await win.getByRole('button', { name: 'Add condition' }).click();
      const fieldInput = win.getByPlaceholder('field').first();
      await fieldInput.click();

      // Popover lists known fields. Pick `stockLevel` — unique enough to be
      // unambiguous across the page (the docs themselves render the value, not
      // the path, so the only "stockLevel" text comes from the popover).
      const popover = win.getByRole('listbox', { name: 'Field suggestions' });
      await expect(popover).toBeVisible({ timeout: 4000 });
      await popover.getByRole('option', { name: /stockLevel/ }).first().click();

      // Input now contains the picked field path.
      await expect(fieldInput).toHaveValue('stockLevel');
    });
  });
});
