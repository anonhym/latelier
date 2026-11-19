import { z } from 'zod';
import { IPC_CHANNELS } from '@shared/ipc';
import type { Router } from '../router.ts';
import { NonEmpty, SettingOwnerSchema, zodValidator } from '../validators.ts';
import type { RowSummaryService } from '../../services/RowSummaryService.ts';

const GetInputSchema = z.object({
  connectionId: NonEmpty,
  dbName: NonEmpty,
  collection: NonEmpty,
});

// The 1-4 field limit, `_id` and duplicates are the service's call, so the
// refusal carries one message rather than a zod issue list.
const SetInputSchema = z.object({
  owner: SettingOwnerSchema,
  dbName: NonEmpty,
  collection: NonEmpty,
  fields: z.array(z.string()),
});

const ClearInputSchema = z.object({
  owner: SettingOwnerSchema,
  dbName: NonEmpty,
  collection: NonEmpty,
});

export function registerRowSummaryChannels(router: Router, svc: RowSummaryService): void {
  router.register(
    IPC_CHANNELS.rowSummaryGet,
    zodValidator(GetInputSchema),
    (input) => svc.get(input),
  );

  router.register(
    IPC_CHANNELS.rowSummarySet,
    zodValidator(SetInputSchema),
    (input) => svc.set(input),
  );

  router.register(
    IPC_CHANNELS.rowSummaryClear,
    zodValidator(ClearInputSchema),
    (input) => {
      svc.clear(input);
      return undefined;
    },
  );
}
