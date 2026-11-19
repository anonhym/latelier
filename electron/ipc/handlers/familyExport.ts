import { z } from 'zod';
import { IPC_CHANNELS } from '@shared/ipc';
import type { Router } from '../router.ts';
import { NonEmpty, zodValidator } from '../validators.ts';
import type { FamilyExportService } from '../../services/FamilyExportService.ts';

const NoInput = z.object({}).strict();

const ExportInputSchema = z.strictObject({ familyId: NonEmpty });

// A new family's name is trimmed and length-checked again by the service.
const TargetSchema = z.union([
  z.strictObject({ familyId: NonEmpty }),
  z.strictObject({ newName: z.string() }),
]);

const PlanInputSchema = z.strictObject({ token: NonEmpty, target: TargetSchema });

const ApplyInputSchema = z.strictObject({
  token: NonEmpty,
  target: TargetSchema,
  resolutions: z.record(z.string(), z.enum(['keep', 'take'])),
});

/**
 * Family Export (X24). No path and no file content crosses in either
 * direction except the saved path in the export result: main owns both
 * dialogs and holds a read file under a token. Nothing here is a secret.
 */
export function registerFamilyExportChannels(router: Router, svc: FamilyExportService): void {
  router.register(IPC_CHANNELS.familiesExport, zodValidator(ExportInputSchema), (input) =>
    svc.export(input),
  );
  router.register(IPC_CHANNELS.familiesReadExport, zodValidator(NoInput), () => svc.readExport());
  router.register(IPC_CHANNELS.familiesPlanApply, zodValidator(PlanInputSchema), (input) =>
    svc.planApply(input),
  );
  router.register(IPC_CHANNELS.familiesApply, zodValidator(ApplyInputSchema), (input) =>
    svc.apply(input),
  );
}
