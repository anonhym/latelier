import { Tooltip } from '@mantine/core';
import { IconPlugConnected } from '@tabler/icons-react';
import { themeVars } from '../../theme/themeVars';
import { AGENT_ACCESS_COPY, privilegeText } from './agentAccessCopy';
import { useAgentAccessState } from './useAgentAccessState';
import type { ConnectionSummary } from '@shared/types';

/**
 * The small sign that a Connection is Shared with Agents (X27 §12.3). It
 * shows only while Agent Access is on, and its tooltip repeats the last
 * privilege check of this run. An unshared Connection renders nothing and
 * reads no state.
 */
export function ShareMarker({ connection }: { connection: Pick<ConnectionSummary, 'id' | 'shareWithAgents'> }) {
  if (!connection.shareWithAgents) return null;
  return <SharedMarker connectionId={connection.id} />;
}

function SharedMarker({ connectionId }: { connectionId: string }) {
  const state = useAgentAccessState();
  if (!state?.enabled) return null;
  const text = privilegeText(state.privilege[connectionId]);
  return (
    <Tooltip label={text} withArrow multiline maw={260}>
      <span
        role="img"
        aria-label={`${AGENT_ACCESS_COPY.sharedBadge}. ${text}`}
        data-testid="share-marker"
        style={{ display: 'inline-flex', flexShrink: 0, color: themeVars.textMuted }}
      >
        <IconPlugConnected size={12} aria-hidden="true" />
      </span>
    </Tooltip>
  );
}
