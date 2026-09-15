import { z } from 'zod';
import { IPC_CHANNELS } from '@shared/ipc';
import type { Router } from '../router.ts';
import { CollectionTargetSchema, NonEmpty, zodValidator } from '../validators.ts';
import type { CollectionAdminService } from '../../mongo/CollectionAdminService.ts';

const CreateOptions = z.object({
  capped: z.boolean().optional(),
  size: z.number().int().positive().optional(),
  max: z.number().int().positive().optional(),
  timeseries: z
    .object({
      timeField: NonEmpty,
      metaField: z.string().optional(),
      granularity: z.enum(['seconds', 'minutes', 'hours']).optional(),
    })
    .optional(),
  expireAfterSeconds: z.number().int().nonnegative().optional(),
  collation: z.string().optional(),
  validator: z.string().optional(),
  validationLevel: z.enum(['off', 'strict', 'moderate']).optional(),
  validationAction: z.enum(['error', 'warn']).optional(),
});

const CreateInput = CollectionTargetSchema.extend({
  options: CreateOptions,
});

const DropInput = CollectionTargetSchema;

const RenameInput = CollectionTargetSchema.extend({
  newName: NonEmpty,
});

const DatabaseDropInput = z.object({
  connectionId: NonEmpty,
  dbName: NonEmpty,
});

export function registerCollectionAdminChannels(
  router: Router,
  svc: CollectionAdminService,
): void {
  router.register(
    IPC_CHANNELS.collectionCreate,
    zodValidator(CreateInput),
    (input) => svc.create(input),
  );

  router.register(
    IPC_CHANNELS.collectionDrop,
    zodValidator(DropInput),
    (input) => svc.drop(input),
  );

  router.register(
    IPC_CHANNELS.collectionRename,
    zodValidator(RenameInput),
    (input) => svc.rename(input),
  );

  router.register(
    IPC_CHANNELS.databaseDrop,
    zodValidator(DatabaseDropInput),
    (input) => svc.dropDatabase(input),
  );
}
