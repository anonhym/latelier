import { z } from 'zod';
import type { IndexInfo } from '@shared/types';
import { IPC_CHANNELS } from '@shared/ipc';
import type { Router } from '../router.ts';
import { CollectionTargetSchema, NonEmpty, zodValidator } from '../validators.ts';
import type { IndexService } from '../../mongo/IndexService.ts';

const FieldDirection = z.union([
  z.literal(1),
  z.literal(-1),
  z.literal('text'),
  z.literal('hashed'),
  z.literal('2d'),
  z.literal('2dsphere'),
  z.literal('geoHaystack'),
]);

const CreateInput = CollectionTargetSchema.extend({
  fields: z
    .array(z.object({ field: NonEmpty, direction: FieldDirection }))
    .min(1),
  options: z.object({
    name: z.string().optional(),
    unique: z.boolean().optional(),
    sparse: z.boolean().optional(),
    expireAfterSeconds: z.number().int().nonnegative().optional(),
    partialFilterExpression: z.string().optional(),
    collation: z.string().optional(),
  }),
});

const DropInput = CollectionTargetSchema.extend({
  name: NonEmpty,
});

export function registerIndexChannels(router: Router, svc: IndexService): void {
  router.register(
    IPC_CHANNELS.indexList,
    zodValidator(CollectionTargetSchema),
    (input): Promise<IndexInfo[]> => svc.list(input),
  );

  router.register(
    IPC_CHANNELS.indexCreate,
    zodValidator(CreateInput),
    (input) => svc.create(input),
  );

  router.register(
    IPC_CHANNELS.indexDrop,
    zodValidator(DropInput),
    (input) => svc.drop(input),
  );
}
