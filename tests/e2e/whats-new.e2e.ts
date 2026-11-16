import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { freshUserData, withApp, withAppOnUserData } from '../helpers/e2eApp';

/**
 * X22 §6.2 — the What's new window. A fresh profile must never see it (this
 * guards every other e2e spec), and a profile last seen on an older version
 * sees it once and can dismiss it with Escape.
 */
const KEY = 'whatsNew.lastSeenVersion';
const CURRENT = (
  JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../package.json'), 'utf8')) as {
    version: string;
  }
).version;
const DIALOG_NAME = "What's new in L'Atelier";

interface PrefsBridge {
  atelier: {
    prefs: {
      get: (key: string) => Promise<unknown>;
      set: (key: string, value: unknown) => Promise<unknown>;
    };
  };
}

test('a fresh profile shows no What’s new window and records the current version', async () => {
  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    // The stored version is written once the renderer has read the empty slot.
    await expect
      .poll(() => win.evaluate((k) => (window as unknown as PrefsBridge).atelier.prefs.get(k), KEY))
      .toBe(CURRENT);
    // Past the hints' settle period, which is the latest the window could open.
    await win.waitForTimeout(2500);
    await expect(win.getByRole('dialog', { name: DIALOG_NAME })).toHaveCount(0);
  });
});

test('a profile last seen on an older version sees the window, and Escape closes it', async () => {
  const userDataDir = freshUserData();
  try {
    // Launch one: let the app record its version, then rewind it, as a profile
    // that has just been updated would look. (There is no way to seed `app_state`
    // before the first launch, so the rewind goes through the same bridge.)
    await withAppOnUserData(userDataDir, async (app) => {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      await expect
        .poll(() => win.evaluate((k) => (window as unknown as PrefsBridge).atelier.prefs.get(k), KEY))
        .toBe(CURRENT);
      await win.evaluate((k) => (window as unknown as PrefsBridge).atelier.prefs.set(k, '0.19.0'), KEY);
    });

    // Launch two: the window opens, and the version is stored again.
    await withAppOnUserData(userDataDir, async (app) => {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      const dialog = win.getByRole('dialog', { name: DIALOG_NAME });
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await expect(dialog.getByText(`Updated from 0.19.0 to ${CURRENT}`, { exact: false })).toBeVisible();
      await expect
        .poll(() => win.evaluate((k) => (window as unknown as PrefsBridge).atelier.prefs.get(k), KEY))
        .toBe(CURRENT);

      await win.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    });
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
