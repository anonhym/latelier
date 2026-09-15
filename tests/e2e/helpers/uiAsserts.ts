import { expect, type Page } from '@playwright/test';
import { ConnectionSwitcherPage } from '../pages/ConnectionSwitcherPage';

// 'unknown' = never connected or freshly disconnected (sidebar maps 'disconnected' → 'unknown')
export type ConnectionStatusLabel = 'connected' | 'connecting' | 'disconnected' | 'error' | 'unknown';

/**
 * Assert the status dot for a given connection row reaches a target status.
 * The row's status rides `data-status` (see `ConnectionSwitcher.tsx`'s
 * `ConnectionRow` — a deliberate a11y choice: the accessible status lives in
 * `aria-describedby` text, not an `aria-label`, so `data-status` is the
 * visual/test hook). Polling timeout defaults to 8s because mongo.connect
 * over a memory server is normally <2s but cold starts on CI can stretch.
 *
 * Opens the ConnectionSwitcher popover first if it isn't already open — the
 * row this asserts against only exists in the DOM while the popover is open
 * (the row used to live in an always-visible sidebar) — and closes it
 * again afterward if this call was the one that opened it, so the assertion
 * doesn't leave a side effect for whatever the caller does next.
 */
export async function expectStatusDot(
  win: Page,
  name: string,
  status: ConnectionStatusLabel,
  timeout = 8000,
): Promise<void> {
  const switcher = new ConnectionSwitcherPage(win);
  const wasOpen = await switcher.listbox.isVisible().catch(() => false);
  await switcher.ensureOpen();
  const dot = switcher.statusDotWithValue(name, status);
  await expect(dot).toBeVisible({ timeout });
  if (!wasOpen) {
    await switcher.trigger.click();
    await expect(switcher.listbox).toHaveCount(0);
  }
}

/**
 * Wrap a body so any `console.error` or unhandled `pageerror` from the
 * renderer fails the test. Filters favicon / DevTools noise, matching the
 * existing renderer-first-paint pattern.
 *
 * Why: silent renderer regressions (an ErrorBoundary swallowing a render-time
 * crash, an effect throwing, a router warning) are invisible without this.
 *
 * Subtlety: the listener cleanup runs in `finally` so we never leak across
 * tests, but the console-clean *assertions* only run when the body succeeds.
 * If we asserted inside `finally`, a failing assertion here would mask the
 * original test-body error (e.g. a locator timeout or expect mismatch),
 * which is almost always the more useful signal to debug.
 */
export async function expectConsoleClean<T>(
  win: Page,
  fn: () => Promise<T>,
): Promise<T> {
  const errors: string[] = [];
  const pageErrors: string[] = [];
  const onConsole = (msg: { type: () => string; text: () => string }) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/favicon|DevTools/i.test(text)) return;
    errors.push(text);
  };
  const onPageError = (err: Error) => pageErrors.push(err.message);

  win.on('console', onConsole);
  win.on('pageerror', onPageError);
  let result: T;
  try {
    result = await fn();
  } finally {
    win.off('console', onConsole);
    win.off('pageerror', onPageError);
  }
  expect(
    errors,
    `unexpected console.error during UI flow:\n${errors.join('\n')}`,
  ).toEqual([]);
  expect(
    pageErrors,
    `unhandled renderer exception during UI flow:\n${pageErrors.join('\n')}`,
  ).toEqual([]);
  return result;
}
