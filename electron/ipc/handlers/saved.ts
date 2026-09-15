import { z } from 'zod';
import { IPC_CHANNELS } from '@shared/ipc';
import type { Router } from '../router.ts';
import { CollectionTargetSchema, NonEmpty, zodValidator } from '../validators.ts';
import type { SavedQueryService } from '../../services/SavedQueryService.ts';

const SavedKindSchema = z.enum(['find', 'aggregation', 'script']);

const ListInputSchema = z.object({
  connectionId: NonEmpty.optional(),
  dbName: NonEmpty.optional(),
  collection: NonEmpty.optional(),
  kind: SavedKindSchema.optional(),
}).optional();

const GetInputSchema = z.object({ id: NonEmpty });

const CreateInputSchema = CollectionTargetSchema.extend({
  kind: SavedKindSchema,
  name: NonEmpty,
  payload: z.record(z.string(), z.unknown()),
});

const UpdateInputSchema = z.object({
  id: NonEmpty,
  patch: z.object({
    name: NonEmpty.optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  }),
});

const DeleteInputSchema = z.object({ id: NonEmpty });

const DuplicateInputSchema = z.object({
  id: NonEmpty,
  newName: NonEmpty,
});

export function registerSavedChannels(router: Router, svc: SavedQueryService): void {
  router.register(
    IPC_CHANNELS.savedList,
    zodValidator(ListInputSchema),
    (input) => svc.list(input ?? {}),
  );

  router.register(
    IPC_CHANNELS.savedGet,
    zodValidator(GetInputSchema),
    ({ id }) => svc.get(id),
  );

  router.register(
    IPC_CHANNELS.savedCreate,
    zodValidator(CreateInputSchema),
    (input) =>
      svc.create({
        connectionId: input.connectionId,
        dbName: input.dbName,
        collection: input.collection,
        kind: input.kind,
        name: input.name,
        payload: input.payload as unknown as import('@shared/types').SavedPayload,
      }),
  );

  router.register(
    IPC_CHANNELS.savedUpdate,
    zodValidator(UpdateInputSchema),
    ({ id, patch }) =>
      svc.update(id, {
        name: patch.name,
        payload: patch.payload as unknown as import('@shared/types').SavedPayload | undefined,
      }),
  );

  router.register(
    IPC_CHANNELS.savedDelete,
    zodValidator(DeleteInputSchema),
    ({ id }) => {
      svc.delete(id);
      return undefined;
    },
  );

  router.register(
    IPC_CHANNELS.savedDuplicate,
    zodValidator(DuplicateInputSchema),
    ({ id, newName }) => svc.duplicate(id, newName),
  );
}
