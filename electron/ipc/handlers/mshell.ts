import { z } from 'zod';
import type { WebContents } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import type { Router } from '../router.ts';
import { NonEmpty, zodValidator } from '../validators.ts';
import type { ShellService } from '../../services/ShellService.ts';
import type { ShellOutputEvent } from '@shared/types';

const StartInput = z.object({
  connectionId: NonEmpty,
  dbName: z.string().optional(),
});
const WriteInput = z.object({
  sessionId: NonEmpty,
  data: z.string(),
});
const StopInput = z.object({ sessionId: NonEmpty });
const NoInput = z.undefined().or(z.null()).optional();

export function registerMshellChannels(router: Router, svc: ShellService): void {
  router.register(
    IPC_CHANNELS.mshellStart,
    zodValidator(StartInput),
    (input) => svc.start(input),
  );

  router.register(
    IPC_CHANNELS.mshellWrite,
    zodValidator(WriteInput),
    ({ sessionId, data }) => {
      svc.write(sessionId, data);
      return undefined as void;
    },
  );

  router.register(
    IPC_CHANNELS.mshellStop,
    zodValidator(StopInput),
    async ({ sessionId }) => {
      await svc.stop(sessionId);
      return undefined as void;
    },
  );

  router.register(IPC_CHANNELS.mshellList, zodValidator(NoInput), () => svc.list());
}

/**
 * Build the `emit` callback that ShellService uses to push output events to
 * the renderer. Lives here (next to the channel name) so the channel and its
 * forwarder are colocated.
 */
export function makeMshellEmitter(
  getWebContents: () => WebContents | null,
): (event: ShellOutputEvent) => void {
  return (event) => {
    const wc = getWebContents();
    if (!wc || wc.isDestroyed()) return;
    wc.send(IPC_CHANNELS.mshellOutputEvent, event);
  };
}
