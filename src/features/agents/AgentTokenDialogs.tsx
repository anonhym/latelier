import React from 'react';
import { Button, Group, Modal, NativeSelect, Stack, Text, TextInput } from '@mantine/core';
import type { AgentTokenInfo, SnippetClient } from '@shared/types';
import { AGENT_CLIENT_OPTIONS, DEFAULT_AGENT_CLIENT, isAgentClient } from '../agentAccess/agentClients';
import { AGENT_NAME_MAX } from './connectPanel';
import type { AgentTokenActions } from './useAgentTokenActions';

/** The two app dialogs of an Agent's menu: the client to copy a setup for, and a new name. */
export function AgentTokenDialogs({ actions }: { actions: AgentTokenActions }) {
  const { dialog } = actions;
  if (!dialog) return null;
  return dialog.kind === 'copy' ? (
    <CopySetupDialog token={dialog.token} actions={actions} />
  ) : (
    <RenameDialog token={dialog.token} actions={actions} />
  );
}

function CopySetupDialog({ token, actions }: { token: AgentTokenInfo; actions: AgentTokenActions }) {
  const [client, setClient] = React.useState<SnippetClient>(DEFAULT_AGENT_CLIENT);
  return (
    <Modal opened onClose={actions.closeDialog} title={`Copy setup again for “${token.name}”`} centered size={420}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void actions.copySetup(token, client);
        }}
      >
        <Stack gap="sm">
          <NativeSelect
            size="xs"
            label="Client"
            data={[...AGENT_CLIENT_OPTIONS]}
            value={client}
            data-autofocus
            onChange={(e) => {
              const next = e.currentTarget.value;
              if (isAgentClient(next)) setClient(next);
            }}
          />
          <Text size="xs" c="dimmed">
            This makes a new token for this Agent and ends its live sessions. Paste the new setup into the client.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" size="xs" onClick={actions.closeDialog}>
              Cancel
            </Button>
            <Button type="submit" size="xs" loading={actions.busy}>
              Copy setup
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function RenameDialog({ token, actions }: { token: AgentTokenInfo; actions: AgentTokenActions }) {
  const [name, setName] = React.useState(token.name);
  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= AGENT_NAME_MAX;
  return (
    <Modal opened onClose={actions.closeDialog} title={`Rename “${token.name}”`} centered size={420}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void actions.rename(token, trimmed);
        }}
      >
        <Stack gap="sm">
          <TextInput
            size="xs"
            label="Agent name"
            value={name}
            maxLength={AGENT_NAME_MAX}
            data-autofocus
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <Text size="xs" c="dimmed">
            The Agent Read Log keeps the name each row was written with.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" size="xs" onClick={actions.closeDialog}>
              Cancel
            </Button>
            <Button type="submit" size="xs" disabled={!valid} loading={actions.busy}>
              Rename
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
