import { describe, it, expect } from 'vitest';

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
