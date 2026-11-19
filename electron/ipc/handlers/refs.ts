import { z } from 'zod';
import { IPC_CHANNELS } from '@shared/ipc';
import type { Router } from '../router.ts';
import { NonEmpty, SettingOwnerSchema, zodValidator } from '../validators.ts';
import type { ReferenceRulesService } from '../../services/ReferenceRulesService.ts';
import { MAX_NAME, MAX_PATHS, MAX_TEMPLATE, TargetField } from '../../services/familyExportFormat.ts';

// What a rule may hold is what a Family Export file can carry back in.
const Name = NonEmpty.max(MAX_NAME);
const Projection = z.array(z.string().max(MAX_NAME)).max(MAX_PATHS);
const Template = z.string().max(MAX_TEMPLATE);

// A namespace is both names or neither: `dbName` alone used to fall through
// to the whole connection's rules, answering a question nobody asked.
const ListInputSchema = z.object({
  connectionId: NonEmpty,
  dbName: NonEmpty.optional(),
  collection: NonEmpty.optional(),
  effective: z.boolean().optional(),
}).refine((i) => (i.dbName === undefined) === (i.collection === undefined), {
  message: 'dbName and collection must be given together',
});

const GetInputSchema = z.object({ id: NonEmpty });
const DeleteInputSchema = z.object({ id: NonEmpty });

const CreateInputSchema = z.object({
  owner: SettingOwnerSchema,
  sourceDb: Name,
  sourceCollection: Name,
  sourceField: Name,
  targetDb: Name,
  targetCollection: Name,
  targetField: TargetField.optional(),
  projection: Projection.optional(),
  displayTemplate: Template.optional(),
  enabled: z.boolean().optional(),
});

const PatchSchema = z.object({
  targetDb: Name.optional(),
  targetCollection: Name.optional(),
  targetField: TargetField.optional(),
  projection: Projection.optional(),
  displayTemplate: Template.optional(),
  enabled: z.boolean().optional(),
});

const UpdateInputSchema = z.object({
  id: NonEmpty,
  patch: PatchSchema,
});

const OverrideInputSchema = z.object({
  connectionId: NonEmpty,
  sharedRuleId: NonEmpty,
  patch: PatchSchema,
});

const ResetToSharedInputSchema = z.object({ id: NonEmpty });

const ResolveInputSchema = z.object({
  ruleId: NonEmpty,
  connectionId: NonEmpty.optional(),
  valueEjson: z.string(),
});

const AutodetectInputSchema = z.object({
  connectionId: NonEmpty,
  dbName: NonEmpty,
  collection: NonEmpty,
  sampleDocs: z.array(z.unknown()).optional(),
});

export function registerRefsChannels(
  router: Router,
  svc: ReferenceRulesService,
): void {
  router.register(
    IPC_CHANNELS.refsList,
    zodValidator(ListInputSchema),
    ({ connectionId, dbName, collection, effective }) => {
      if (effective) return svc.effective(connectionId, dbName, collection);
      if (dbName && collection) {
        return svc.listForCollection(connectionId, dbName, collection);
      }
      return svc.list(connectionId);
    },
  );

  router.register(
    IPC_CHANNELS.refsGet,
    zodValidator(GetInputSchema),
    ({ id }) => svc.get(id),
  );

  router.register(
    IPC_CHANNELS.refsCreate,
    zodValidator(CreateInputSchema),
    (input) => svc.create(input),
  );

  router.register(
    IPC_CHANNELS.refsUpdate,
    zodValidator(UpdateInputSchema),
    ({ id, patch }) => svc.update(id, patch),
  );

  router.register(
    IPC_CHANNELS.refsDelete,
    zodValidator(DeleteInputSchema),
    ({ id }) => {
      svc.delete(id);
      return undefined;
    },
  );

  router.register(
    IPC_CHANNELS.refsResolve,
    zodValidator(ResolveInputSchema),
    (input) => svc.resolve(input),
  );

  router.register(
    IPC_CHANNELS.refsAutodetect,
    zodValidator(AutodetectInputSchema),
    (input) => svc.autodetect(input),
  );

  router.register(
    IPC_CHANNELS.refsOverride,
    zodValidator(OverrideInputSchema),
    (input) => svc.override(input),
  );

  router.register(
    IPC_CHANNELS.refsResetToShared,
    zodValidator(ResetToSharedInputSchema),
    ({ id }) => {
      svc.resetToShared(id);
      return undefined;
    },
  );
}
