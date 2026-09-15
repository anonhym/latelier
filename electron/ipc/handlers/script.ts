import { z } from 'zod';
import { IPC_CHANNELS } from '@shared/ipc';
import type { Router } from '../router.ts';
import { NonEmpty, zodValidator } from '../validators.ts';
import type { ScriptService } from '../../services/ScriptService.ts';

const ScriptRunInputSchema = z.object({
  connectionId: NonEmpty,
  dbName: z.string().optional(),
  source: z.string(),
  cancelToken: z.string().optional(),
  maxTimeMs: z.number().int().positive().optional(),
  ejsonRelaxed: z.boolean().optional(),
});

const CancelInputSchema = z.object({
  token: NonEmpty,
});

export function registerScriptChannels(router: Router, svc: ScriptService): void {
  router.register(
    IPC_CHANNELS.scriptRun,
    zodValidator(ScriptRunInputSchema),
    (input) => svc.run(input),
  );

  router.register(
    IPC_CHANNELS.scriptCancel,
    zodValidator(CancelInputSchema),
    ({ token }) => {
      svc.cancel(token);
      return undefined;
    },
  );
}
