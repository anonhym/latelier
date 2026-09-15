import { z } from 'zod';
import type { WebContents } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import type { Router } from '../router.ts';
import { CollectionTargetSchema, NonEmpty, zodValidator } from '../validators.ts';
import type { AppStateService } from '../../services/AppStateService.ts';
import type { PreviewFieldsService } from '../../services/PreviewFieldsService.ts';

const GetInput = z.object({ key: NonEmpty });
const SetInput = z.object({ key: NonEmpty, value: z.unknown() });

const SetPreviewFieldsInput = CollectionTargetSchema.extend({
  fields: z.array(z.string()),
});

const SetThemeInput = z.object({
  mode: z.enum(['light', 'dark', 'system']),
});

export const THEME_KEY = 'theme.mode';
export type ThemeMode = 'light' | 'dark' | 'system';

export function registerPrefsChannels(
  router: Router,
  appState: AppStateService,
  getWebContents: () => WebContents | null,
  // Required, not optional: `IpcApi` promises prefs:get/setPreviewFields
  // unconditionally, so registering them behind `if (previewSvc)` meant a
  // dropped argument would silently unregister two channels the renderer
  // still calls — a missing-handler rejection instead of an `{ ok: false }`
  // envelope, invisible to both `tsc` and `audit:ipc`. Now it is a compile
  // error.
  previewSvc: PreviewFieldsService,
): void {
  // Broadcast theme changes (user-set or system-flip) to the renderer.
  appState.subscribe<ThemeMode>(THEME_KEY, (mode) => {
    const wc = getWebContents();
    if (!wc || wc.isDestroyed()) return;
    wc.send(IPC_CHANNELS.prefsThemeEvent, mode ?? 'system');
  });

  router.register(
    IPC_CHANNELS.prefsGet,
    zodValidator(GetInput),
    ({ key }) => appState.get(key),
  );

  router.register(
    IPC_CHANNELS.prefsSet,
    zodValidator(SetInput),
    ({ key, value }) => {
      appState.set(key, value);
      return value;
    },
  );

  router.register(
    IPC_CHANNELS.prefsGetPreviewFields,
    zodValidator(CollectionTargetSchema),
    ({ connectionId, dbName, collection }) =>
      previewSvc.get(connectionId, dbName, collection),
  );

  router.register(
    IPC_CHANNELS.prefsSetPreviewFields,
    zodValidator(SetPreviewFieldsInput),
    ({ connectionId, dbName, collection, fields }) =>
      previewSvc.set(connectionId, dbName, collection, fields),
  );

  router.register(
    IPC_CHANNELS.prefsGetTheme,
    zodValidator(z.undefined().or(z.null()).optional()),
    () => (appState.get<ThemeMode>(THEME_KEY) ?? 'system') as ThemeMode,
  );

  router.register(
    IPC_CHANNELS.prefsSetTheme,
    zodValidator(SetThemeInput),
    ({ mode }) => {
      appState.set<ThemeMode>(THEME_KEY, mode);
    },
  );
}
