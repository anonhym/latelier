import { z } from 'zod';
import { IPC_CHANNELS } from '@shared/ipc';
import type { Router } from '../router.ts';
import { CollectionTargetSchema, NonEmpty, zodValidator } from '../validators.ts';
import type { QueryService } from '../../mongo/QueryService.ts';

export const FindInputSchema = CollectionTargetSchema.extend({
  filter: NonEmpty,
  projection: z.string().optional(),
  sort: z.string().optional(),
  limit: z.number().int().min(1).max(1000),
  // Cap deep pagination: Mongo walks and discards `skip` docs server-side, so
  // an unbounded skip is an O(n) scan with no time ceiling. 10M is far past any
  // realistic GUI paging while still bounding the pathological case.
  skip: z.number().int().min(0).max(10_000_000),
  ejsonRelaxed: z.boolean().optional(),
  cancelToken: z.string().optional(),
});

const CountInputSchema = CollectionTargetSchema.extend({
  filter: NonEmpty,
  ejsonRelaxed: z.boolean().optional(),
});

const FindOneInputSchema = CollectionTargetSchema.extend({
  filter: NonEmpty,
  projection: z.string().optional(),
  sort: z.string().optional(),
});

const ExplainInputSchema = CollectionTargetSchema.extend({
  filter: NonEmpty,
  projection: z.string().optional(),
  sort: z.string().optional(),
  ejsonRelaxed: z.boolean().optional(),
  verbosity: z.enum(['queryPlanner', 'executionStats', 'allPlansExecution']),
});

const CancelInputSchema = z.object({
  token: NonEmpty,
});

export function registerQueryChannels(router: Router, svc: QueryService): void {
  router.register(
    IPC_CHANNELS.queryFind,
    zodValidator(FindInputSchema),
    (input) => svc.find(input),
  );

  router.register(
    IPC_CHANNELS.queryCount,
    zodValidator(CountInputSchema),
    (input) => svc.count(input),
  );

  router.register(
    IPC_CHANNELS.queryFindOne,
    zodValidator(FindOneInputSchema),
    (input) => svc.findOne(input),
  );

  router.register(
    IPC_CHANNELS.queryExplain,
    zodValidator(ExplainInputSchema),
    (input) => svc.explain(input),
  );

  router.register(
    IPC_CHANNELS.queryCancel,
    zodValidator(CancelInputSchema),
    ({ token }) => {
      svc.cancel(token);
      return undefined;
    },
  );
}
