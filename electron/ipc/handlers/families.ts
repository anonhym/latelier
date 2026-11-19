import { z } from 'zod';
import { IPC_CHANNELS } from '@shared/ipc';
import type { Router } from '../router.ts';
import { NonEmpty, zodValidator } from '../validators.ts';
import type { FamilyService } from '../../services/FamilyService.ts';

const NoInput = z.object({}).strict();

// Length is checked again, after trimming, by the service; a name the schema
// would let through but the service refuses crosses as VALIDATION either way.
const FamilyName = z.string();

const CreateInputSchema = z.object({
  name: FamilyName,
  memberIds: z.array(NonEmpty).optional(),
});

const RenameInputSchema = z.object({ id: NonEmpty, name: FamilyName });

const SetMembershipInputSchema = z.object({
  connectionIds: z.array(NonEmpty),
  familyId: NonEmpty.nullable(),
  keepAsLocal: z.boolean().optional(),
});

const DeleteInputSchema = z.object({ id: NonEmpty, keepAsLocal: z.boolean() });
const OverridesInputSchema = z.object({ id: NonEmpty });

export function registerFamiliesChannels(router: Router, svc: FamilyService): void {
  router.register(IPC_CHANNELS.familiesList, zodValidator(NoInput), () => svc.list());

  router.register(
    IPC_CHANNELS.familiesCreate,
    zodValidator(CreateInputSchema),
    (input) => svc.create(input),
  );

  router.register(
    IPC_CHANNELS.familiesRename,
    zodValidator(RenameInputSchema),
    (input) => svc.rename(input),
  );

  router.register(
    IPC_CHANNELS.familiesSetMembership,
    zodValidator(SetMembershipInputSchema),
    (input) => svc.setMembership(input),
  );

  router.register(
    IPC_CHANNELS.familiesDelete,
    zodValidator(DeleteInputSchema),
    (input) => {
      svc.delete(input);
      return undefined;
    },
  );

  router.register(
    IPC_CHANNELS.familiesOverrides,
    zodValidator(OverridesInputSchema),
    ({ id }) => svc.overrides(id),
  );

  router.register(
    IPC_CHANNELS.familiesSettings,
    zodValidator(OverridesInputSchema),
    ({ id }) => svc.settings(id),
  );
}
