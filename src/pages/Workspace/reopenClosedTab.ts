import { getErrorMessage } from '../../api/atelier';
import { notify } from '../../theme/notifications';
import type { WorkspaceTabsState } from '../../state/workspaceTabs';

/**
 * W01 §14.8 — ⌘⇧T, the palette command and the tab menu all come through here.
 * While the Connection list is still loading every entry would read as "its
 * Connection is gone" and be dropped, so nothing is attempted until it is
 * there; and a call that finds nothing says so instead of doing nothing.
 */
export async function reopenClosedTab(
  tabs: Pick<WorkspaceTabsState, 'reopenClosed'>,
  connections: readonly { id: string }[],
  connectionsLoading: boolean,
): Promise<void> {
  if (connectionsLoading) {
    notify.info('Connections are still loading. Try again in a moment.');
    return;
  }
  try {
    const reopened = await tabs.reopenClosed((id) => connections.some((c) => c.id === id));
    if (!reopened) notify.info('No closed tab to reopen');
  } catch (err) {
    notify.error(getErrorMessage(err, 'Could not reopen the tab'));
  }
}
