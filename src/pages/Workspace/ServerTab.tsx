import type { ConnectionSummary, ServerSection, ServerTab as ServerTabType } from '@shared/types';
import { DetailPanel } from '../DetailPanel';
import { shareWithAgents, stopSharingWithAgents } from '../../features/agentAccess/useShareWithAgents';

/**
 * A Connection's server screen as a workspace tab (C05 §11): Overview,
 * Monitor, Collections, Users and Roles, with the section in view kept in the
 * tab's own state so it survives a tab switch and a relaunch.
 */
export function ServerTab({ tab, connection, onSection, onDelete, onDisconnect, onClose }: {
  tab: ServerTabType;
  connection: ConnectionSummary | null;
  onSection: (id: string, section: ServerSection) => void;
  onDelete: (id: string) => void;
  onDisconnect: (id: string) => void;
  /** Closes this tab; offered when its Connection no longer exists. */
  onClose: (id: string) => void;
}) {
  return (
    <DetailPanel
      key={tab.id}
      selected={connection}
      loading={false}
      onDelete={onDelete}
      onDisconnect={onDisconnect}
      onShareWithAgents={(id) => void shareWithAgents(id)}
      onStopSharing={(id) => void stopSharingWithAgents(id)}
      section={tab.state.section}
      onSectionChange={(section) => onSection(tab.id, section)}
      onCloseTab={() => onClose(tab.id)}
    />
  );
}
