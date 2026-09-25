import React from 'react';
import { Alert, Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { themeVars } from '../../theme/themeVars';
import { api, getErrorMessage } from '../../api/atelier';
import { useDialogFocusReturn } from '../../hooks/useDialogFocusReturn';
import { SubmitButton } from '../../components/SubmitButton';
import { isValidEjson } from '../../utils/ejson';
import { useShellSyntaxField } from './useShellSyntaxField';
import { notify } from '../../theme/notifications';

interface UpdateConfirmProps {
  connectionId: string;
  dbName: string;
  collection: string;
  /** Canonical EJSON — the tab's current query filter, always present when
   *  this dialog is open (`useDocumentDialogs.openUpdateAllModal` refuses to
   *  open it otherwise, same guard as delete-all). */
  filter: string;
  readOnly?: boolean;
  onClose: () => void;
  onUpdated: () => void;
}

/**
 * What `doc:confirmUpdateMany` handed back for the update body currently
 * shown in the editor. Cleared on any edit — the token is bound to the exact
 * text it counted against (ADR 0013: the count and the confirm gate must
 * describe the action that will actually run, not a stale draft).
 */
type Reviewed = { count: number; confirmToken: string; updateJson: string };

/**
 * "Update all matching…" (W08/#143) — same two-step confirm-token pattern as
 * `DeleteConfirm`'s multi-doc path, plus one step `DeleteConfirm` doesn't
 * need: the update body is free text the user is still editing, so the count
 * can't be fetched on mount the way delete's fixed filter is. An explicit
 * Review step commits the buffer, sends it to `confirmUpdateMany`, and only
 * then unlocks the type-the-collection-name gate — editing the buffer after
 * Review clears it, so a stale token can never authorize a different update.
 */
export function UpdateConfirm({
  connectionId,
  dbName,
  collection,
  filter,
  readOnly = false,
  onClose,
  onUpdated,
}: UpdateConfirmProps) {
  const T = themeVars;
  const close = useDialogFocusReturn(onClose);

  const [buffer, setBuffer] = React.useState('{ "$set": {  } }');
  const [confirm, setConfirm] = React.useState('');
  const [reviewing, setReviewing] = React.useState(false);
  const [reviewed, setReviewed] = React.useState<Reviewed | null>(null);
  const [running, setRunning] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  // Write surfaces stay strict (ADR 0004) — Shell Syntax reaches this editor
  // the same way it reaches EditDrawer, repaired on blur so what Review sends
  // is exactly what's on screen.
  const shell = useShellSyntaxField({
    value: buffer,
    commit: (next) => {
      setBuffer(next);
      setReviewed(null);
    },
  });
  const canonical = shell.outcome.kind === 'repaired' ? shell.outcome.text : buffer;
  const isValid = isValidEjson(canonical);
  const refusal = shell.liveRefusal;

  const handleChange = (next: string) => {
    setBuffer(next);
    setReviewed(null);
    setErr(null);
  };

  const handleReview = async () => {
    if (reviewing) return;
    const submitted = shell.commitNow().text;
    if (!isValidEjson(submitted)) {
      setErr('Invalid EJSON');
      return;
    }
    setReviewing(true);
    setErr(null);
    try {
      const { count, confirmToken } = await api.doc.confirmUpdateMany({
        connectionId,
        dbName,
        collection,
        filterJson: filter,
        updateJson: submitted,
      });
      setReviewed({ count, confirmToken, updateJson: submitted });
    } catch (e) {
      setErr(getErrorMessage(e, 'Could not review this update'));
    } finally {
      setReviewing(false);
    }
  };

  const handleUpdate = async () => {
    if (running || !reviewed) return;
    setRunning(true);
    setErr(null);
    try {
      const { matchedCount, modifiedCount } = await api.doc.updateMany({
        connectionId,
        dbName,
        collection,
        filterJson: filter,
        updateJson: reviewed.updateJson,
        confirmToken: reviewed.confirmToken,
      });
      notify.success(`${matchedCount.toLocaleString()} matched, ${modifiedCount.toLocaleString()} modified`);
      onUpdated();
      onClose();
    } catch (e) {
      setErr(getErrorMessage(e, 'Update failed'));
    } finally {
      setRunning(false);
    }
  };

  const matchesCollectionName = confirm === collection;
  const reviewDisabled = readOnly || reviewing || !isValid;
  const updateDisabled = readOnly || running || reviewed === null || !matchesCollectionName;

  return (
    <Modal opened onClose={close} title="Update all matching documents" centered size="md">
      <Stack gap="sm">
        <Text size="xs" c="dimmed">
          This cannot be undone.
        </Text>

        {readOnly && (
          <Alert color="yellow" variant="light" role="alert">
            This connection is read-only. Updating is disabled.
          </Alert>
        )}

        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            Filter
          </Text>
          <Text
            size="xs"
            style={{ fontFamily: 'monospace', wordBreak: 'break-all', color: T.text }}
          >
            {filter}
          </Text>
        </Stack>

        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            Update ($set, $unset, $inc, …)
          </Text>
          <textarea
            aria-label="Update document"
            value={buffer}
            onChange={(e) => handleChange(e.target.value)}
            onBlur={() => shell.onBlur()}
            aria-invalid={!isValid}
            aria-describedby={refusal ? 'update-all-syntax-error' : undefined}
            spellCheck={false}
            rows={6}
            style={{
              fontFamily: 'monospace',
              fontSize: 12,
              padding: '8px 10px',
              border: `1px solid ${!isValid ? T.warn : T.border}`,
              borderRadius: T.rs,
              background: T.surfaceRaised,
              color: T.text,
              resize: 'vertical',
              outline: 'none',
              lineHeight: 1.5,
            }}
          />
          {refusal && (
            <div id="update-all-syntax-error" role="alert" style={{ fontSize: 11, color: T.warn }}>
              {refusal}
            </div>
          )}
        </Stack>

        {reviewed === null ? (
          <Group justify="flex-end">
            <SubmitButton
              variant="light"
              size="compact-xs"
              onClick={() => void handleReview()}
              disabled={reviewDisabled}
              submitting={reviewing}
            >
              {reviewing ? 'Counting…' : 'Review'}
            </SubmitButton>
          </Group>
        ) : (
          <Stack gap={6}>
            <Text size="xs" fw={600}>
              {reviewed.count.toLocaleString()} matching document{reviewed.count === 1 ? '' : 's'}
            </Text>
            <Text size="xs" c="dimmed">
              Type <strong>{collection}</strong> to confirm
            </Text>
            <TextInput
              value={confirm}
              onChange={(e) => setConfirm(e.currentTarget.value)}
              placeholder={collection}
              size="xs"
            />
          </Stack>
        )}

        {err && (
          <Alert color="red" variant="light" role="alert">
            {err}
          </Alert>
        )}

        <Group justify="flex-end" gap="xs">
          <Button variant="subtle" size="compact-xs" onClick={close}>
            Cancel
          </Button>
          {reviewed !== null && (
            <SubmitButton
              variant="filled"
              color="red"
              size="compact-xs"
              onClick={() => void handleUpdate()}
              disabled={updateDisabled}
              submitting={running}
            >
              {running ? 'Updating…' : 'Update'}
            </SubmitButton>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
