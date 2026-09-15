import { test, expect } from '@playwright/test';
import {
  baseConnInput,
  startMemoryServer,
  stopAllMemoryServers,
  withApp,
} from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import { seedActiveConnection, seedConnection } from './helpers/uiSeed';
import { expectStatusDot } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

/**
 * the Connection Switcher's keyboard contract, driven in a real
 * Electron window.
 *
 * The component suite covers the branching (wrap, clamping, ⌫ vs. text edit).
 * What only a real window can answer is whether focus actually lands where the
 * contract says: jsdom will happily report a focused element that a real
 * browser never focused, and `autoFocus` inside a portalled popover plus
 * focus-return on close is exactly the pairing that breaks quietly.
 */
test('switcher: keyboard-only find-and-switch, and focus returns to the trigger', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    // Two Connections against the same server — the switch is the subject, not
    // the topology. The Data View is the app's home now, so seeding
    // 'Alpha Cluster' first (via seedActiveConnection) already makes it
    // Active; there is no separate list screen to select it from first.
    const alpha = await seedActiveConnection(win, {
      ...baseConnInput(host, port),
      name: 'Alpha Cluster',
    });
    expect(alpha.id).toBeTruthy();
    await expectStatusDot(win, 'Alpha Cluster', 'connected');
    await seedConnection(win, { ...baseConnInput(host, port), name: 'Beta Cluster' });

    const switcher = new WorkspacePage(win).switcher;
    // X16.4 — the generic trigger: opening a Connection opens no tab,
    // so the TitleBar names none.
    const trigger = switcher.trigger;
    await expect(trigger).toBeVisible({ timeout: 8000 });
    await trigger.click();

    // The search field takes focus on open — this is what makes the whole
    // gesture keyboard-only, and it is the assertion jsdom cannot be trusted on.
    await expect(switcher.searchInput).toBeFocused({ timeout: 5000 });
    expect(await switcher.highlightedName()).toBe('Alpha Cluster');

    // status reaches someone who can't see the colour band. Asserted
    // here as well as in the component suite because `VisuallyHidden` is a
    // CSS-dependent primitive: jsdom would report its text either way.
    expect(await switcher.describedText('Alpha Cluster')).toMatch(/connected/i);
    expect(await switcher.describedText('Beta Cluster')).toMatch(/not connected/i);

    // ↓ walks and wraps, without focus ever leaving the search field.
    await win.keyboard.press('ArrowDown');
    await expect
      .poll(() => switcher.highlightedName())
      .toBe('Beta Cluster');
    await expect(switcher.searchInput).toBeFocused();
    await win.keyboard.press('ArrowDown');
    await expect
      .poll(() => switcher.highlightedName())
      .toBe('Alpha Cluster');

    // Type to narrow, then ↵ — one uninterrupted gesture, no mouse.
    await win.keyboard.type('beta');
    await expect(switcher.item('Alpha Cluster')).toHaveCount(0);
    expect(await switcher.highlightedName()).toBe('Beta Cluster');
    await win.keyboard.press('Enter');

    await expect(switcher.listbox).toHaveCount(0);
    await expectStatusDot(win, 'Beta Cluster', 'connected');

    // Esc changes nothing and hands focus back to the trigger, so the user is
    // left on the control they opened rather than at the top of the tab order.
    const betaTrigger = switcher.trigger;
    await betaTrigger.click();
    await expect(switcher.searchInput).toBeFocused({ timeout: 5000 });
    await win.keyboard.press('Escape');
    await expect(switcher.listbox).toHaveCount(0);
    await expect(betaTrigger).toBeFocused({ timeout: 5000 });
  });
});
