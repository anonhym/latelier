import type { WebContents } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import type { Router } from '../router.ts';
import { IdInputSchema, zodValidator } from '../validators.ts';
import type { MongoPool } from '../../mongo/MongoPool.ts';

export function registerMongoChannels(
  router: Router,
  pool: MongoPool,
  getWebContents: () => WebContents | null,
): void {
  router.register(
    IPC_CHANNELS.mongoConnect,
    zodValidator(IdInputSchema),
    ({ id }) => pool.connect(id),
  );

  router.register(
    IPC_CHANNELS.mongoDisconnect,
    zodValidator(IdInputSchema),
    async ({ id }) => {
      await pool.disconnect(id);
      return { id };
    },
  );

  router.register(
    IPC_CHANNELS.mongoStatus,
    zodValidator(IdInputSchema),
    ({ id }) => pool.status(id),
  );

  router.register(
    IPC_CHANNELS.mongoPing,
    zodValidator(IdInputSchema),
    async ({ id }) => ({ roundTripMs: await pool.ping(id) }),
  );

  router.register(
    IPC_CHANNELS.mongoServerInfo,
    zodValidator(IdInputSchema),
    ({ id }) => pool.serverInfo(id),
  );

  // Forward status events to the renderer via an event channel.
  pool.on('status', (runtime) => {
    const wc = getWebContents();
    if (!wc || wc.isDestroyed()) return;
    wc.send(IPC_CHANNELS.mongoStatusEvent, runtime);
  });
}
