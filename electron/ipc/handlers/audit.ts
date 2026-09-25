import { z } from 'zod';
import { IPC_CHANNELS } from '@shared/ipc';
import type { Router } from '../router.ts';
import { NonEmpty, zodValidator } from '../validators.ts';
import type { AuditService } from '../../services/AuditService.ts';

const ListInputSchema = z.object({
  connectionId: NonEmpty,
  dbName: NonEmpty.optional(),
  collection: NonEmpty.optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  before: NonEmpty.optional(),
});

export function registerAuditChannels(router: Router, svc: AuditService): void {
  router.register(
    IPC_CHANNELS.auditList,
    zodValidator(ListInputSchema),
    (input) => svc.list(input),
  );
}
