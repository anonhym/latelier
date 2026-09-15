import { shell } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '@shared/ipc';
import type { Router } from '../router.ts';
import { zodValidator } from '../validators.ts';
import { ValidationError } from '../../errors.ts';

// Only MongoDB docs are allowed — this channel is deliberately narrower than
// `app:openExternal` so the X04 doc panel cannot be turned into an arbitrary-
// URL opener.
const DOCS_PREFIX = 'https://www.mongodb.com/docs/';

const OpenExternalInput = z.object({ url: z.string() });

export function registerShellChannels(router: Router): void {
  router.register(
    IPC_CHANNELS.shellOpenExternal,
    zodValidator(OpenExternalInput),
    async ({ url }) => {
      if (!url.startsWith(DOCS_PREFIX)) {
        throw new ValidationError(
          `URL must start with ${DOCS_PREFIX}`,
          { url },
        );
      }
      await shell.openExternal(url);
      return { opened: true as const };
    },
  );
}
