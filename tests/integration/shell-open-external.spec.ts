import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';

const openExternalSpy = vi.fn(async (url: string) => {
  void url;
  return undefined;
});

vi.mock('electron', () => ({
  shell: { openExternal: (url: string) => openExternalSpy(url) },
}));

// Imports must come after the mock so the handler binds to the stub.
const { createRouter } = await import('../../electron/ipc/router');
const { registerShellChannels } = await import('../../electron/ipc/handlers/shell');
const { IPC_CHANNELS } = await import('../../shared/ipc');
import { invokeEvent, testSenderCheck } from '../helpers/ipcSender';

type Handler = (evt: IpcMainInvokeEvent, payload: unknown) => unknown;

// The router never reads the event (`_evt` in router.ts), so the shim stands
// one in rather than constructing a real Electron event.

function createShim() {
  const handlers = new Map<string, Handler>();
  return {
    ipcMain: {
      handle(channel: string, fn: Handler) {
        handlers.set(channel, fn);
      },
    } as const,
    async invoke<T>(channel: string, payload: unknown) {
      const h = handlers.get(channel);
      if (!h) throw new Error(`no handler for ${channel}`);
      return (await h(invokeEvent, payload)) as { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
    },
  };
}

describe('shell:openExternal', () => {
  let shim: ReturnType<typeof createShim>;

  beforeEach(() => {
    openExternalSpy.mockClear();
    shim = createShim();
    const router = createRouter(shim.ipcMain, testSenderCheck);
    registerShellChannels(router);
  });

  it('opens a MongoDB docs URL via electron.shell.openExternal', async () => {
    const url = 'https://www.mongodb.com/docs/manual/reference/operator/aggregation/match/';
    const env = await shim.invoke<{ opened: true }>(IPC_CHANNELS.shellOpenExternal, { url });
    expect(env).toEqual({ ok: true, data: { opened: true } });
    expect(openExternalSpy).toHaveBeenCalledWith(url);
  });

  it('rejects URLs outside the MongoDB docs prefix', async () => {
    const env = await shim.invoke<unknown>(IPC_CHANNELS.shellOpenExternal, {
      url: 'https://evil.example.com/phishing',
    });
    expect(env.ok).toBe(false);
    if (!env.ok) {
      expect(env.error.code).toBe('VALIDATION');
    }
    expect(openExternalSpy).not.toHaveBeenCalled();
  });

  it('rejects plain http docs URLs', async () => {
    const env = await shim.invoke<unknown>(IPC_CHANNELS.shellOpenExternal, {
      url: 'http://www.mongodb.com/docs/manual/',
    });
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error.code).toBe('VALIDATION');
    expect(openExternalSpy).not.toHaveBeenCalled();
  });

  it('rejects non-string payloads via zod', async () => {
    const env = await shim.invoke<unknown>(IPC_CHANNELS.shellOpenExternal, { url: 123 });
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error.code).toBe('VALIDATION');
    expect(openExternalSpy).not.toHaveBeenCalled();
  });
});
