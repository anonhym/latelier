import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { MongoClient } from 'mongodb';
import type { ElectronApplication } from 'playwright';
import {
  baseConnInput,
  freshUserData,
  launchApp,
  startMemoryServer,
  stopAllMemoryServers,
  withApp,
} from '../helpers/e2eApp';
import { NewConnectionPage, WorkspacePage } from './pages';
import { expectConsoleClean } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

type Atelier = {
  conn: { create: (input: unknown) => Promise<{ id: string }>; delete: (id: string) => Promise<unknown> };
  secrets: { setPlaintextFallback: (enabled: boolean) => Promise<{ enabled: boolean }> };
};

/**
 * C03 §13.1 — a first run: the welcome canvas takes a pasted URI, Enter saves
 * a Connection named for its host and connects, and a collection opens from
 * the connected canvas.
 */
test('first run: paste a URI, press Enter, land connected, open a collection', async () => {
  const { host, port } = await startMemoryServer();
  const seed = await MongoClient.connect(`mongodb://${host}:${port}/?directConnection=true`);
  try {
    await seed.db('shop').collection('orders').insertMany([{ total: 100 }, { total: 50 }]);
  } finally {
    await seed.close();
  }

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      const ws = new WorkspacePage(win);
      await expect(ws.switcher.welcomeField).toBeVisible({ timeout: 10_000 });
      // No workbench around nothing: no navigator, no tab strip.
      await expect(ws.navigator).toHaveCount(0);

      await ws.switcher.welcomeField.fill(`mongodb://${host}:${port}/?directConnection=true`);
      await ws.switcher.welcomeField.press('Enter');

      // Saved, connected, and the welcome canvas gives way to the workbench.
      await expect(ws.switcher.welcomeField).toBeHidden({ timeout: 15_000 });
      await ws.waitNavigatorVisible();

      await ws.openCollectionFromNavigator('shop', 'orders');
      await expect(ws.tabByName('orders')).toBeVisible({ timeout: 5000 });
    });
  });
});

/**
 * W02 §16 — a saved Connection with the wrong password fails its connect with
 * an authentication error; the failure row's `Edit credentials…` opens the
 * form on Authentication, and a fixed password connects.
 */
test('wrong password: Edit credentials… opens Authentication, a fixed password connects', async () => {
  const { host, port } = await startMemoryServer({
    auth: { enable: true, customRootName: 'admin', customRootPwd: 'rootpw' },
  });
  const seed = await MongoClient.connect(`mongodb://admin:rootpw@${host}:${port}/?authSource=admin&directConnection=true`);
  try {
    await seed.db('shop').collection('orders').insertOne({ total: 100 });
  } finally {
    await seed.close();
  }

  const dir = freshUserData();
  let app: ElectronApplication | null = null;
  try {
    app = await launchApp(dir);
    // 'Enable' is button 1 in main's plaintext-fallback warning.
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox;
    });
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    const input = {
      ...baseConnInput(host, port),
      name: 'Auth Target',
      authMech: 'scram256' as const,
      authUsername: 'admin',
      authDatabase: 'admin',
      password: 'wrong-password',
    };
    // No OS keychain (Linux CI): opt into the plaintext fallback, as a user would.
    await win.evaluate(async (probe) => {
      const api = (window as unknown as { atelier: Atelier }).atelier;
      try {
        const c = await api.conn.create({ ...(probe as object), name: 'probe' });
        await api.conn.delete(c.id);
      } catch (err) {
        if ((err as { code?: string }).code !== 'SECRETS_UNAVAILABLE') throw err;
        await api.secrets.setPlaintextFallback(true);
      }
    }, input);

    const ws = new WorkspacePage(win);
    // Created over the bridge, then the focus event the list refreshes on.
    await win.evaluate(async (conn) => {
      await (window as unknown as { atelier: Atelier }).atelier.conn.create(conn);
      window.dispatchEvent(new Event('focus'));
    }, input);
    await ws.switcher.waitVisible();
    await ws.switcher.select('Auth Target');

    // The connect is rejected: the failure row offers the fix first.
    const failure = win.getByTestId('nav-connection-error');
    await expect(failure).toBeVisible({ timeout: 15_000 });
    await failure.getByRole('button', { name: 'Edit credentials for Auth Target' }).click();

    // The form opens on Authentication, not General.
    const form = new NewConnectionPage(win);
    await form.waitVisible();
    await expect(win.getByRole('tab', { name: 'Authentication', exact: true })).toHaveAttribute('aria-selected', 'true');
    await win.locator('input[type="password"]').fill('rootpw');
    await form.saveAndConnectButton.click();

    await expect(failure).toHaveCount(0, { timeout: 15_000 });
    await ws.waitForDb('shop');
  } finally {
    await app?.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
