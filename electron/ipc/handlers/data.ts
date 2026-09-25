import { z } from 'zod';
import type { WebContents } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import type { Router } from '../router.ts';
import { CollectionTargetSchema, NonEmpty, zodValidator } from '../validators.ts';
import type { ImportService } from '../../mongo/ImportService.ts';
import type { DataImportProgressEvent } from '@shared/types';

// The path is only shape-checked here; `ImportService` re-validates it
// (absolute, allowed extension, a regular file) before reading.
const ImportSchema = CollectionTargetSchema.extend({
  path: NonEmpty,
  cancelToken: NonEmpty.optional(),
});

const CancelInputSchema = z.object({
  token: NonEmpty,
});

export function registerDataChannels(router: Router, svc: ImportService): void {
  router.register(
    IPC_CHANNELS.dataImport,
    zodValidator(ImportSchema),
    (input) => svc.importFile(input),
  );

  router.register(
    IPC_CHANNELS.dataCancelImport,
    zodValidator(CancelInputSchema),
    ({ token }) => {
      svc.cancel(token);
      return undefined;
    },
  );
}

/**
 * Build the `emit` callback `ImportService` uses to push progress events to
 * the renderer. Same shape as `mshell.ts`'s `makeMshellEmitter` — lives here,
 * next to the channel name.
 */
export function makeDataEmitter(
  getWebContents: () => WebContents | null,
): (event: DataImportProgressEvent) => void {
  return (event) => {
    const wc = getWebContents();
    if (!wc || wc.isDestroyed()) return;
    wc.send(IPC_CHANNELS.dataImportProgressEvent, event);
  };
}
