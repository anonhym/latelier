import { api, getErrorMessage } from '../../api/atelier';
import { notifyConnectionsChanged } from '../../state/connections';
import { notify } from '../../theme/notifications';

async function setShared(connectionId: string, shared: boolean): Promise<void> {
  try {
    await api.agentAccess.setShared({ connectionId, shared });
  } catch (err) {
    notify.error(getErrorMessage(err, shared ? 'Could not share this Connection with Agents' : 'Could not stop sharing'));
  } finally {
    // The flag lives on the Connection row: whatever main decided, re-read it.
    notifyConnectionsChanged();
  }
}

/** Main owns the question and the privilege check; the renderer only asks and re-reads. */
export function shareWithAgents(connectionId: string): Promise<void> {
  return setShared(connectionId, true);
}

export function stopSharingWithAgents(connectionId: string): Promise<void> {
  return setShared(connectionId, false);
}
