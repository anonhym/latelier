import { Button, Group, Stack, Text } from '@mantine/core';
import { useInRouterContext, useLocation, useNavigate } from 'react-router-dom';
import { useAgentAccessState } from './useAgentAccessState';
import { AgentAccessSwitch } from '../agents/SetupCapabilities';
import { requestAgentsPage } from '../agents/agentsNav';

interface AgentAccessSectionProps {
  /** Closes Settings: Open Agents leaves it for the Agents tab. */
  onLeave: () => void;
}

/**
 * Settings → Agent Access (X30 §11): the switch, one status line and Open
 * Agents. Tokens, setup steps, the shared list and what an Agent can do live
 * in Agents mode.
 */
export function AgentAccessSection({ onLeave }: AgentAccessSectionProps) {
  const state = useAgentAccessState();
  const routed = useInRouterContext();
  if (!state) return <Text size="xs" c="dimmed">Loading…</Text>;
  return (
    <Stack gap="xs">
      <AgentAccessSwitch state={state} />
      <Group justify="flex-end">
        {routed ? <RoutedOpenAgents onLeave={onLeave} /> : <OpenAgentsButton onOpen={() => openAgents(onLeave)} />}
      </Group>
    </Stack>
  );
}

function openAgents(onLeave: () => void): void {
  requestAgentsPage({ kind: 'setup' });
  onLeave();
}

/** Settings opens from any screen; the Agents tab lives in the Workspace. */
function RoutedOpenAgents({ onLeave }: AgentAccessSectionProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <OpenAgentsButton
      onOpen={() => {
        openAgents(onLeave);
        if (pathname !== '/workspace') void navigate('/workspace');
      }}
    />
  );
}

function OpenAgentsButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button variant="default" size="compact-sm" onClick={onOpen}>
      Open Agents
    </Button>
  );
}
