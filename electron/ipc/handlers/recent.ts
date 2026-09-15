import { z } from 'zod';
import { IPC_CHANNELS } from '@shared/ipc';
import type { Router } from '../router.ts';
import { NonEmpty, zodValidator } from '../validators.ts';
import type { RecentQueryService } from '../../services/RecentQueryService.ts';

const RecentKindSchema = z.enum(['find', 'aggregation']);

const ListInputSchema = z.object({
  connectionId: NonEmpty.optional(),
  dbName: NonEmpty.optional(),
  collection: NonEmpty.optional(),
  kind: RecentKindSchema.optional(),
  limit: z.number().int().min(1).optional(),
}).optional();

const GetInputSchema = z.object({ id: NonEmpty });

const ClearInputSchema = z.object({
  id: NonEmpty.optional(),
  connectionId: NonEmpty.optional(),
  dbName: NonEmpty.optional(),
  collection: NonEmpty.optional(),
  kind: RecentKindSchema.optional(),
}).optional();

export function registerRecentChannels(router: Router, svc: RecentQueryService): void {
  router.register(
    IPC_CHANNELS.recentList,
    zodValidator(ListInputSchema),
    (input) => svc.list(input ?? {}),
  );

  router.register(
    IPC_CHANNELS.recentGet,
    zodValidator(GetInputSchema),
    ({ id }) => svc.get(id),
  );

  router.register(
    IPC_CHANNELS.recentClear,
    zodValidator(ClearInputSchema),
    (input) => svc.clear(input ?? {}),
  );
}
