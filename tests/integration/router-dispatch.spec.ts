import { describe, it, expect, beforeEach } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { createRouter } from '../../electron/ipc/router';
import { zodValidator } from '../../electron/ipc/validators';
import { ValidationError, NotFoundError } from '../../electron/errors';
import type { Envelope } from '@shared/ipc';
import { invokeEvent, testSenderCheck } from '../helpers/ipcSender';

/**
 * Minimal ipcMain shim mirroring Electron's handle() contract.
 */
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
    async invoke<T>(channel: string, payload: unknown): Promise<Envelope<T>> {
      const h = handlers.get(channel);
      if (!h) throw new Error(`no handler for ${channel}`);
      return (await h(invokeEvent, payload)) as Envelope<T>;
    },
  };
}

describe('router', () => {
  let shim: ReturnType<typeof createShim>;

  beforeEach(() => {
    shim = createShim();
  });

  it('dispatches a successful call', async () => {
    const router = createRouter(shim.ipcMain, testSenderCheck);
    router.register(
      'test:echo',
      zodValidator(z.object({ x: z.number() })),
      (input) => ({ doubled: input.x * 2 }),
    );
    const env = await shim.invoke<{ doubled: number }>('test:echo', { x: 21 });
    expect(env).toEqual({ ok: true, data: { doubled: 42 } });
  });

  it('validation failure returns VALIDATION envelope', async () => {
    const router = createRouter(shim.ipcMain, testSenderCheck);
    router.register(
      'test:v',
      zodValidator(z.object({ x: z.number() })),
      () => ({ ok: true }),
    );
    const env = await shim.invoke<unknown>('test:v', { x: 'nope' });
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error.code).toBe('VALIDATION');
  });

  it('maps AppError subclasses to the right codes', async () => {
    const router = createRouter(shim.ipcMain, testSenderCheck);
    router.register(
      'test:nf',
      zodValidator(z.object({}).passthrough()),
      () => { throw new NotFoundError('gone'); },
    );
    router.register(
      'test:val',
      zodValidator(z.object({}).passthrough()),
      () => { throw new ValidationError('bad', { field: 'X' }); },
    );

    const nf = await shim.invoke<unknown>('test:nf', {});
    expect(nf.ok).toBe(false);
    if (!nf.ok) expect(nf.error.code).toBe('NOT_FOUND');

    const val = await shim.invoke<unknown>('test:val', {});
    expect(val.ok).toBe(false);
    if (!val.ok) expect(val.error.details).toEqual({ field: 'X' });
  });

  it('unknown throws collapse to INTERNAL without leaking stack', async () => {
    const router = createRouter(shim.ipcMain, testSenderCheck);
    router.register(
      'test:boom',
      zodValidator(z.object({}).passthrough()),
      () => { throw new Error('internal-kaboom'); },
    );
    const env = await shim.invoke<unknown>('test:boom', {});
    expect(env.ok).toBe(false);
    if (!env.ok) {
      expect(env.error.code).toBe('INTERNAL');
      expect(env.error.message).toBe('internal-kaboom');
      expect((env.error as unknown as { stack?: unknown }).stack).toBeUndefined();
    }
  });

  it('awaits async handlers', async () => {
    const router = createRouter(shim.ipcMain, testSenderCheck);
    router.register(
      'test:async',
      zodValidator(z.object({}).passthrough()),
      async () => {
        await new Promise((r) => setTimeout(r, 5));
        return { done: true };
      },
    );
    const env = await shim.invoke<{ done: boolean }>('test:async', {});
    expect(env).toEqual({ ok: true, data: { done: true } });
  });
});
