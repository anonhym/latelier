import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { stopAllMemoryServers, withApp } from '../helpers/e2eApp';

test.afterAll(stopAllMemoryServers);

/**
 * Closing the window must not kill the app.
 *
 * On macOS the app deliberately outlives its window — `window-all-closed` only
 * quits off darwin, and `activate` builds a new one. That leaves a window of
 * time where main-process code still holds a `BrowserWindow` reference to a
 * window the user has closed, and **reading `.webContents` off a destroyed one
 * throws** rather than returning null. So `win?.webContents` looks like a null
 * check and is not one.
 *
 * `nativeTheme` fires `'updated'` without anyone asking — the OS switches to
 * dark mode at sunset — so this was reachable by doing nothing at all.
 *
 * The assertion reads the log rather than the process state on purpose. The
 * throw becomes an `uncaughtException`, which `reportFatalAndExit` turns into a
 * dialog and `app.exit(1)`; by the time a test notices the process is gone it
 * has lost the reason. The `fatal` line is the durable evidence, and it is what
 * separates "closed cleanly" from "died on the way out".
 */
// macOS only, and not as a flake dodge — the bug's precondition does not exist
// elsewhere. `window-all-closed` calls `app.quit()` on every platform but
// darwin, so off macOS the process is gone before anything can read a stale
// window reference, and the log this asserts on ends at `shutdown: end`.
//
// The fix itself (`win = null` on `'closed'`) is platform-independent and
// applies everywhere; only the reproduction is darwin-shaped.
test.skip(process.platform !== 'darwin', 'off darwin the app quits with its last window');

test('the app survives its window closing, then an OS theme change', async () => {
  await withApp(async (app, userDataDir) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await app.evaluate(async ({ BrowserWindow, nativeTheme }) => {
      BrowserWindow.getAllWindows().forEach((w) => w.close());
      await new Promise((r) => setTimeout(r, 600));
      // Flip to whichever the OS is not, so 'updated' actually fires.
      nativeTheme.themeSource = nativeTheme.shouldUseDarkColors ? 'light' : 'dark';
      await new Promise((r) => setTimeout(r, 800));
    });

    const logsDir = path.join(userDataDir, 'logs');
    const file = fs.readdirSync(logsDir).find((f) => f.endsWith('.log'));
    expect(file, 'the app wrote a log at all').toBeTruthy();
    const fatals = fs
      .readFileSync(path.join(logsDir, file!), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
      .filter((l) => l.tag === 'fatal');

    expect(fatals.map((f) => `${f.msg}: ${f.data?.message ?? ''}`)).toEqual([]);
  });
});
