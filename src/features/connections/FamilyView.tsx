import React from 'react';
import { Button, Group, List, Modal, Stack, Text, TextInput } from '@mantine/core';
import type {
  ConnectionFamily,
  ConnectionSummary,
  FamilyOverrides,
  FamilySettings,
} from '@shared/types';
import { api, getErrorMessage } from '../../api/atelier';
import { SubmitButton } from '../../components/SubmitButton';
import { useDialogFocusReturn } from '../../hooks/useDialogFocusReturn';
import { themeVars } from '../../theme/themeVars';
import { FamilyDeleteDialog } from './FamilyDialogs';

export interface FamilyViewProps {
  family: ConnectionFamily;
  /** Every Connection, to name the members and the Connections that override a setting. */
  connections: ConnectionSummary[];
  onClose: () => void;
  /** After a rename, so the parent can reload its list of families. */
  onRenamed: (family: ConnectionFamily) => void;
  /** After the family is deleted; the view is gone with it. */
  onDeleted: () => void;
  /** The Family Export actions. Absent, their buttons stay disabled. */
  onExport?: (family: ConnectionFamily) => void;
  onApplyExport?: (family: ConnectionFamily) => void;
}

/** Overriding members, named; ids that no longer resolve are dropped. */
function namesOf(ids: readonly string[] | undefined, connections: ConnectionSummary[]): string[] {
  if (!ids) return [];
  return ids
    .map((id) => connections.find((c) => c.id === id)?.name)
    .filter((n): n is string => n !== undefined)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * The Family view: what a family shares and who departs from it. Members, the
 * shared Reference Rules and Row Summaries each with the members that override
 * it, rename, and Delete family.
 */
export function FamilyView({
  family,
  connections,
  onClose,
  onRenamed,
  onDeleted,
  onExport,
  onApplyExport,
}: FamilyViewProps) {
  const T = themeVars;
  const close = useDialogFocusReturn(onClose);
  const [name, setName] = React.useState(family.name);
  const [renaming, setRenaming] = React.useState(false);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [settings, setSettings] = React.useState<FamilySettings | null>(null);
  const [overrides, setOverrides] = React.useState<FamilyOverrides | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    Promise.all([api.families.settings({ id: family.id }), api.families.overrides({ id: family.id })])
      .then(([s, o]) => {
        if (!live) return;
        setSettings(s);
        setOverrides(o);
      })
      .catch((e) => live && setLoadError(getErrorMessage(e, 'Could not load the family')));
    return () => {
      live = false;
    };
  }, [family.id]);

  const memberNames = namesOf(family.memberIds, connections);
  const trimmed = name.trim();
  const canRename = trimmed !== '' && trimmed !== family.name;

  const rename = async () => {
    if (!canRename || renaming) return;
    setRenaming(true);
    setNameError(null);
    try {
      const next = await api.families.rename({ id: family.id, name: trimmed });
      setName(next.name);
      onRenamed(next);
    } catch (e) {
      setNameError(getErrorMessage(e, 'Could not rename the family'));
    } finally {
      setRenaming(false);
    }
  };

  const ruleOverriders = (ruleId: string) =>
    namesOf(overrides?.rules.find((o) => o.ruleId === ruleId)?.connectionIds, connections);
  const summaryOverriders = (summaryId: string) =>
    namesOf(overrides?.rowSummaries.find((o) => o.summaryId === summaryId)?.connectionIds, connections);

  const heading = { fontSize: T.fsXs, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' } as const;
  const overriddenNote = (names: string[]) =>
    names.length > 0 ? (
      <Text span size="xs" c="dimmed">
        {' '}
        · overridden on {names.join(', ')}
      </Text>
    ) : null;

  return (
    <Modal
      opened
      onClose={close}
      title={`Family: ${family.name}`}
      centered
      size="lg"
      // Mantine closes every open modal on a window-level Escape, so the delete dialog stacked on this one would take it down too.
      closeOnEscape={!deleting}
    >
      <Stack gap="md">
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <TextInput
            label="Name"
            aria-label="Family name"
            size="xs"
            style={{ flex: 1 }}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void rename();
              }
            }}
          />
          <SubmitButton size="compact-xs" variant="light" submitting={renaming} disabled={!canRename} onClick={() => void rename()}>
            Rename
          </SubmitButton>
        </Group>
        {nameError && (
          <Text size="xs" c="red" role="alert">
            {nameError}
          </Text>
        )}

        <div>
          <div style={heading}>Members</div>
          {memberNames.length === 0 ? (
            <Text size="xs" c="dimmed" fs="italic">
              No members yet. Add connections from the table.
            </Text>
          ) : (
            <List size="xs" withPadding aria-label="Members">
              {memberNames.map((n) => (
                <List.Item key={n}>{n}</List.Item>
              ))}
            </List>
          )}
        </div>

        {loadError && (
          <Text size="xs" c="red" role="alert">
            {loadError}
          </Text>
        )}

        <div>
          <div style={heading}>Shared reference rules</div>
          {settings === null ? (
            <Text size="xs" c="dimmed">Loading…</Text>
          ) : settings.rules.length === 0 ? (
            <Text size="xs" c="dimmed" fs="italic">None. A rule saved from a member&apos;s editor is shared by default.</Text>
          ) : (
            <List size="xs" withPadding aria-label="Shared reference rules">
              {settings.rules.map((r) => (
                <List.Item key={r.id}>
                  <Text span size="xs" ff="monospace">
                    {r.sourceDb}.{r.sourceCollection}.{r.sourceField}
                  </Text>
                  <Text span size="xs" c="dimmed">
                    {' '}
                    → {r.targetCollection}.{r.targetField}
                  </Text>
                  {overriddenNote(ruleOverriders(r.id))}
                </List.Item>
              ))}
            </List>
          )}
        </div>

        <div>
          <div style={heading}>Shared row summaries</div>
          {settings === null ? (
            <Text size="xs" c="dimmed">Loading…</Text>
          ) : settings.rowSummaries.length === 0 ? (
            <Text size="xs" c="dimmed" fs="italic">None. Choose one from a collection&apos;s Tree view.</Text>
          ) : (
            <List size="xs" withPadding aria-label="Shared row summaries">
              {settings.rowSummaries.map((s) => (
                <List.Item key={s.id}>
                  <Text span size="xs" ff="monospace">
                    {s.dbName}.{s.collection}
                  </Text>
                  <Text span size="xs" c="dimmed">
                    {' '}
                    → {s.fields.join(', ')}
                  </Text>
                  {overriddenNote(summaryOverriders(s.id))}
                </List.Item>
              ))}
            </List>
          )}
        </div>

        <Group justify="space-between" gap="xs">
          <Group gap="xs">
            <Button
              size="compact-xs"
              variant="default"
              disabled={!onExport}
              title={onExport ? undefined : 'Writing a family export arrives with Family Export'}
              onClick={() => onExport?.(family)}
            >
              Export…
            </Button>
            <Button
              size="compact-xs"
              variant="default"
              disabled={!onApplyExport}
              title={onApplyExport ? undefined : 'Applying a family export arrives with Family Export'}
              onClick={() => onApplyExport?.(family)}
            >
              Apply a family export…
            </Button>
          </Group>
          <Button size="compact-xs" variant="light" color="red" onClick={() => setDeleting(true)}>
            Delete family…
          </Button>
        </Group>
      </Stack>
      {deleting && (
        <FamilyDeleteDialog
          family={family}
          memberNames={memberNames}
          onCancel={() => setDeleting(false)}
          onDeleted={() => {
            setDeleting(false);
            onDeleted();
          }}
        />
      )}
    </Modal>
  );
}
