import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IPC_CHANNELS } from '@shared/ipc';
import { createRouter } from '../../electron/ipc/router';
import { registerQueryChannels } from '../../electron/ipc/handlers/query';
import { registerScriptChannels } from '../../electron/ipc/handlers/script';
import { createIpcShim } from '../helpers/ipcShim';
import { expectSchemaReject } from '../helpers/ipcAssert';
import { testSenderCheck } from '../helpers/ipcSender';

/**
 * `query:cancel` and `script:cancel` through the real router and zod validator
 * with a stub service: the handler is one `svc.cancel(token)` and an `undefined`
 * answer, so what can break is the schema and that call. A real service cannot
 * show either, since cancelling an unknown token is a silent no-op there.
 */
describe.each([
  {
    channel: IPC_CHANNELS.queryCancel,
    register: (router: ReturnType<typeof createRouter>, cancel: (token: string) => void) =>
      registerQueryChannels(router, { cancel } as never, async () => null),
  },
  {
    channel: IPC_CHANNELS.scriptCancel,
    register: (router: ReturnType<typeof createRouter>, cancel: (token: string) => void) =>
      registerScriptChannels(router, { cancel } as never),
  },
])('$channel via router', ({ channel, register }) => {
  let shim: ReturnType<typeof createIpcShim>;
  let cancel: ReturnType<typeof vi.fn<(token: string) => void>>;

  beforeEach(() => {
    shim = createIpcShim();
    cancel = vi.fn<(token: string) => void>();
    register(createRouter(shim.ipcMain, testSenderCheck), cancel);
  });

  it('hands the token to the service once and answers ok with no data', async () => {
    const env = await shim.invoke(channel, { token: 'abc' });
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.data).toBeUndefined();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith('abc');
  });

  it.each([
    ['an empty token', { token: '' }],
    ['a missing token', {}],
    ['a non-string token', { token: 7 }],
  ])('rejects %s at the schema without cancelling anything', async (_what, payload) => {
    expectSchemaReject(await shim.invoke(channel, payload), 'token');
    expect(cancel).not.toHaveBeenCalled();
  });

  it('rejects no payload at all with VALIDATION without cancelling anything', async () => {
    const env = await shim.invoke(channel);
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error.code).toBe('VALIDATION');
    expect(cancel).not.toHaveBeenCalled();
  });
});
