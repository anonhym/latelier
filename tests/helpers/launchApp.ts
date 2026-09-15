import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { _electron as electron, type ElectronApplication } from 'playwright';

/**
 * Launch the packaged Electron app with an isolated userData directory.
 * Real Electron launch is used; skip tests on CI images without a display via
 * the standard PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD flag and the test harness.
 */
export async function launchApp(opts: { userDataDir?: string } = {}): Promise<{
  app: ElectronApplication;
  userDataDir: string;
}> {
  const userDataDir =
    opts.userDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'mongolab-e2e-'));
  const app = await electron.launch({
    args: [path.resolve(__dirname, '../..', 'dist-electron/main.js')],
    env: {
      ...process.env,
      ATELIER_USER_DATA_DIR: userDataDir,
      NODE_ENV: 'test',
    },
  });
  return { app, userDataDir };
}
