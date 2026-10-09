import type { IpcMainInvokeEvent } from 'electron';
import type { Envelope } from '@shared/ipc';
import { invokeEvent } from './ipcSender';

type Handler = (evt: IpcMainInvokeEvent, payload: unknown) => unknown;

/** An `ipcMain` stand-in for `createRouter` plus `invoke(channel, payload?)`, which returns the raw `Envelope` and throws on an unregistered channel. */
export function createIpcShim() {
  const handlers = new Map<string, Handler>();
  return {
    ipcMain: {
      handle(channel: string, fn: Handler) {
        handlers.set(channel, fn);
      },
    } as const,
    async invoke<T>(channel: string, payload?: unknown): Promise<Envelope<T>> {
      const h = handlers.get(channel);
      if (!h) throw new Error(`no handler for ${channel}`);
      return (await h(invokeEvent, payload)) as Envelope<T>;
    },
  };
}
