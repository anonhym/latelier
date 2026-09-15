import { test, expect } from '@playwright/test';
import {
  baseConnInput,
  startMemoryServer,
  stopAllMemoryServers,
  withApp,
} from '../helpers/e2eApp';
import { NewConnectionPage, WorkspacePage } from './pages';
import { seedConnection } from './helpers/uiSeed';
import { expectConsoleClean } from './helpers/uiAsserts';

test.afterAll(stopAllMemoryServers);

/**
 * C08 — Edit connection: the Switcher row's inline Edit action opens the
 * Connection form (as a modal) with existing values pre-loaded;
 * saving persists the change.
 */
test('edit connection: rename and save reflects in the list', async () => {
  const { host, port } = await startMemoryServer();

  await withApp(async (app) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await expectConsoleClean(win, async () => {
      const switcher = new WorkspacePage(win).switcher;
      await switcher.waitVisible();

      const { name } = await seedConnection(win, {
        ...baseConnInput(host, port),
        name: 'Before Rename',
      });
      await expect(switcher.item(name)).toBeVisible({ timeout: 8000 });

      // The row's inline Edit icon opens the same form as a modal (the
      // retired list screen's detail-panel Edit button no longer exists).
      await switcher.edit(name);

      const form = new NewConnectionPage(win);
      await form.waitVisible();

      // The name input should be pre-filled with the current name.
      await expect(form.nameInput).toHaveValue('Before Rename', { timeout: 5000 });

      // Rename it.
      await form.nameInput.fill('After Rename');

      // Save changes.
      await form.saveButton.click();

      // New name appears in the list; old name gone.
      await switcher.waitVisible();
      await expect(switcher.item('After Rename')).toBeVisible({ timeout: 8000 });
      await expect(switcher.item('Before Rename')).not.toBeVisible();
    });
  });
});
