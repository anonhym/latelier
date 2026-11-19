import { api, getErrorMessage } from '../../api/atelier';
import { notify } from '../../theme/notifications';
import { copyToClipboard } from '../../utils/clipboard';
import type { ContextMenuItem } from '../../components/ContextMenu';
import type { ConnectionSummary } from '@shared/types';
import { AGENT_ACCESS_COPY } from '../agentAccess/agentAccessCopy';
import { STATUS_PRESENTATION } from './connectionStatus';

/** Main builds the URI without the saved password, so none reaches the clipboard. */
export function copyConnectionString(connectionId: string): void {
  void api.conn
    .getUri(connectionId)
    .then(({ uri }) => copyToClipboard(uri, 'Connection string copied — password not included.'))
    .catch((e: unknown) => notify.error(getErrorMessage(e, 'Could not build the connection string')));
}

export interface ConnectionRowActions {
  onManage: (id: string) => void;
  onEdit: (id: string) => void;
  onDisconnect: (id: string) => void;
  onDelete: (id: string) => void;
  /**
   * Family membership (X23). Only the Connections table offers these: the
   * Switcher leaves them out, so its menu carries no family actions.
   */
  onAddToFamily?: (id: string) => void;
  onLeaveFamily?: (id: string) => void;
  /** Agent Access (X27 §12.3). Offered where the caller passes them: "Share" when not shared, "Stop sharing" when shared. */
  onShareWithAgents?: (id: string) => void;
  onStopSharing?: (id: string) => void;
}

function agentItems(conn: ConnectionSummary, actions: ConnectionRowActions): ContextMenuItem[] {
  const { onShareWithAgents, onStopSharing } = actions;
  if (conn.shareWithAgents) {
    return onStopSharing ? [{ kind: 'item', label: AGENT_ACCESS_COPY.stopShareAction, onClick: () => onStopSharing(conn.id) }] : [];
  }
  return onShareWithAgents ? [{ kind: 'item', label: AGENT_ACCESS_COPY.shareAction, onClick: () => onShareWithAgents(conn.id) }] : [];
}

function familyItems(conn: ConnectionSummary, actions: ConnectionRowActions): ContextMenuItem[] {
  const { onAddToFamily, onLeaveFamily } = actions;
  const items: ContextMenuItem[] = [];
  if (onAddToFamily) items.push({ kind: 'item', label: 'Add to family…', onClick: () => onAddToFamily(conn.id) });
  if (onLeaveFamily) {
    items.push({
      kind: 'item',
      label: 'Leave family',
      onClick: () => onLeaveFamily(conn.id),
      disabled: !conn.familyId,
      disabledTitle: 'Not in a family',
    });
  }
  return items;
}

/**
 * The one `⋯` a Connection row carries, in the Switcher and in the
 * Connections table alike, so the two can never list different actions.
 * Delete sits last, after a divider: it used to be an icon one slip of the
 * pointer from Edit.
 */
export function connectionRowMenu(conn: ConnectionSummary, actions: ConnectionRowActions): ContextMenuItem[] {
  return [
    { kind: 'item', label: 'Open server overview', onClick: () => actions.onManage(conn.id) },
    { kind: 'item', label: 'Edit…', onClick: () => actions.onEdit(conn.id) },
    {
      kind: 'item',
      label: 'Disconnect',
      onClick: () => actions.onDisconnect(conn.id),
      // Only a row with a client to drop, as for the ⌫ shortcut.
      disabled: !STATUS_PRESENTATION[conn.status].live,
      disabledTitle: 'Not connected',
    },
    { kind: 'item', label: 'Copy connection string', onClick: () => copyConnectionString(conn.id) },
    ...familyItems(conn, actions),
    ...agentItems(conn, actions),
    { kind: 'sep' },
    { kind: 'item', label: 'Delete…', destructive: true, onClick: () => actions.onDelete(conn.id) },
  ];
}
