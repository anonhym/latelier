import React from 'react';
import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconX } from '@tabler/icons-react';
import type { SettingOwner } from '@shared/types';
import { api, getErrorMessage } from '../../api/atelier';
import { SubmitButton } from '../../components/SubmitButton';
import { useDialogFocusReturn } from '../../hooks/useDialogFocusReturn';
import { themeVars } from '../../theme/themeVars';
import { useConnectionFamily } from '../connections/useConnectionFamily';
import { FieldAutocompleteInput } from '../fieldSuggestions/FieldAutocompleteInput';
import type { SuggestionContext } from '../fieldSuggestions/types';
import { ROW_SUMMARY_MAX_FIELDS, moveField, rowSummaryProblem } from './rowSummaryDraft';
import { notifyRowSummaryChanged, useRowSummary } from './useRowSummary';

interface RowSummaryPickerProps {
  connectionId: string;
  dbName: string;
  collection: string;
  onClose: () => void;
}

/**
 * Choose the fields a collapsed Tree row shows beside its `_id`: up to four,
 * in the order given, picked from the Collection's sampled field paths. It
 * hides no column and changes no projection. Clearing it brings back the
 * Fields list's first fields.
 *
 * On a Connection in a Family a new summary is shared with the family by
 * default, with "This connection only" beside Save; a Connection's own summary
 * is saved on that Connection.
 */
export function RowSummaryPicker({ connectionId, dbName, collection, onClose }: RowSummaryPickerProps) {
  const T = themeVars;
  const close = useDialogFocusReturn(onClose);
  const { summary, loaded } = useRowSummary(connectionId, dbName, collection);
  const family = useConnectionFamily(connectionId);
  const [fields, setFields] = React.useState<string[] | null>(null);
  const [typed, setTyped] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // The draft starts from what is saved, once that has been read.
  const draft = fields ?? summary?.fields ?? [];
  const edit = (next: string[]) => setFields(next);

  const context = React.useMemo<SuggestionContext>(
    () => ({ connectionId, dbName, collection }),
    [connectionId, dbName, collection],
  );

  const addTyped = () => {
    const field = typed.trim();
    if (field === '') return;
    if (draft.length >= ROW_SUMMARY_MAX_FIELDS) {
      setError(`A row summary takes at most ${ROW_SUMMARY_MAX_FIELDS} fields.`);
      return;
    }
    if (field === '_id' || draft.includes(field)) {
      setError(field === '_id' ? 'The row already shows _id.' : `${field} is already listed.`);
      return;
    }
    setError(null);
    edit([...draft, field]);
    setTyped('');
  };

  const problem = rowSummaryProblem(draft);
  const unchanged = summary !== null && JSON.stringify(draft) === JSON.stringify(summary.fields);
  // A setting that came from the Family is saved for the whole family unless asked otherwise;
  // one the Connection owns is saved on the Connection.
  const sharedByDefault = family !== null && (summary === null || summary.origin === 'shared');

  const run = async (work: () => Promise<unknown>, failure: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
      notifyRowSummaryChanged();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, failure));
    } finally {
      setBusy(false);
    }
  };

  const save = (owner: SettingOwner) =>
    run(() => api.rowSummary.set({ owner, dbName, collection, fields: draft }), 'Could not save the row summary');

  const clearLabel =
    summary?.origin === 'shared' ? 'Clear for the whole family' : summary?.origin === 'override' ? 'Reset to shared' : 'Clear';

  return (
    <Modal opened onClose={close} title="Row summary" centered size={480}>
      <Stack gap="md">
        <Text size="xs" c="dimmed">
          {dbName}.{collection}
        </Text>
        <Text size="xs" c="dimmed" lh={1.5}>
          The fields a collapsed row shows in the Tree view, up to {ROW_SUMMARY_MAX_FIELDS}. It hides no column and
          changes no query. With none chosen, the row shows the first fields of the Fields list.
        </Text>

        {!loaded ? (
          <Text size="xs" c="dimmed">Loading…</Text>
        ) : draft.length === 0 ? (
          <Text size="xs" c="dimmed" fs="italic">No fields chosen.</Text>
        ) : (
          <ol aria-label="Row summary fields" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {draft.map((field, i) => (
              <li
                key={field}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: T.gapXs,
                  padding: '4px 0',
                  borderBottom: `1px solid ${T.border}`,
                }}
              >
                <span style={{ flex: 1, fontFamily: 'monospace', fontSize: T.fsSm, color: T.text }}>{field}</span>
                <button
                  type="button"
                  aria-label={`Move ${field} up`}
                  disabled={i === 0}
                  onClick={() => edit(moveField(draft, i, -1))}
                  style={iconButton}
                >
                  <IconArrowUp size={13} />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${field} down`}
                  disabled={i === draft.length - 1}
                  onClick={() => edit(moveField(draft, i, 1))}
                  style={iconButton}
                >
                  <IconArrowDown size={13} />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${field}`}
                  onClick={() => edit(draft.filter((f) => f !== field))}
                  style={iconButton}
                >
                  <IconX size={13} />
                </button>
              </li>
            ))}
          </ol>
        )}

        <Group gap="xs" wrap="nowrap" align="flex-end">
          <div style={{ flex: 1 }}>
            <FieldAutocompleteInput
              value={typed}
              onChange={setTyped}
              context={context}
              placeholder="Add a field, e.g. customer.name"
              ariaLabel="Field to add"
              disabled={draft.length >= ROW_SUMMARY_MAX_FIELDS}
              onKeyDown={(e) => {
                // The suggestion list takes Enter for a highlighted suggestion; a bare Enter adds the typed field.
                if (e.key === 'Enter' && !e.defaultPrevented && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  addTyped();
                }
              }}
              style={{
                width: '100%',
                padding: '6px 10px',
                border: `1px solid ${T.border}`,
                borderRadius: T.rs,
                background: T.surfaceRaised,
                color: T.text,
                fontSize: T.fsSm,
                fontFamily: 'monospace',
              }}
            />
          </div>
          <Button
            size="compact-xs"
            variant="default"
            onClick={addTyped}
            disabled={typed.trim() === '' || draft.length >= ROW_SUMMARY_MAX_FIELDS}
          >
            Add
          </Button>
        </Group>

        {error && (
          <Text size="xs" c="red" role="alert">
            {error}
          </Text>
        )}

        <Group justify="space-between" gap="xs">
          {summary ? (
            <SubmitButton
              size="compact-xs"
              variant="subtle"
              color="red"
              submitting={busy}
              onClick={() =>
                void run(
                  () => api.rowSummary.clear({ owner: summary.owner, dbName, collection }),
                  'Could not clear the row summary',
                )
              }
            >
              {clearLabel}
            </SubmitButton>
          ) : (
            <span />
          )}
          <Group gap="xs">
            <Button size="compact-xs" variant="subtle" onClick={close}>
              Cancel
            </Button>
            {sharedByDefault && (
              <SubmitButton
                size="compact-xs"
                variant="default"
                submitting={busy}
                disabled={problem !== null}
                onClick={() => void save({ connectionId })}
              >
                This connection only
              </SubmitButton>
            )}
            <SubmitButton
              size="compact-xs"
              variant="filled"
              submitting={busy}
              disabled={problem !== null || unchanged}
              title={problem ?? undefined}
              onClick={() => void save(sharedByDefault && family ? { familyId: family.id } : { connectionId })}
            >
              {sharedByDefault ? 'Save for the family' : 'Save'}
            </SubmitButton>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

const iconButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  background: 'transparent',
  color: 'var(--atelier-text-muted)',
  cursor: 'pointer',
  padding: 2,
};
