import type { IpcMainInvokeEvent } from 'electron';
import type { Envelope } from '@shared/ipc';
import { invokeEvent } from './ipcSender';

type Handler = (evt: IpcMainInvokeEvent, payload: unknown) => unknown;

/**
 * An `ipcMain` stand-in for `createRouter`, plus an `invoke` that calls the
 * registered handler as a trusted renderer and returns its raw `Envelope`.
 * Throws when nothing is registered on the channel, so a missing
 * `registerXxxChannels` fails loudly instead of reading as a pass.
 */
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
