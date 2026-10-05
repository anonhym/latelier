import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { UpdateService, shouldCheckForUpdates, type UpdaterLike } from '../../electron/services/UpdateService';
import { ValidationError } from '../../electron/errors';
import type { Logger } from '../../electron/log';
import type { UpdateState } from '../../shared/types';

function fakeUpdater(check: () => Promise<unknown> = async () => undefined) {
  const ee = new EventEmitter();
  const updater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    on: vi.fn((event: string, listener: (arg: unknown) => void) => ee.on(event, listener)),
    checkForUpdates: vi.fn(check),
    quitAndInstall: vi.fn(),
  };
  return { updater: updater as unknown as UpdaterLike & typeof updater, ee };
}

function fakeLog() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger;
}

function setup(opts: { enabled?: boolean; check?: () => Promise<unknown> } = {}) {
  const { updater, ee } = fakeUpdater(opts.check);
  const load = vi.fn(async () => updater);
  const log = fakeLog();
  const emitted: UpdateState[] = [];
  const svc = new UpdateService(load, log, (s) => emitted.push(s), opts.enabled ?? true);
  return { svc, updater, ee, load, log, emitted };
}

describe('shouldCheckForUpdates', () => {
  it.each([
    ['darwin', true, undefined, true],
    ['win32', true, undefined, true],
    ['linux', true, undefined, false],
    ['darwin', false, undefined, false],
    ['win32', false, undefined, false],
    ['darwin', true, '/tmp/throwaway', false],
    ['win32', true, '/tmp/throwaway', false],
    ['linux', false, '/tmp/throwaway', false],
  ] as const)('%s packaged=%s override=%s -> %s', (platform, isPackaged, userDataOverride, expected) => {
    expect(shouldCheckForUpdates({ isPackaged, userDataOverride, platform })).toBe(expected);
  });

  it('treats an empty override as unset', () => {
    expect(shouldCheckForUpdates({ isPackaged: true, userDataOverride: '', platform: 'darwin' })).toBe(true);
  });
});

describe('UpdateService.start', () => {
  it('does nothing when disabled: the updater is never even loaded', async () => {
    const { svc, load, log } = setup({ enabled: false });
    await svc.start();
    expect(load).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    expect(svc.getState()).toEqual({ status: 'idle' });
  });

  it('enables background download and install-on-quit, then checks once', async () => {
    const { svc, updater } = setup();
    await svc.start();
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('logs a rejected check at warn with the updater tag and keeps state idle', async () => {
    const { svc, log } = setup({ check: async () => { throw new Error('offline'); } });
    await expect(svc.start()).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith('updater', 'update check failed', { err: 'Error: offline' });
    expect(svc.getState()).toEqual({ status: 'idle' });
  });

  it('logs a failure to load the updater instead of throwing', async () => {
    const log = fakeLog();
    const svc = new UpdateService(async () => { throw new Error('no module'); }, log, () => {}, true);
    await expect(svc.start()).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith('updater', 'update check failed', { err: 'Error: no module' });
  });

  it('logs the updater error event at warn without changing state', async () => {
    const { svc, ee, log, emitted } = setup();
    await svc.start();
    ee.emit('error', new Error('bad feed'));
    expect(log.warn).toHaveBeenCalledWith('updater', 'updater error', { err: 'Error: bad feed' });
    expect(svc.getState()).toEqual({ status: 'idle' });
    expect(emitted).toEqual([]);
  });
});

describe('UpdateService state and restart', () => {
  it('moves to ready with the version and emits it when a download finishes', async () => {
    const { svc, ee, emitted } = setup();
    await svc.start();
    ee.emit('update-downloaded', { version: '1.2.3' });
    expect(svc.getState()).toEqual({ status: 'ready', version: '1.2.3' });
    expect(emitted).toEqual([{ status: 'ready', version: '1.2.3' }]);
  });

  it('restart installs silently and relaunches, exactly once, when ready', async () => {
    const { svc, ee, updater } = setup();
    await svc.start();
    ee.emit('update-downloaded', { version: '1.2.3' });
    svc.restart();
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('restart refuses with a ValidationError naming the state when nothing is ready', async () => {
    const { svc, updater } = setup();
    await svc.start();
    expect(() => svc.restart()).toThrow(ValidationError);
    expect(() => svc.restart()).toThrow(/state: idle/);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });
});
