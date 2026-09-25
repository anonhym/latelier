import { IPC_CHANNELS } from '@shared/ipc';
import type { Router } from '../router.ts';
import { CollectionTargetSchema, NonEmpty, zodValidator } from '../validators.ts';
import type { ImportService } from '../../mongo/ImportService.ts';

// The path is only shape-checked here; `ImportService` re-validates it
// (absolute, allowed extension, a regular file) before reading.
const ImportSchema = CollectionTargetSchema.extend({
  path: NonEmpty,
});

export function registerDataChannels(router: Router, svc: ImportService): void {
  router.register(
    IPC_CHANNELS.dataImport,
    zodValidator(ImportSchema),
    (input) => svc.importFile(input),
  );
}
