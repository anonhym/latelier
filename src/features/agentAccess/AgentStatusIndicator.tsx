import { Menu, Text } from '@mantine/core';
import { IconPlugConnected } from '@tabler/icons-react';
import type React from 'react';
import { useSettings } from '../../pages/SettingsContext';
import { themeVars } from '../../theme/themeVars';
import {
  AGENT_ACCESS_COPY as COPY,
  indicatorLabel,
  privilegeText,
  shareNamedAction,
  stopShareNamedAction,
} from './agentAccessCopy';
import { useAgentAccessState } from './useAgentAccessState';
import { shareWithAgents, stopSharingWithAgents } from './useShareWithAgents';
import type { AgentAccessState, ConnectionSummary } from '@shared/types';

const buttonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: themeVars.gapXs,
  padding: '0 4px',
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
};

/**
 * The status bar's Agents control (X27 §12.2). With a focused Connection it
 * opens a menu to share or stop sharing that Connection, so a collection or
 * data view never has to be left to do it; with none it opens Settings. It
 * reads "Agents off" while Agent Access is off, and is absent when there is
 * neither a focused Connection nor Agent Access to report on.
 */
export function AgentStatusIndicator({ connection = null }: { connection?: ConnectionSummary | null }) {
  const state = useAgentAccessState();
  const settings = useSettings();
  if (!state) return null;
  if (!state.enabled && !connection) return null;

  const openSettings = () => settings.open('agents');
  const face = (
    <>
      <IconPlugConnected size={12} aria-hidden="true" />
      <span aria-hidden="true">{state.enabled ? `Agents · ${state.sessionReadCount}` : COPY.offText}</span>
    </>
  );
  const label = state.enabled ? indicatorLabel(state.sessionReadCount) : COPY.offLabel;

  if (!connection) {
    return (
      <button type="button" data-testid="agent-status" aria-label={label} onClick={openSettings} style={buttonStyle}>
        {face}
      </button>
    );
  }

  return (
    <Menu position="top-start" withinPortal shadow="md">
      <Menu.Target>
        <button
          type="button"
          data-testid="agent-status"
          data-hint-anchor="agents.share"
          aria-label={label}
          data-shared={connection.shareWithAgents || undefined}
          style={{ ...buttonStyle, color: connection.shareWithAgents && state.enabled ? themeVars.text : 'inherit' }}
        >
          {face}
        </button>
      </Menu.Target>
      <Menu.Dropdown data-testid="agent-status-menu">
        <ConnectionShareSection connection={connection} state={state} />
        <Menu.Divider />
        <Menu.Item onClick={openSettings}>{COPY.settingsAction}</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

function ConnectionShareSection({ connection, state }: { connection: ConnectionSummary; state: AgentAccessState }) {
  const shared = connection.shareWithAgents === true;
  const open = connection.status === 'connected';
  return (
    <>
      <Menu.Label>
        <Text size="xs" fw={600} c={themeVars.text} truncate maw={280}>{connection.name}</Text>
        <Text size="xs" c="dimmed" maw={280} data-testid="agent-status-share-state">
          {shared ? COPY.sharedBadge : COPY.notShared}
          {shared && state.enabled ? ` · ${privilegeText(state.privilege[connection.id])}` : ''}
          {shared && !state.enabled ? ` · ${COPY.offLabel}` : ''}
        </Text>
      </Menu.Label>
      {shared ? (
        <Menu.Item onClick={() => void stopSharingWithAgents(connection.id)}>{stopShareNamedAction(connection.name)}</Menu.Item>
      ) : (
        <Menu.Item
          disabled={!open}
          title={open ? undefined : COPY.openFirst}
          onClick={() => void shareWithAgents(connection.id)}
        >
          {shareNamedAction(connection.name)}
        </Menu.Item>
      )}
      {!shared && !open && (
        <Text size="xs" c="dimmed" px="sm" pb={4}>{COPY.openFirst}</Text>
      )}
    </>
  );
}
