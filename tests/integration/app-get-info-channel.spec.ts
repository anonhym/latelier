import { describe, it, expect, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';

vi.mock('electron', () => ({ dialog: {}, shell: {}, app: { getVersion: () => '9.8.7' } }));

const { createRouter } = await import('../../electron/ipc/router');
const { registerAppChannels } = await import('../../electron/ipc/handlers/app');
const { IPC_CHANNELS } = await import('../../shared/ipc');
import { invokeEvent, testSenderCheck } from '../helpers/ipcSender';
import { createPickedCredentialPaths } from '../../electron/security/credentialPaths';

type Handler = (evt: IpcMainInvokeEvent, payload: unknown) => unknown;
type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

function register() {
  const handlers = new Map<string, Handler>();
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const router = createRouter({ handle: (c: string, fn: Handler) => void handlers.set(c, fn) }, testSenderCheck, log);
  registerAppChannels(router, () => null, new Set(), createPickedCredentialPaths());
  return (payload: unknown) =>
    handlers.get(IPC_CHANNELS.appGetInfo)!(invokeEvent, payload) as Promise<
      Envelope<{ version: string; platform: string; arch: string }>
    >;
}

describe('app:getInfo', () => {
  it.each([[{}], [undefined], [null]])('answers with the version, platform and arch for %j', async (payload) => {
    const res = await register()(payload);
    expect(res).toEqual({ ok: true, data: { version: '9.8.7', platform: process.platform, arch: process.arch } });
  });

  it('refuses a payload with a value', async () => {
    const res = await register()('x');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('VALIDATION');
  });
});
