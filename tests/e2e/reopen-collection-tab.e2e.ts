import { test, expect } from '@playwright/test';
import {
  baseConnInput,
  startMemoryServer,
  stopAllMemoryServers,
  withApp,
} from '../helpers/e2eApp';
import { WorkspacePage } from './pages';
import { seedActiveConnectionWithDocs } from './helpers/uiSeed';
import { expectStatusDot } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

/** W01 §14.8: a closed collection tab comes back with the filter it had. */
test('reopen: a closed collection tab returns with its filter', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await seedActiveConnectionWithDocs(
      win,
      { ...baseConnInput(host, port), name: 'Reopen Target' },
      { dbName: 'shop', collection: 'orders', docs: [{ sku: 'apple-001' }, { sku: 'banana-002' }] },
    );
    await expectStatusDot(win, 'Reopen Target', 'connected');

    const ws = new WorkspacePage(win);
    await ws.openCollectionFromNavigator('shop', 'orders');
    await expect(win.getByText('apple-001')).toBeVisible({ timeout: 8000 });

    const filter = '{"sku":"banana-002"}';
    await ws.queryBarTextarea.fill(filter);
    await ws.queryBarTextarea.blur();
    await ws.queryBarRunButton.click();
    await expect(win.getByText('apple-001')).toHaveCount(0);

    await ws.closeTab('orders');
    await win.keyboard.press('ControlOrMeta+Shift+T');
    await expect(ws.queryBarTextarea).toHaveValue(filter, { timeout: 5000 });
  });
});
