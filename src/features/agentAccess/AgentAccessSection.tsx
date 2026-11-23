import React from 'react';
import { Button, Code, Group, List, Stack, Switch, Table, Text, TextInput } from '@mantine/core';
import { api, getErrorMessage } from '../../api/atelier';
import { notify } from '../../theme/notifications';
import { relativeTime } from '../../utils/relativeTime';
import { AGENT_ACCESS_COPY as COPY, readCountText } from './agentAccessCopy';
import { useAgentAccessState } from './useAgentAccessState';
import { stopSharingWithAgents } from './useShareWithAgents';
import { useConnections } from '../../state/connections';
import type { ConnectionSummary } from '@shared/types';

const NAME_MAX = 64;

/** Settings → Agent Access (X27 §12.1). Every change is asked of main, which owns the dialogs and the tokens. */
export function AgentAccessSection() {
  const state = useAgentAccessState();
  const { connections } = useConnections();
  const [busy, setBusy] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState('');

  if (!state) return <Text size="xs" c="dimmed">Loading…</Text>;

  // A cancelled dialog is not an error: the pushed state says what is now in force.
  const run = async (action: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      notify.error(getErrorMessage(err, failure));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (next: boolean) =>
    run(() => (next ? api.agentAccess.requestEnable() : api.agentAccess.disable()), 'Could not change Agent Access.');

  const trimmed = name.trim();
  const submitName = () =>
    run(async () => {
      await api.agentAccess.addToken({ name: trimmed });
      setName('');
      setAdding(false);
    }, 'Could not add the Agent.');

  const tokens = [...state.tokens].sort((a, b) => a.name.localeCompare(b.name));
  const shared = connections.filter((c) => c.shareWithAgents).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap="var(--atelier-gap-xs)" style={{ flex: 1 }}>
          <Text size="sm" fw={600}>{COPY.switchLabel}</Text>
          <Text size="xs" c="dimmed" id="agent-access-description">{COPY.intro}</Text>
        </Stack>
        <Switch
          aria-label={COPY.switchLabel}
          aria-describedby="agent-access-description"
          checked={state.enabled}
          disabled={busy}
          onChange={(e) => void toggle(e.currentTarget.checked)}
        />
      </Group>

      {state.platformCaveat === 'windows-pipe' && (
        <Text size="xs" c="dimmed" data-testid="agent-windows-caveat">{COPY.windowsCaveat}</Text>
      )}

      {state.enabled && (
        <Stack gap="xs" data-testid="agent-access-on">
          <Text size="sm" fw={600}>{COPY.connectable}</Text>
          {state.socketPath && (
            <Group gap="xs" wrap="nowrap">
              <Text size="xs" c="dimmed">Socket</Text>
              <Code style={{ userSelect: 'text', wordBreak: 'break-all' }}>{state.socketPath}</Code>
            </Group>
          )}
          <Text size="xs" c="dimmed">{readCountText(state.sessionReadCount)}</Text>
        </Stack>
      )}

      <SharedConnections shared={shared} enabled={state.enabled} />

      <ClaudeCodeSetup command={state.claudeCodeCommand} />

      {state.enabled && shared.length > 0 && tokens.length === 0 && (
        <Text size="xs" fw={600} data-testid="agent-next-step">{COPY.nextStepAddAgent}</Text>
      )}

      <Stack gap="xs">
        <Text size="xs" fw={600}>{COPY.canTitle}</Text>
        <List size="xs" c="dimmed">{COPY.can.map((t) => <List.Item key={t}>{t}</List.Item>)}</List>
        <Text size="xs" fw={600}>{COPY.cannotTitle}</Text>
        <List size="xs" c="dimmed">{COPY.cannot.map((t) => <List.Item key={t}>{t}</List.Item>)}</List>
        <Text size="xs" c="dimmed">{COPY.readOnlyAdvice}</Text>
      </Stack>

      <Stack gap="xs">
        <Group justify="space-between">
          <Text size="sm" fw={600}>Agents</Text>
          {!adding && (
            <Button variant="default" size="compact-xs" disabled={busy} onClick={() => setAdding(true)}>
              {COPY.addAgent}
            </Button>
          )}
        </Group>
        {adding && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (trimmed) void submitName();
            }}
          >
            <Group gap="xs" align="flex-end" wrap="nowrap">
              <TextInput
                size="xs"
                label={COPY.agentNameLabel}
                value={name}
                maxLength={NAME_MAX}
                data-autofocus
                onChange={(e) => setName(e.currentTarget.value)}
                style={{ flex: 1 }}
              />
              <Button type="submit" size="compact-sm" disabled={busy || !trimmed}>{COPY.addConfirm}</Button>
              <Button
                type="button"
                variant="subtle"
                size="compact-sm"
                disabled={busy}
                onClick={() => {
                  setAdding(false);
                  setName('');
                }}
              >
                Cancel
              </Button>
            </Group>
          </form>
        )}
        {tokens.length === 0 ? (
          <Text size="xs" c="dimmed">{COPY.noTokens}</Text>
        ) : (
          <Table withRowBorders={false} aria-label="Agents">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Created</Table.Th>
                <Table.Th>Last used</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {tokens.map((t) => (
                <Table.Tr key={t.id}>
                  <Table.Td>{t.name}</Table.Td>
                  <Table.Td>{relativeTime(t.createdAt, '—')}</Table.Td>
                  <Table.Td>{t.lastUsedAt ? relativeTime(t.lastUsedAt, '—') : 'Never'}</Table.Td>
                  <Table.Td>
                    <Group gap="xs" justify="flex-end" wrap="nowrap">
                      <Button
                        variant="default"
                        size="compact-xs"
                        disabled={busy}
                        aria-label={`Regenerate ${t.name}`}
                        onClick={() => void run(() => api.agentAccess.regenerateToken({ id: t.id }), 'Could not regenerate the token.')}
                      >
                        Regenerate
                      </Button>
                      <Button
                        variant="default"
                        size="compact-xs"
                        color="red"
                        disabled={busy}
                        aria-label={`Revoke ${t.name}`}
                        onClick={() => void run(() => api.agentAccess.revokeToken({ id: t.id }), 'Could not revoke the token.')}
                      >
                        Revoke
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
        <Text size="xs" c="dimmed">{COPY.tokenHint}</Text>
      </Stack>

      {!state.enabled && state.bridgeInstalled && (
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap="var(--atelier-gap-xs)" style={{ flex: 1 }}>
            <Text size="sm" fw={600}>{COPY.removeBridge}</Text>
            <Text size="xs" c="dimmed">{COPY.removeBridgeHint}</Text>
          </Stack>
          <Button
            variant="default"
            size="compact-xs"
            disabled={busy}
            onClick={() => void run(() => api.agentAccess.removeBridge(), 'Could not remove the bridge.')}
          >
            {COPY.removeBridge}
          </Button>
        </Group>
      )}
    </>
  );
}

/** Every Connection an Agent could reach, in one place, so what is exposed is never a hunt through menus (X27 §12.1). */
function SharedConnections({ shared, enabled }: { shared: ConnectionSummary[]; enabled: boolean }) {
  return (
    <Stack gap="xs" data-testid="agent-shared-connections">
      <Text size="sm" fw={600}>{COPY.sharedTitle}</Text>
      {shared.length === 0 ? (
        <Text size="xs" c="dimmed">{COPY.noneShared}</Text>
      ) : (
        <>
          {!enabled && <Text size="xs" c="dimmed">{COPY.sharedWhileOff}</Text>}
          <Table withRowBorders={false} aria-label={COPY.sharedTitle}>
            <Table.Tbody>
              {shared.map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td>{c.name}</Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">{c.status === 'connected' ? COPY.open : COPY.notOpen}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Group justify="flex-end" wrap="nowrap">
                      <Button
                        variant="default"
                        size="compact-xs"
                        aria-label={`${COPY.stopShort}: ${c.name}`}
                        onClick={() => void stopSharingWithAgents(c.id)}
                      >
                        {COPY.stopShort}
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </>
      )}
    </Stack>
  );
}

/** The Claude Code CLI path, step by step (X27 §12.1). The command shown holds a placeholder; the real one, with the token, is copied from main's token window only. */
function ClaudeCodeSetup({ command }: { command: string }) {
  const [turnOn, addAgent, paste, check, ask] = COPY.claudeCodeSteps;
  const code = { userSelect: 'text', wordBreak: 'break-all', whiteSpace: 'pre-wrap' } as const;
  return (
    <Stack gap="xs" data-testid="agent-claude-code-setup">
      <Text size="sm" fw={600}>{COPY.claudeCodeTitle}</Text>
      <List type="ordered" size="xs" spacing={6}>
        <List.Item>{turnOn}</List.Item>
        <List.Item>{addAgent}</List.Item>
        <List.Item>
          <Stack gap="var(--atelier-gap-xs)">
            <Text size="xs">{paste}</Text>
            {command && <Code block style={code} data-testid="agent-claude-code-command">{command}</Code>}
            <Text size="xs" c="dimmed">{COPY.claudeCodeScope}</Text>
          </Stack>
        </List.Item>
        <List.Item>
          <Stack gap="var(--atelier-gap-xs)">
            <Code block style={code}>{COPY.claudeCodeCheck}</Code>
            <Text size="xs">{check}</Text>
          </Stack>
        </List.Item>
        <List.Item>{ask}</List.Item>
      </List>
      <Text size="xs" c="dimmed">{COPY.claudeCodeRemove}</Text>
    </Stack>
  );
}
