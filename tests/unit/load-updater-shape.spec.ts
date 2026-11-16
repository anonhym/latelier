import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// loadUpdater reads `default.autoUpdater` off the CommonJS module. The getter
// itself needs the real Electron runtime, so only its presence is checked: a
// dependency bump that moves the export must fail here, not silently disable
// updates.
describe('electron-updater module shape', () => {
  it('exposes autoUpdater on the default export, as loadUpdater reads it', async () => {
    const mod = (await import('electron-updater')) as unknown as { default: object };
    expect(typeof mod.default).toBe('object');
    expect('autoUpdater' in mod.default).toBe(true);
    const desc = Object.getOwnPropertyDescriptor(mod.default, 'autoUpdater');
    expect(desc).toBeDefined();
  });
});

// UpdateService subscribes to these by name, so a bump that renames or drops
// one would silently stop the matching state change. The autoUpdater getter
// needs the Electron runtime, so the names are read from the package itself:
// the emit calls in the compiled AppUpdater, and the typed event map.
describe('electron-updater events UpdateService listens to', () => {
  const pkgDir = dirname(createRequire(import.meta.url).resolve('electron-updater/package.json'));
  const compiled = readFileSync(join(pkgDir, 'out', 'AppUpdater.js'), 'utf8');
  const typings = readFileSync(join(pkgDir, 'out', 'AppUpdater.d.ts'), 'utf8');

  it.each(['checking-for-update', 'update-available', 'update-not-available', 'error'])(
    'AppUpdater emits %s',
    (event) => {
      expect(compiled).toContain(`this.emit("${event}"`);
    },
  );

  it.each(['update-available', 'update-not-available', 'download-progress', 'update-downloaded'])(
    'the typed event map declares %s',
    (event) => {
      expect(typings).toContain(`"${event}":`);
    },
  );
});
