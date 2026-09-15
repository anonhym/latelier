import { z } from 'zod';
import { IPC_CHANNELS } from '@shared/ipc';
import type { Router } from '../router.ts';
import { CollectionTargetSchema, NonEmpty, zodValidator } from '../validators.ts';
import type { AggregationService } from '../../mongo/AggregationService.ts';

const StageSchema = z.object({
  id: z.number().int(),
  op: NonEmpty,
  body: z.string(),
  enabled: z.boolean(),
  note: z.string().optional(),
});

const AggInputSchema = CollectionTargetSchema.extend({
  stages: z.array(StageSchema).min(1),
  limit: z.number().int().min(1).max(10_000).optional(),
  cancelToken: z.string().optional(),
  allowWrite: z.boolean().optional(),
});

const PreviewInputSchema = CollectionTargetSchema.extend({
  stages: z.array(StageSchema).min(1),
  limit: z.number().int().min(1).max(50).optional(),
});

const CancelInputSchema = z.object({ token: NonEmpty });

const RunAndSaveSchema = AggInputSchema.extend({
  target: z.object({
    dbName: NonEmpty,
    collection: NonEmpty,
    mode: z.enum(['$out', '$merge']),
    merge: z
      .object({
        whenMatched: z.enum(['replace', 'keepExisting', 'merge', 'fail']).optional(),
        whenNotMatched: z.enum(['insert', 'discard', 'fail']).optional(),
      })
      .optional(),
  }),
});

const ExplainSchema = AggInputSchema.extend({
  verbosity: z.enum(['queryPlanner', 'executionStats', 'allPlansExecution']),
});

export function registerAggChannels(router: Router, svc: AggregationService): void {
  router.register(
    IPC_CHANNELS.aggRun,
    zodValidator(AggInputSchema),
    (input) => svc.run(input),
  );
  router.register(
    IPC_CHANNELS.aggPreviewUpToStage,
    zodValidator(PreviewInputSchema),
    (input) => svc.previewUpToStage(input),
  );
  router.register(
    IPC_CHANNELS.aggCancel,
    zodValidator(CancelInputSchema),
    ({ token }) => {
      svc.cancel(token);
      return undefined;
    },
  );
  router.register(
    IPC_CHANNELS.aggRunAndSave,
    zodValidator(RunAndSaveSchema),
    (input) => svc.runAndSave(input),
  );
  router.register(
    IPC_CHANNELS.aggExplain,
    zodValidator(ExplainSchema),
    (input) => svc.explain(input),
  );
}
