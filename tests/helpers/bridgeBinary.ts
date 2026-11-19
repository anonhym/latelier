import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundledBridgePath } from '../../electron/agent/bridgePaths';
import { isCi } from './ci';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '../..');

/** Where `scripts/build-bridge.mjs` puts the bridge for this machine; the app reads the same path in development. */
export function bridgeBinaryPath(): string {
  return bundledBridgePath({
    platform: process.platform,
    arch: process.arch,
    isPackaged: false,
    resourcesPath: '',
    appRoot: REPO_ROOT,
  });
}

export function bridgeBinaryPresent(): boolean {
  return fs.existsSync(bridgeBinaryPath());
}

/**
 * A suite that needs the built bridge skips on a developer machine without a
 * Rust toolchain, where `scripts/build-bridge.mjs` only warns. On CI a skip is
 * a hole: the workflow builds the bridge, so its absence means that step broke
 * and the coverage silently vanished. Call this in a test of its own.
 */
export function assertBridgeBuiltOnCi(): void {
  if (isCi() && !bridgeBinaryPresent()) {
    throw new Error(`the Agent Bridge is missing on CI: ${bridgeBinaryPath()} (run scripts/build-bridge.mjs before the tests)`);
  }
}
