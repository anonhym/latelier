import { api, isIpcError } from '../../api/atelier';
import { notify } from '../../theme/notifications';

/**
 * the one place `api.mongo.disconnect` is called. `MongoPool.disconnect`
 * already no-ops on a Connection with no live client and swallows a failing
 * `client.close()` itself, so anything surfacing here is the IPC call failing
 * outright — worth a toast wherever it was triggered from, not silence, or
 * that row's status band is left silently disagreeing with reality.
 */
export async function disconnectConnection(id: string): Promise<void> {
  try {
    await api.mongo.disconnect(id);
  } catch (err) {
    notify.error(isIpcError(err) ? err.message : String(err), {
      title: 'Could not disconnect',
    });
  }
}
