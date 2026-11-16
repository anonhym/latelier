import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { UpdateService, shouldCheckForUpdates, type UpdaterLike } from '../../electron/services/UpdateService';
import { ValidationError } from '../../electron/errors';
import type { Logger } from '../../electron/log';
import type { UpdateState } from '../../shared/types';
import { createQuitGate, type RunningWork } from '../../electron/quitGuard';

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

// A settable ISO clock: every `now()` reads the same instant until advanced.
function fakeClock(start = '2026-11-16T10:00:00.000Z') {
  let ms = Date.parse(start);
  return {
    now: () => new Date(ms).toISOString(),
    advance: (by: number) => {
      ms += by;
    },
  };
}

function fakeTimers() {
  const set = vi.fn((fn: () => void, ms: number) => ({ fn, ms }));
  const clear = vi.fn();
  return { set, clear, tick: () => set.mock.results[0].value.fn() };
}

const T0 = '2026-11-16T10:00:00.000Z';
const releaseUrl = (v: string) => `https://github.com/anonhym/latelier/releases/tag/v${v}`;
const readyState = (version: string, extra: object = {}): UpdateState => ({
  status: 'ready',
  version,
  highlights: [],
  changeCount: null,
  releaseUrl: releaseUrl(version),
  lastCheckedAt: T0,
  downloadedAt: T0,
  ...extra,
} as UpdateState);

const idle: RunningWork = { scripts: 0, shellCommands: 0, imports: 0, aggregations: 0, unsavedForms: 0, unsavedPipelines: 0 };

function setup(
  opts: {
    enabled?: boolean;
    check?: () => Promise<unknown>;
    running?: RunningWork;
    confirm?: (message: string) => Promise<boolean>;
    platform?: NodeJS.Platform;
  } = {},
) {
  const { updater, ee } = fakeUpdater(opts.check);
  const load = vi.fn(async () => updater);
  const log = fakeLog();
  const emitted: UpdateState[] = [];
  const confirm = vi.fn(opts.confirm ?? (async () => true));
  const gate = createQuitGate({ counts: () => opts.running ?? idle, confirm });
  const clock = fakeClock();
  const timers = fakeTimers();
  const svc = new UpdateService(load, log, (s) => emitted.push(s), opts.enabled ?? true, gate, {
    platform: opts.platform,
    now: clock.now,
    setInterval: timers.set,
    clearInterval: timers.clear,
  });
  return { svc, updater, ee, load, log, emitted, confirm, gate, clock, timers };
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
    // Pinned: the default is the host's platform, and CI runs on Linux.
    const { svc, load, log } = setup({ enabled: false, platform: 'darwin' });
    await svc.start();
    expect(load).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    expect(svc.getState()).toEqual({ status: 'off', reason: 'development' });
  });

  it('enables background download and install-on-quit, then checks once', async () => {
    const { svc, updater } = setup();
    await svc.start();
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('logs a rejected check at warn with the updater tag and restores idle', async () => {
    const { svc, log, emitted } = setup({ check: async () => { throw new Error('offline'); } });
    await expect(svc.start()).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith('updater', 'update check failed', { err: 'Error: offline' });
    expect(svc.getState()).toEqual({ status: 'idle' });
    expect(emitted).toEqual([{ status: 'checking', lastCheckedAt: null }, { status: 'idle' }]);
  });

  it('logs a failure to load the updater instead of throwing', async () => {
    const log = fakeLog();
    const gate = createQuitGate({ counts: () => idle, confirm: async () => true });
    const svc = new UpdateService(async () => { throw new Error('no module'); }, log, () => {}, true, gate);
    await expect(svc.start()).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith('updater', 'update check failed', { err: 'Error: no module' });
    expect(svc.getState()).toEqual({ status: 'idle' });
  });

  it('logs an updater error outside any check at warn without changing state', async () => {
    const { svc, ee, log, emitted } = setup();
    await svc.start();
    emitted.length = 0;
    ee.emit('error', new Error('bad feed'));
    expect(log.warn).toHaveBeenCalledWith('updater', 'updater error', { err: 'Error: bad feed' });
    expect(svc.getState()).toEqual({ status: 'up-to-date', lastCheckedAt: T0 });
    expect(emitted).toEqual([]);
  });
});

describe('UpdateService state and restart', () => {
  it('moves to ready with the version and emits it when a download finishes', async () => {
    const { svc, ee, emitted } = setup();
    await svc.start();
    emitted.length = 0;
    ee.emit('update-downloaded', { version: '1.2.3' });
    expect(svc.getState()).toEqual(readyState('1.2.3'));
    expect(emitted).toEqual([readyState('1.2.3')]);
  });

  it('restart installs silently and relaunches, exactly once, without asking when nothing runs', async () => {
    const running = { ...idle };
    const { svc, ee, updater, confirm, gate } = setup({ running });
    await svc.start();
    ee.emit('update-downloaded', { version: '1.2.3' });
    await expect(svc.restart()).resolves.toBe(true);
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
    expect(confirm).not.toHaveBeenCalled();
    // Nothing was asked, so nothing was approved: work started afterwards is still asked about.
    running.scripts = 1;
    expect(gate.check()).toBe('hold');
  });

  it('restart refuses with a ValidationError naming the state when nothing is ready', async () => {
    const { svc, updater, confirm } = setup({ running: { ...idle, scripts: 1 } });
    await svc.start();
    await expect(svc.restart()).rejects.toThrow(ValidationError);
    await expect(svc.restart()).rejects.toThrow(/state: up-to-date/);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });
});

// The installer starts inside `quitAndInstall`, before the app's quit event, so
// the running-work question has to be answered before it is called.
describe('UpdateService.restart over running work', () => {
  async function ready(opts: Parameters<typeof setup>[0]) {
    const s = setup(opts);
    await s.svc.start();
    s.ee.emit('update-downloaded', { version: '1.2.3' });
    s.emitted.length = 0;
    return s;
  }

  it('asks first, and Cancel installs nothing, keeps the update ready and offers Restart again', async () => {
    const { svc, updater, confirm, emitted } = await ready({
      running: { ...idle, shellCommands: 1 },
      confirm: async () => false,
    });
    await expect(svc.restart()).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith('This will stop 1 running shell command.');
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(svc.getState()).toEqual(readyState('1.2.3'));
    expect(emitted).toEqual([readyState('1.2.3')]);

    // Restart is usable again: a second click asks again.
    await svc.restart();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('Quit installs once, and the quit that follows is let through without a second dialog', async () => {
    const { svc, updater, confirm, gate, emitted } = await ready({
      running: { ...idle, scripts: 2 },
      confirm: async () => true,
    });
    await expect(svc.restart()).resolves.toBe(true);
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
    expect(emitted).toEqual([]);
    // What the window close and `before-quit` consult next.
    expect(gate.check()).toBe('allow');
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('an install that fails after Quit takes the approval back and offers Restart again', async () => {
    const running = { ...idle, scripts: 1 };
    const { svc, ee, updater, confirm, gate, emitted } = await ready({ running, confirm: async () => true });
    // electron-updater reports every failed install through its error event,
    // from inside quitAndInstall, and then does not quit.
    updater.quitAndInstall.mockImplementation(() => {
      ee.emit('error', new Error('No update filepath provided'));
    });

    await expect(svc.restart()).resolves.toBe(false);
    expect(gate.check()).toBe('hold');
    expect(svc.getState()).toEqual(readyState('1.2.3'));
    expect(emitted).toEqual([readyState('1.2.3')]);

    // The next attempt asks again rather than riding the old yes.
    await svc.restart();
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('an updater error with no restart under way leaves an earlier approval alone', async () => {
    const { ee, gate } = await ready({ running: { ...idle, scripts: 1 }, confirm: async () => true });
    await gate.ask();
    ee.emit('error', new Error('bad feed'));
    expect(gate.check()).toBe('allow');
  });

  it('a second restart while the question is open asks nothing more and installs nothing', async () => {
    let answer: (yes: boolean) => void = () => {};
    const { svc, updater, confirm } = await ready({
      running: { ...idle, imports: 1 },
      confirm: () => new Promise<boolean>((r) => { answer = r; }),
    });
    const first = svc.restart();
    await expect(svc.restart()).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    answer(true);
    await expect(first).resolves.toBe(true);
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });
});

describe('UpdateService off', () => {
  it.each([
    ['linux', 'linux'],
    ['darwin', 'development'],
    ['win32', 'development'],
  ] as const)('%s with updates disabled is off for reason %s', (platform, reason) => {
    const { svc } = setup({ enabled: false, platform });
    expect(svc.getState()).toEqual({ status: 'off', reason });
  });

  it('check answers the off state without loading the updater, and never throws', async () => {
    const { svc, load, emitted } = setup({ enabled: false, platform: 'linux' });
    await expect(svc.check({ manual: true })).resolves.toEqual({ status: 'off', reason: 'linux' });
    await expect(svc.check({ manual: false })).resolves.toEqual({ status: 'off', reason: 'linux' });
    expect(load).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it('startPeriodic starts no timer while off', () => {
    const { svc, timers } = setup({ enabled: false });
    svc.startPeriodic();
    expect(timers.set).not.toHaveBeenCalled();
  });
});

describe('UpdateService update events', () => {
  it('a check with no update announced settles to up-to-date and pushes checking, then up-to-date', async () => {
    const { svc, emitted } = setup();
    await expect(svc.check({ manual: false })).resolves.toEqual({ status: 'up-to-date', lastCheckedAt: T0 });
    expect(emitted).toEqual([{ status: 'checking', lastCheckedAt: null }, { status: 'up-to-date', lastCheckedAt: T0 }]);
  });

  it('stamps downloadedAt from the clock when the download finishes, apart from the check time', async () => {
    const { svc, ee, clock } = setup();
    await svc.start();
    clock.advance(90_000);
    ee.emit('update-downloaded', { version: '2.0.0' });
    expect(svc.getState()).toMatchObject({
      status: 'ready',
      lastCheckedAt: T0,
      downloadedAt: '2026-11-16T10:01:30.000Z',
    });
  });

  it('a repeated update-downloaded keeps the first downloadedAt', async () => {
    const { svc, ee, clock } = setup();
    await svc.start();
    ee.emit('update-downloaded', { version: '2.0.0' });
    clock.advance(60_000);
    ee.emit('update-downloaded', { version: '2.0.0' });
    expect(svc.getState()).toMatchObject({ downloadedAt: T0 });
  });

  it('update-not-available settles a running check to up-to-date before the promise returns', async () => {
    let finish: () => void = () => {};
    const { svc, ee, emitted, clock, updater } = setup({ check: () => new Promise<void>((r) => { finish = r; }) });
    const pending = svc.check({ manual: true });
    // Listeners are attached once the updater has loaded and the check is under way.
    await vi.waitFor(() => expect(updater.checkForUpdates).toHaveBeenCalled());
    clock.advance(5000);
    ee.emit('update-not-available', { version: '1.0.0' });
    expect(svc.getState()).toEqual({ status: 'up-to-date', lastCheckedAt: '2026-11-16T10:00:05.000Z' });
    expect(emitted).toEqual([
      { status: 'checking', lastCheckedAt: null },
      { status: 'up-to-date', lastCheckedAt: '2026-11-16T10:00:05.000Z' },
    ]);
    finish();
    await pending;
    // The settle did not stamp a second time.
    expect(emitted).toHaveLength(2);
  });

  it('update-not-available outside a check changes nothing', async () => {
    const { svc, ee, emitted, clock } = setup();
    await svc.start();
    emitted.length = 0;
    clock.advance(5000);
    ee.emit('update-not-available', { version: '1.0.0' });
    expect(svc.getState()).toEqual({ status: 'up-to-date', lastCheckedAt: T0 });
    expect(emitted).toEqual([]);
  });

  it('checking-for-update also moves idle and failed to checking', async () => {
    const { svc, ee } = setup({ check: async () => { throw new Error('offline'); } });
    await svc.check({ manual: false });
    expect(svc.getState()).toEqual({ status: 'idle' });
    ee.emit('checking-for-update');
    expect(svc.getState().status).toBe('checking');

    const second = setup({ check: async () => { throw new Error('offline'); } });
    await second.svc.check({ manual: true });
    expect(second.svc.getState().status).toBe('failed');
    second.ee.emit('checking-for-update');
    expect(second.svc.getState()).toEqual({ status: 'checking', lastCheckedAt: null });
  });

  it('an update-downloaded that arrives before any check settled stamps the time itself', async () => {
    const { svc, ee } = setup({ check: () => new Promise(() => {}) });
    void svc.check({ manual: false });
    await vi.waitFor(() => expect(svc.getState().status).toBe('checking'));
    await Promise.resolve();
    ee.emit('update-downloaded', { version: '2.0.0' });
    expect(svc.getState()).toEqual(readyState('2.0.0'));
  });

  it('checking-for-update from outside a check moves up-to-date to checking, and is ignored once checking', async () => {
    const { svc, ee, emitted } = setup();
    await svc.start();
    emitted.length = 0;
    ee.emit('checking-for-update');
    expect(svc.getState()).toEqual({ status: 'checking', lastCheckedAt: T0 });
    ee.emit('checking-for-update');
    expect(emitted).toEqual([{ status: 'checking', lastCheckedAt: T0 }]);
  });

  it('update-available moves to downloading at 0 percent with the version', async () => {
    const { svc, ee, emitted } = setup({ check: () => new Promise(() => {}) });
    void svc.start();
    await Promise.resolve();
    await Promise.resolve();
    ee.emit('update-available', { version: '2.0.0' });
    expect(svc.getState()).toEqual({ status: 'downloading', version: '2.0.0', percent: 0, lastCheckedAt: T0 });
    expect(emitted.at(-1)).toEqual({ status: 'downloading', version: '2.0.0', percent: 0, lastCheckedAt: T0 });
  });

  it('a check that finds an update leaves it downloading when checkForUpdates resolves', async () => {
    const holder: { ee?: EventEmitter } = {};
    const { svc, ee } = setup({
      check: async () => {
        holder.ee?.emit('update-available', { version: '2.0.0' });
      },
    });
    holder.ee = ee;
    await expect(svc.check({ manual: true })).resolves.toEqual({
      status: 'downloading',
      version: '2.0.0',
      percent: 0,
      lastCheckedAt: T0,
    });
  });

  it('update-downloaded carries highlights, change count, release url and the check time', async () => {
    const { svc, ee } = setup();
    await svc.start();
    ee.emit('update-downloaded', {
      version: '2.0.0',
      releaseNotes: '<ul><li><strong>Faster, tabs.</strong> a</li><li>plain</li></ul>',
    });
    expect(svc.getState()).toEqual({
      status: 'ready',
      version: '2.0.0',
      highlights: ['Faster, tabs.'],
      changeCount: 2,
      releaseUrl: releaseUrl('2.0.0'),
      lastCheckedAt: T0,
      downloadedAt: T0,
    });
  });

  it('an update-downloaded for a different version after ready is ignored', async () => {
    const { svc, ee, emitted } = setup();
    await svc.start();
    ee.emit('update-downloaded', { version: '2.0.0' });
    emitted.length = 0;
    ee.emit('update-downloaded', { version: '3.0.0' });
    expect(svc.getState()).toEqual(readyState('2.0.0'));
    expect(emitted).toEqual([]);
  });
});

describe('UpdateService ready is sticky', () => {
  async function ready() {
    const s = setup();
    await s.svc.start();
    s.ee.emit('update-downloaded', { version: '2.0.0' });
    s.emitted.length = 0;
    return s;
  }

  it.each([
    ['update-available', { version: '9.9.9' }],
    ['update-not-available', { version: '1.0.0' }],
    ['checking-for-update', undefined],
    ['download-progress', { percent: 50 }],
    ['error', new Error('boom')],
  ] as const)('%s leaves ready alone and pushes nothing', async (event, payload) => {
    const { svc, ee, emitted } = await ready();
    ee.emit(event, payload);
    expect(svc.getState()).toEqual(readyState('2.0.0'));
    expect(emitted).toEqual([]);
  });

  it.each([true, false])('check({ manual: %s }) returns ready without touching the updater', async (manual) => {
    const { svc, updater, emitted } = await ready();
    updater.checkForUpdates.mockClear();
    await expect(svc.check({ manual })).resolves.toEqual(readyState('2.0.0'));
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });
});

describe('UpdateService.check', () => {
  it('is re-entrant: a second check while one runs returns the current state and calls the updater once', async () => {
    let finish: () => void = () => {};
    const { svc, updater } = setup({ check: () => new Promise<void>((r) => { finish = r; }) });
    const first = svc.check({ manual: true });
    await expect(svc.check({ manual: true })).resolves.toEqual({ status: 'checking', lastCheckedAt: null });
    await expect(svc.check({ manual: false })).resolves.toEqual({ status: 'checking', lastCheckedAt: null });
    finish();
    await first;
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('does not check again while downloading', async () => {
    const holder: { ee?: EventEmitter } = {};
    const { svc, ee, updater } = setup({
      check: async () => { holder.ee?.emit('update-available', { version: '2.0.0' }); },
    });
    holder.ee = ee;
    await svc.check({ manual: false });
    await expect(svc.check({ manual: true })).resolves.toMatchObject({ status: 'downloading', version: '2.0.0' });
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('a later check re-checks from up-to-date and carries the last time while checking', async () => {
    const { svc, updater, clock, emitted } = setup();
    await svc.check({ manual: false });
    clock.advance(60_000);
    emitted.length = 0;
    await svc.check({ manual: true });
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(emitted).toEqual([
      { status: 'checking', lastCheckedAt: T0 },
      { status: 'up-to-date', lastCheckedAt: '2026-11-16T10:01:00.000Z' },
    ]);
  });

  it('attaches the updater once across checks', async () => {
    const { svc, load } = setup();
    await svc.check({ manual: false });
    await svc.check({ manual: false });
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('UpdateService check failures', () => {
  it('a manual rejected check ends in failed with the message and the previous time', async () => {
    let fail = false;
    const { svc, log } = setup({ check: async () => { if (fail) throw new Error('offline'); } });
    await svc.check({ manual: false });
    fail = true;
    await expect(svc.check({ manual: true })).resolves.toEqual({
      status: 'failed',
      message: 'offline',
      lastCheckedAt: T0,
    });
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('a manual failure with a non-Error rejection uses its string form', async () => {
    const { svc } = setup({ check: async () => { throw 'plain'; } });
    await expect(svc.check({ manual: true })).resolves.toEqual({ status: 'failed', message: 'plain', lastCheckedAt: null });
  });

  it('a periodic tick that fails restores the prior state instead of showing failed', async () => {
    const { svc, timers } = setup({ check: async () => { throw new Error('offline'); } });
    svc.startPeriodic();
    timers.tick();
    await vi.waitFor(() => expect(svc.getState().status).not.toBe('checking'));
    expect(svc.getState()).toEqual({ status: 'idle' });
  });

  it('a launch check that fails restores idle instead of showing failed', async () => {
    const { svc } = setup({ check: async () => { throw new Error('offline'); } });
    await svc.start();
    expect(svc.getState()).toEqual({ status: 'idle' });
  });

  it('a background failure restores up-to-date and logs one warn line', async () => {
    let fail = false;
    const { svc, log, emitted } = setup({ check: async () => { if (fail) throw new Error('offline'); } });
    await svc.check({ manual: false });
    fail = true;
    emitted.length = 0;
    await expect(svc.check({ manual: false })).resolves.toEqual({ status: 'up-to-date', lastCheckedAt: T0 });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(emitted).toEqual([{ status: 'checking', lastCheckedAt: T0 }, { status: 'up-to-date', lastCheckedAt: T0 }]);
  });

  it('an error event during a manual check fails it once, even when the promise rejects too', async () => {
    const holder: { ee?: EventEmitter } = {};
    const { svc, ee, log, emitted } = setup({
      check: async () => {
        const err = new Error('bad feed');
        holder.ee?.emit('error', err);
        throw err;
      },
    });
    holder.ee = ee;
    await expect(svc.check({ manual: true })).resolves.toEqual({ status: 'failed', message: 'bad feed', lastCheckedAt: null });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith('updater', 'updater error', { err: 'Error: bad feed' });
    expect(emitted).toEqual([{ status: 'checking', lastCheckedAt: null }, { status: 'failed', message: 'bad feed', lastCheckedAt: null }]);
  });

  it('an error event during a check that then resolves still fails the manual check', async () => {
    const holder: { ee?: EventEmitter } = {};
    const { svc, ee } = setup({ check: async () => { holder.ee?.emit('error', new Error('bad feed')); } });
    holder.ee = ee;
    await expect(svc.check({ manual: true })).resolves.toMatchObject({ status: 'failed', message: 'bad feed' });
  });

  it('an error event during a background check restores the prior state', async () => {
    const holder: { ee?: EventEmitter } = {};
    const { svc, ee, log } = setup({ check: async () => { holder.ee?.emit('error', new Error('bad feed')); } });
    holder.ee = ee;
    await expect(svc.check({ manual: false })).resolves.toEqual({ status: 'idle' });
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('the next check of either kind clears failed', async () => {
    let fail = true;
    const { svc } = setup({ check: async () => { if (fail) throw new Error('offline'); } });
    await svc.check({ manual: true });
    expect(svc.getState().status).toBe('failed');
    fail = false;
    await expect(svc.check({ manual: false })).resolves.toEqual({ status: 'up-to-date', lastCheckedAt: T0 });
  });

  it('a background failure after a failed manual check puts failed back', async () => {
    const { svc } = setup({ check: async () => { throw new Error('offline'); } });
    await svc.check({ manual: true });
    await expect(svc.check({ manual: false })).resolves.toEqual({ status: 'failed', message: 'offline', lastCheckedAt: null });
  });

  it('a download that errors goes back to the state before the check', async () => {
    const holder: { ee?: EventEmitter } = {};
    const { svc, ee, emitted } = setup({
      check: async () => { holder.ee?.emit('update-available', { version: '2.0.0' }); },
    });
    holder.ee = ee;
    await svc.check({ manual: true });
    emitted.length = 0;
    ee.emit('error', new Error('connection reset'));
    expect(svc.getState()).toEqual({ status: 'idle' });
    expect(emitted).toEqual([{ status: 'idle' }]);
  });
});

describe('UpdateService download progress', () => {
  async function downloading() {
    const holder: { ee?: EventEmitter } = {};
    const s = setup({ check: async () => { holder.ee?.emit('update-available', { version: '2.0.0' }); } });
    holder.ee = s.ee;
    await s.svc.check({ manual: false });
    s.emitted.length = 0;
    return s;
  }

  it('pushes at most once per 500 ms and only when the whole percent changes', async () => {
    const { svc, ee, clock, emitted } = await downloading();
    // Same whole percent: nothing, however much time has passed.
    clock.advance(1000);
    ee.emit('download-progress', { percent: 0.4 });
    expect(emitted).toEqual([]);
    // New percent, enough time: pushed, floored.
    ee.emit('download-progress', { percent: 12.9 });
    expect(emitted).toHaveLength(1);
    expect(svc.getState()).toMatchObject({ status: 'downloading', percent: 12 });
    // New percent but only 499 ms later: held back.
    clock.advance(499);
    ee.emit('download-progress', { percent: 20 });
    expect(emitted).toHaveLength(1);
    // Exactly 500 ms after the last push: allowed.
    clock.advance(1);
    ee.emit('download-progress', { percent: 20 });
    expect(emitted).toHaveLength(2);
    expect(svc.getState()).toMatchObject({ percent: 20 });
    // Same percent again after a long wait: still nothing.
    clock.advance(5000);
    ee.emit('download-progress', { percent: 20.7 });
    expect(emitted).toHaveLength(2);
  });

  it('the first push after update-available also waits out the 500 ms', async () => {
    const { ee, emitted } = await downloading();
    ee.emit('download-progress', { percent: 5 });
    expect(emitted).toEqual([]);
  });

  it('progress outside the downloading state is ignored', async () => {
    const { svc, ee, emitted } = setup();
    await svc.start();
    emitted.length = 0;
    ee.emit('download-progress', { percent: 50 });
    expect(emitted).toEqual([]);
    expect(svc.getState().status).toBe('up-to-date');
  });
});

describe('UpdateService periodic re-check', () => {
  it('startPeriodic schedules every 4 hours by default and a tick checks in the background', async () => {
    const { svc, timers, updater } = setup();
    svc.startPeriodic();
    expect(timers.set).toHaveBeenCalledTimes(1);
    expect(timers.set.mock.calls[0][1]).toBe(4 * 60 * 60 * 1000);
    timers.tick();
    await vi.waitFor(() => expect(svc.getState().status).toBe('up-to-date'));
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('honours an explicit interval and starts only one timer', () => {
    const { svc, timers } = setup();
    svc.startPeriodic(1234);
    svc.startPeriodic(1234);
    expect(timers.set).toHaveBeenCalledTimes(1);
    expect(timers.set.mock.calls[0][1]).toBe(1234);
  });

  it('a tick while ready does nothing', async () => {
    const { svc, ee, timers, updater } = setup();
    await svc.start();
    ee.emit('update-downloaded', { version: '2.0.0' });
    updater.checkForUpdates.mockClear();
    svc.startPeriodic();
    timers.tick();
    await Promise.resolve();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(svc.getState().status).toBe('ready');
  });

  it('stop clears the timer, once, and allows a fresh start', () => {
    const { svc, timers } = setup();
    svc.stop();
    expect(timers.clear).not.toHaveBeenCalled();
    svc.startPeriodic();
    const handle = timers.set.mock.results[0].value;
    svc.stop();
    svc.stop();
    expect(timers.clear).toHaveBeenCalledTimes(1);
    expect(timers.clear).toHaveBeenCalledWith(handle);
    svc.startPeriodic();
    expect(timers.set).toHaveBeenCalledTimes(2);
  });
});

describe('UpdateService default clock and timers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stamps lastCheckedAt from the real clock when none is injected', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-02T03:04:05.000Z'));
    const { updater } = fakeUpdater();
    const gate = createQuitGate({ counts: () => idle, confirm: async () => true });
    const svc = new UpdateService(async () => updater, fakeLog(), () => {}, true, gate);
    await expect(svc.check({ manual: false })).resolves.toEqual({
      status: 'up-to-date',
      lastCheckedAt: '2030-01-02T03:04:05.000Z',
    });
  });

  it('uses real timers when none are injected, and stop cancels them', async () => {
    vi.useFakeTimers();
    const { updater } = fakeUpdater();
    const gate = createQuitGate({ counts: () => idle, confirm: async () => true });
    const svc = new UpdateService(async () => updater, fakeLog(), () => {}, true, gate);
    svc.startPeriodic(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    svc.stop();
    await svc.check({ manual: false });
    updater.checkForUpdates.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });
});
