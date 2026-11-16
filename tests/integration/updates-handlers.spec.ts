import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { createRouter } from '../../electron/ipc/router';
import { registerUpdatesChannels } from '../../electron/ipc/handlers/updates';
import { UpdateService, type UpdaterLike } from '../../electron/services/UpdateService';
import { IPC_CHANNELS, type Envelope } from '../../shared/ipc';
import { createQuitGate } from '../../electron/quitGuard';
import { invokeEvent, testSenderCheck } from '../helpers/ipcSender';

type Handler = (evt: IpcMainInvokeEvent, payload: unknown) => unknown;

function createShim() {
  const handlers = new Map<string, Handler>();
  return {
    ipcMain: { handle: (c: string, fn: Handler) => void handlers.set(c, fn) } as const,
    async invoke<T>(channel: string, payload: unknown): Promise<Envelope<T>> {
      const h = handlers.get(channel);
      if (!h) throw new Error(`no handler for ${channel}`);
      return (await h(invokeEvent, payload)) as Envelope<T>;
    },
  };
}

const NOW = '2026-11-16T10:00:00.000Z';

describe('updates:* handlers', () => {
  let shim: ReturnType<typeof createShim>;
  let quitAndInstall: ReturnType<typeof vi.fn>;
  let fire: (version: string) => void;
  let svc: UpdateService;
  let quitAnswer: boolean;
  let shellCommands: number;
  let failInstall: (err: Error) => void;
  let gate: ReturnType<typeof createQuitGate>;
  let checkForUpdates: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    shim = createShim();
    quitAndInstall = vi.fn();
    let downloaded: ((i: { version: string }) => void) | undefined;
    let errored: ((err: Error) => void) | undefined;
    checkForUpdates = vi.fn(async () => undefined);
    const updater = {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      on: (event: string, l: never) => {
        if (event === 'update-downloaded') downloaded = l;
        if (event === 'error') errored = l;
      },
      checkForUpdates,
      quitAndInstall,
    } as unknown as UpdaterLike;
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    quitAnswer = true;
    shellCommands = 0;
    gate = createQuitGate({
      counts: () => ({ scripts: 0, shellCommands, imports: 0, aggregations: 0, unsavedForms: 0, unsavedPipelines: 0 }),
      confirm: async () => quitAnswer,
    });
    svc = new UpdateService(async () => updater, log, () => {}, true, gate, { now: () => NOW });
    await svc.start();
    fire = (version) => downloaded?.({ version });
    failInstall = (err) => errored?.(err);
    registerUpdatesChannels(createRouter(shim.ipcMain, testSenderCheck), svc);
  });

  it('getState returns the service state in an ok envelope', async () => {
    expect(await shim.invoke(IPC_CHANNELS.updatesGetState, undefined)).toEqual({
      ok: true,
      data: { status: 'up-to-date', lastCheckedAt: NOW },
    });
    fire('2.0.0');
    expect(await shim.invoke(IPC_CHANNELS.updatesGetState, {})).toEqual({
      ok: true,
      data: {
        status: 'ready',
        version: '2.0.0',
        highlights: [],
        changeCount: null,
        releaseUrl: 'https://github.com/anonhym/latelier/releases/tag/v2.0.0',
        lastCheckedAt: NOW,
        downloadedAt: NOW,
      },
    });
  });

  it('restart installs and answers ok when an update is ready', async () => {
    fire('2.0.0');
    expect(await shim.invoke(IPC_CHANNELS.updatesRestart, {})).toEqual({
      ok: true,
      data: { restarting: true },
    });
    expect(quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('restart answers restarting: false and installs nothing when the quit question is cancelled', async () => {
    fire('2.0.0');
    shellCommands = 1;
    quitAnswer = false;
    expect(await shim.invoke(IPC_CHANNELS.updatesRestart, {})).toEqual({
      ok: true,
      data: { restarting: false },
    });
    expect(quitAndInstall).not.toHaveBeenCalled();
  });

  it('restart answers restarting: false and asks again next time when the install fails after Quit', async () => {
    fire('2.0.0');
    shellCommands = 1;
    // electron-updater reports a failed install through `error`, from inside
    // quitAndInstall, and then does not quit.
    quitAndInstall.mockImplementation(() => failInstall(new Error('No update filepath provided')));
    expect(await shim.invoke(IPC_CHANNELS.updatesRestart, {})).toEqual({
      ok: true,
      data: { restarting: false },
    });
    expect(quitAndInstall).toHaveBeenCalledTimes(1);
    expect(gate.check()).toBe('hold');
  });

  it('restart answers a VALIDATION error envelope when nothing is ready', async () => {
    const env = await shim.invoke(IPC_CHANNELS.updatesRestart, {});
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error.code).toBe('VALIDATION');
    expect(quitAndInstall).not.toHaveBeenCalled();
  });

  it('a payload with unexpected fields is a VALIDATION error, never a throw', async () => {
    fire('2.0.0');
    const env = await shim.invoke(IPC_CHANNELS.updatesRestart, { force: true });
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error.code).toBe('VALIDATION');
    expect(quitAndInstall).not.toHaveBeenCalled();
  });

  describe('updates:check', () => {
    it('answers ok with the settled state and runs one manual check', async () => {
      checkForUpdates.mockClear();
      expect(await shim.invoke(IPC_CHANNELS.updatesCheck, undefined)).toEqual({
        ok: true,
        data: { status: 'up-to-date', lastCheckedAt: NOW },
      });
      expect(checkForUpdates).toHaveBeenCalledTimes(1);
    });

    it('answers a failed state in an ok envelope when the manual check fails', async () => {
      checkForUpdates.mockRejectedValueOnce(new Error('offline'));
      expect(await shim.invoke(IPC_CHANNELS.updatesCheck, {})).toEqual({
        ok: true,
        data: { status: 'failed', message: 'offline', lastCheckedAt: NOW },
      });
    });

    it('answers ok with the unchanged ready state and checks nothing while ready', async () => {
      fire('2.0.0');
      checkForUpdates.mockClear();
      const env = await shim.invoke<{ status: string }>(IPC_CHANNELS.updatesCheck, {});
      expect(env).toMatchObject({ ok: true, data: { status: 'ready' } });
      expect(checkForUpdates).not.toHaveBeenCalled();
    });

    it('answers ok with the off state when updates are off, without loading the updater', async () => {
      const offShim = createShim();
      const load = vi.fn();
      const offSvc = new UpdateService(
        load,
        { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        () => {},
        false,
        gate,
        { platform: 'linux' },
      );
      registerUpdatesChannels(createRouter(offShim.ipcMain, testSenderCheck), offSvc);
      expect(await offShim.invoke(IPC_CHANNELS.updatesCheck, {})).toEqual({
        ok: true,
        data: { status: 'off', reason: 'linux' },
      });
      expect(load).not.toHaveBeenCalled();
    });

    it('a payload with unexpected fields is a VALIDATION error and checks nothing', async () => {
      checkForUpdates.mockClear();
      const env = await shim.invoke(IPC_CHANNELS.updatesCheck, { force: true });
      expect(env.ok).toBe(false);
      if (!env.ok) expect(env.error.code).toBe('VALIDATION');
      expect(checkForUpdates).not.toHaveBeenCalled();
    });
  });
});
