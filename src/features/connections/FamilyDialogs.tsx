import React from 'react';
import { Button, Checkbox, Group, List, Modal, NativeSelect, Stack, Text, TextInput } from '@mantine/core';
import type { ConnectionFamily, ConnectionSummary } from '@shared/types';
import { api, getErrorMessage } from '../../api/atelier';
import { SubmitButton } from '../../components/SubmitButton';
import { useDialogFocusReturn } from '../../hooks/useDialogFocusReturn';
import { NEW_FAMILY, plural } from './familyCopy';
import { logFailure } from '../../utils/rendererLog';

/**
 * Add Connections to a Family: an existing one, or a new one made from the
 * Connections. A Connection already in another Family moves, which is a leave
 * then a join; the checkbox decides whether it keeps the old Family's shared
 * settings as local ones.
 */
export function AddToFamilyDialog({ connections, families, onCancel, onDone }: {
  connections: ConnectionSummary[];
  families: ConnectionFamily[];
  onCancel: () => void;
  onDone: (family: ConnectionFamily) => void;
}) {
  const close = useDialogFocusReturn(onCancel);
  const [choice, setChoice] = React.useState<string>(families[0]?.id ?? NEW_FAMILY);
  const [name, setName] = React.useState('');
  const [keepAsLocal, setKeepAsLocal] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const creating = choice === NEW_FAMILY;
  const moving = connections.filter((c) => c.familyId && c.familyId !== choice);
  const ids = connections.map((c) => c.id);

  const submit = async () => {
    if (submitting) return;
    if (creating && name.trim() === '') {
      setError('Give the family a name.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      let familyId = choice;
      let createdId: string | null = null;
      if (creating) {
        createdId = (await api.families.create({ name: name.trim() })).id;
        familyId = createdId;
      }
      let all: ConnectionFamily[];
      try {
        all = await api.families.setMembership({
          connectionIds: ids,
          familyId,
          keepAsLocal: moving.length > 0 ? keepAsLocal : undefined,
        });
      } catch (e) {
        // Two calls make one action: a family just made for this must not outlive its failure, or a retry meets its own name.
        if (createdId !== null) {
          await api.families.delete({ id: createdId, keepAsLocal: false }).catch((err: unknown) => logFailure('removing the family just created', err));
        }
        throw e;
      }
      const target = all.find((f) => f.id === familyId);
      if (target) onDone(target);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not add to the family'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      opened
      onClose={close}
      title={connections.length === 1 ? `Add "${connections[0]!.name}" to a family` : `Add ${connections.length} connections to a family`}
      centered
      size="md"
    >
      <Stack gap="md">
        <Text size="xs" c="dimmed" lh={1.5}>
          Members of a family share reference rules and row summaries by database and collection name.
          A connection belongs to one family at a time.
        </Text>
        <NativeSelect
          label="Family"
          size="xs"
          value={choice}
          onChange={(e) => setChoice(e.currentTarget.value)}
          data={[
            ...families.map((f) => ({ value: f.id, label: f.name })),
            { value: NEW_FAMILY, label: 'New family…' },
          ]}
        />
        {creating && (
          <TextInput
            label="New family name"
            aria-label="New family name"
            size="xs"
            data-autofocus
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
          />
        )}
        {moving.length > 0 && (
          <Checkbox
            size="xs"
            checked={keepAsLocal}
            onChange={(e) => setKeepAsLocal(e.currentTarget.checked)}
            label={`Keep the old family's settings on ${moving.length === 1 ? 'this connection' : `these ${moving.length} connections`}`}
          />
        )}
        {error && (
          <Text size="xs" c="red" role="alert">
            {error}
          </Text>
        )}
        <Group justify="flex-end" gap="xs">
          <Button size="compact-xs" variant="subtle" onClick={close}>
            Cancel
          </Button>
          <SubmitButton size="compact-xs" variant="filled" submitting={submitting} onClick={() => void submit()}>
            {creating ? 'Create family' : 'Add'}
          </SubmitButton>
        </Group>
      </Stack>
    </Modal>
  );
}

/**
 * Leave a Family. With the box ticked, every shared setting the Connection has
 * no Override for is copied onto it as a local one, so what it shows does not
 * change; unticked, it keeps only its own.
 */
export function LeaveFamilyDialog({ connections, onCancel, onDone }: {
  connections: ConnectionSummary[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const close = useDialogFocusReturn(onCancel);
  const [keepAsLocal, setKeepAsLocal] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const single = connections.length === 1;

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.families.setMembership({
        connectionIds: connections.map((c) => c.id),
        familyId: null,
        keepAsLocal,
      });
      onDone();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not leave the family'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      opened
      onClose={close}
      title={single ? `Leave "${connections[0]!.familyName ?? 'family'}"?` : `Leave the family on ${connections.length} connections?`}
      centered
      size="md"
    >
      <Stack gap="md">
        <Text size="xs" c="dimmed" lh={1.5}>
          {single
            ? `"${connections[0]!.name}" stops sharing settings with the family.`
            : `${connections.length} connections stop sharing settings with their families.`}{' '}
          Mongo data is not touched.
        </Text>
        <Checkbox
          size="xs"
          data-autofocus
          checked={keepAsLocal}
          onChange={(e) => setKeepAsLocal(e.currentTarget.checked)}
          label={`Keep the family's settings on ${single ? 'this connection' : 'these connections'}`}
        />
        {error && (
          <Text size="xs" c="red" role="alert">
            {error}
          </Text>
        )}
        <Group justify="flex-end" gap="xs">
          <Button size="compact-xs" variant="subtle" onClick={close}>
            Cancel
          </Button>
          <SubmitButton size="compact-xs" variant="filled" submitting={submitting} onClick={() => void submit()}>
            Leave family
          </SubmitButton>
        </Group>
      </Stack>
    </Modal>
  );
}

/**
 * Delete a Family (ADR 0013: type-to-confirm, since the shared settings go for
 * good). With the box ticked, every member first gets a local copy of each
 * shared setting it does not override.
 */
export function FamilyDeleteDialog({ family, memberNames, onCancel, onDeleted }: {
  family: ConnectionFamily;
  memberNames: string[];
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const close = useDialogFocusReturn(onCancel);
  const [typed, setTyped] = React.useState('');
  const [keepAsLocal, setKeepAsLocal] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const matches = typed === family.name;

  const submit = async () => {
    if (!matches || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.families.delete({ id: family.id, keepAsLocal });
      onDeleted();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not delete the family'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal opened onClose={close} title={`Delete family "${family.name}"?`} centered size="md" role="alertdialog">
      <Stack gap="md">
        <Text size="xs" c="dimmed" lh={1.5}>
          This removes the family and the reference rules and row summaries it shares. Connections and Mongo
          data are not touched. This cannot be undone.
        </Text>
        {memberNames.length > 0 ? (
          <div>
            <Text size="xs" c="dimmed">
              {plural(memberNames.length, 'member')} will be left with no family:
            </Text>
            <List size="xs" withPadding>
              {memberNames.map((n) => (
                <List.Item key={n}>{n}</List.Item>
              ))}
            </List>
          </div>
        ) : (
          <Text size="xs" c="dimmed">
            The family has no members.
          </Text>
        )}
        {memberNames.length > 0 && (
          <Checkbox
            size="xs"
            checked={keepAsLocal}
            onChange={(e) => setKeepAsLocal(e.currentTarget.checked)}
            label="Keep the shared settings on every member as local settings"
          />
        )}
        <Stack gap="var(--atelier-gap-xs)">
          <Text size="xs" c="dimmed">
            Type <b>{family.name}</b> to confirm:
          </Text>
          <TextInput
            aria-label="Confirm family name"
            data-autofocus
            size="xs"
            value={typed}
            onChange={(e) => setTyped(e.currentTarget.value)}
            styles={{
              input: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' },
            }}
          />
        </Stack>
        {error && (
          <Text size="xs" c="red" role="alert">
            {error}
          </Text>
        )}
        <Group justify="flex-end" gap="xs">
          <Button size="compact-xs" variant="subtle" onClick={close}>
            Cancel
          </Button>
          <SubmitButton
            size="compact-xs"
            variant="filled"
            color="red"
            submitting={submitting}
            disabled={!matches}
            onClick={() => void submit()}
          >
            Delete family
          </SubmitButton>
        </Group>
      </Stack>
    </Modal>
  );
}
