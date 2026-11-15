import { test, expect, type Locator, type Page } from '@playwright/test';
import { stopAllMemoryServers } from '../helpers/e2eApp';
import { withOpenOrders } from './helpers/uiSeed';

test.afterAll(stopAllMemoryServers);

/**
 * X07 lists ⌘K under "Anywhere": a focused text field, input or CodeMirror
 * editor must not swallow it. Mantine's hotkey defaults ignored keydowns from
 * INPUT, TEXTAREA, SELECT and contenteditable, so the palette was dead while
 * typing a filter, and ⌘K in the open palette did nothing (#787).
 */
test('⌘K opens the palette from the Filter, the navigator filter and the script editor, and closes it from its own input', async () => {
  await withOpenOrders('Shortcut From Fields', [{ sku: 'apple-001' }], 'apple-001', async (win, ws) => {
    const palette = win.locator('input[aria-label="Search commands"]');

    // Warm-up from no focused field. The first ⌘K after a cold launch can be
    // dropped on CI (#657), so only this one retries; the checks below get a
    // single keypress each, which is what keeps a swallowed shortcut visible.
    await expect(async () => {
      if (!(await palette.isVisible())) await win.keyboard.press('ControlOrMeta+K');
      await expect(palette).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 8000 });
    // ⌘K toggles: pressed in the open palette's own input, it closes it.
    await win.keyboard.press('ControlOrMeta+K');
    await expect(palette).toBeHidden();

    const opensFrom = async (field: Locator, page: Page) => {
      await field.click();
      await expect(field).toBeFocused();
      await page.keyboard.press('ControlOrMeta+K');
      await expect(palette).toBeVisible({ timeout: 2000 });
      await page.keyboard.press('Escape');
      await expect(palette).toBeHidden();
    };

    await opensFrom(ws.queryBarTextarea, win);
    await opensFrom(ws.navigatorFilter, win);

    await ws.openNewScript();
    await opensFrom(win.getByRole('textbox', { name: 'Script editor' }), win);
  });
});
