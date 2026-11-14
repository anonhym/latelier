import { api, getErrorMessage } from '../../api/atelier';
import { notify } from '../../theme/notifications';
import { copyToClipboard } from '../../utils/clipboard';
import type { ContextMenuItem } from '../../components/ContextMenu';
import type { ConnectionSummary } from '@shared/types';
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
    { kind: 'sep' },
    { kind: 'item', label: 'Delete…', destructive: true, onClick: () => actions.onDelete(conn.id) },
  ];
}
