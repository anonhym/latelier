import { describe, it, expect } from 'vitest';
import {
  bridgeFileName,
  bridgeOs,
  bundledBridgePath,
  installedBridgeDir,
  installedBridgePath,
} from '../../electron/agent/bridgePaths';

describe('bridgeOs and bridgeFileName', () => {
  it.each([
    ['darwin', 'mac', 'latelier-agent-bridge'],
    ['win32', 'win', 'latelier-agent-bridge.exe'],
    ['linux', 'linux', 'latelier-agent-bridge'],
    ['freebsd', 'linux', 'latelier-agent-bridge'],
  ] as const)('%s is %s with the file %s', (platform, os, file) => {
    expect(bridgeOs(platform)).toBe(os);
    expect(bridgeFileName(platform)).toBe(file);
  });
});

describe('bundledBridgePath', () => {
  const base = { arch: 'arm64', resourcesPath: '/Applications/Atelier.app/Contents/Resources', appRoot: '/src/latelier' };

  it('is bin/ among the resources when packaged, whatever the arch', () => {
    expect(bundledBridgePath({ ...base, platform: 'darwin', isPackaged: true })).toBe(
      '/Applications/Atelier.app/Contents/Resources/bin/latelier-agent-bridge',
    );
  });

  it('is the build script output in development, named by os and arch', () => {
    expect(bundledBridgePath({ ...base, platform: 'darwin', isPackaged: false })).toBe(
      '/src/latelier/build/bridge/mac-arm64/latelier-agent-bridge',
    );
    expect(bundledBridgePath({ ...base, platform: 'linux', arch: 'x64', isPackaged: false })).toBe(
      '/src/latelier/build/bridge/linux-x64/latelier-agent-bridge',
    );
  });

  it('uses Windows separators and the .exe name for a Windows build, from any host', () => {
    expect(
      bundledBridgePath({
        platform: 'win32',
        arch: 'x64',
        isPackaged: true,
        resourcesPath: 'C:\\Program Files\\Atelier\\resources',
        appRoot: 'C:\\src',
      }),
    ).toBe('C:\\Program Files\\Atelier\\resources\\bin\\latelier-agent-bridge.exe');
    expect(
      bundledBridgePath({ platform: 'win32', arch: 'x64', isPackaged: false, resourcesPath: 'C:\\r', appRoot: 'C:\\src' }),
    ).toBe('C:\\src\\build\\bridge\\win-x64\\latelier-agent-bridge.exe');
  });
});

describe('installedBridgeDir', () => {
  const base = { userData: '/tmp/ud', testInstance: false, env: {}, homedir: '/home/me' };

  it('is <userData>/bin for a test instance, on every platform', () => {
    expect(installedBridgeDir({ ...base, platform: 'darwin', testInstance: true })).toBe('/tmp/ud/bin');
    expect(installedBridgeDir({ ...base, platform: 'linux', testInstance: true })).toBe('/tmp/ud/bin');
    expect(installedBridgeDir({ ...base, platform: 'win32', testInstance: true, userData: 'C:\\ud' })).toBe('C:\\ud\\bin');
  });

  it("is ~/Library/Application Support/L'Atelier/bin on macOS", () => {
    expect(installedBridgeDir({ ...base, platform: 'darwin', homedir: '/Users/me' })).toBe(
      "/Users/me/Library/Application Support/L'Atelier/bin",
    );
  });

  it("is %LOCALAPPDATA%\\L'Atelier\\bin on Windows, falling back to AppData\\Local", () => {
    expect(
      installedBridgeDir({ ...base, platform: 'win32', homedir: 'C:\\Users\\me', env: { LOCALAPPDATA: 'D:\\Local' } }),
    ).toBe("D:\\Local\\L'Atelier\\bin");
    expect(installedBridgeDir({ ...base, platform: 'win32', homedir: 'C:\\Users\\me', env: {} })).toBe(
      "C:\\Users\\me\\AppData\\Local\\L'Atelier\\bin",
    );
    expect(installedBridgeDir({ ...base, platform: 'win32', homedir: 'C:\\Users\\me', env: { LOCALAPPDATA: '' } })).toBe(
      "C:\\Users\\me\\AppData\\Local\\L'Atelier\\bin",
    );
  });

  it("is ~/.local/share/L'Atelier/bin on Linux, or under an absolute XDG_DATA_HOME", () => {
    expect(installedBridgeDir({ ...base, platform: 'linux' })).toBe("/home/me/.local/share/L'Atelier/bin");
    expect(installedBridgeDir({ ...base, platform: 'linux', env: { XDG_DATA_HOME: '/data' } })).toBe(
      "/data/L'Atelier/bin",
    );
  });

  it('ignores an empty or relative XDG_DATA_HOME', () => {
    expect(installedBridgeDir({ ...base, platform: 'linux', env: { XDG_DATA_HOME: '' } })).toBe(
      "/home/me/.local/share/L'Atelier/bin",
    );
    expect(installedBridgeDir({ ...base, platform: 'linux', env: { XDG_DATA_HOME: 'relative/dir' } })).toBe(
      "/home/me/.local/share/L'Atelier/bin",
    );
  });
});

describe('installedBridgePath', () => {
  it('is the directory plus the platform file name', () => {
    const base = { userData: '/tmp/ud', testInstance: true, env: {}, homedir: '/h' };
    expect(installedBridgePath({ ...base, platform: 'linux' })).toBe('/tmp/ud/bin/latelier-agent-bridge');
    expect(installedBridgePath({ ...base, platform: 'win32', userData: 'C:\\ud' })).toBe(
      'C:\\ud\\bin\\latelier-agent-bridge.exe',
    );
  });
});
