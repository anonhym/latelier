import React from 'react';
import { Alert, Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { api, getErrorMessage } from '../../api/atelier';
import { useDialogFocusReturn } from '../../hooks/useDialogFocusReturn';
import { SubmitButton } from '../../components/SubmitButton';
import { buildIdFilter } from './views/docId';

interface DeleteConfirmProps {
  connectionId: string;
  dbName: string;
  collection: string;
  docs: unknown[];
  filter?: string;
  /** Disables the confirm button outright rather than letting the
   * user complete the confirmation flow only to hit a server-side rejection. */
  readOnly?: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * Result of the `doc.confirmDeleteMany` count-before-commit fetch (see
 * below). `pending` is both "not started" (single-doc path never leaves it)
 * and "in flight" (multi-doc path, before the promise settles) — collapsing
 * those avoids a synchronous `setState` inside the effect body.
 */
type CountState =
  | { status: 'pending' }
  | { status: 'ready'; count: number; confirmToken: string }
  | { status: 'error'; message: string };

export function DeleteConfirm({
  connectionId,
  dbName,
  collection,
  docs,
  filter,
  readOnly = false,
  onClose,
  onDeleted,
}: DeleteConfirmProps) {
  // Dismiss paths only — `submit`'s own `onClose()` below stays raw, because a
  // completed delete hands off to the refreshed grid.
  const close = useDialogFocusReturn(onClose);
  const [confirm, setConfirm] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [countState, setCountState] = React.useState<CountState>({ status: 'pending' });

  const isMulti = docs.length > 1 || !!filter;
  const matchesCollectionName = confirm === collection;
  // The filter this delete is scoped to — same string for the count fetch
  // and the eventual `deleteMany` so the token (bound server-side to this
  // exact filter) is never sent alongside a different filter than the one
  // it was minted for.
  const matchFilterJson = filter ?? '{}';

  // Count-before-commit (): fetch the real match count + a
  // confirmToken as soon as the modal opens for a multi-doc delete, instead
  // of on click. Reused directly by `handleDelete` below — no second
  // `confirmDeleteMany` round trip when the user actually confirms.
  //
  // `ignore` guards against React StrictMode's dev-mode double-invocation
  // (two effect runs, two in-flight promises racing) and against
  // setState-after-unmount if the modal closes before the fetch resolves.
  // Keying the effect on `matchFilterJson` (not just mount) means a
  // superseded filter's response is also dropped — though in practice this
  // component is always remounted with a fresh `key` rather than patched in
  // place, so this only matters as a defensive guarantee.
  React.useEffect(() => {
    if (!isMulti) return;
    let ignore = false;
    (async () => {
      try {
        const { count, confirmToken } = await api.doc.confirmDeleteMany({
          connectionId,
          dbName,
          collection,
          filterJson: matchFilterJson,
        });
        if (!ignore) setCountState({ status: 'ready', count, confirmToken });
      } catch (e) {
        if (!ignore) {
          setCountState({
            status: 'error',
            message: getErrorMessage(e, 'Could not count matching documents'),
          });
        }
      }
    })();
    return () => {
      ignore = true;
    };
  }, [isMulti, connectionId, dbName, collection, matchFilterJson]);

  const handleDelete = async () => {
    if (loading) return; // #91 — see SubmitButton.tsx
    setLoading(true);
    setErr(null);
    try {
      if (!isMulti && docs[0] !== undefined) {
        const doc = docs[0];
        // `buildIdFilter` is the same helper Workspace.tsx's `updateField` and
        // EditDrawer's `handleSave` use — it returns null when the document
        // has no `_id` (e.g. a find with `{_id: 0}` projection), which this
        // path must refuse rather than fall through to `{}` and delete an
        // ARBITRARY document (N0.1).
        const filterJson = buildIdFilter(doc);
        if (filterJson === null) {
          setErr('Cannot delete a document without an _id');
          return;
        }
        await api.doc.deleteOne({ connectionId, dbName, collection, filterJson });
      } else {
        if (countState.status !== 'ready') return;
        await api.doc.deleteMany({
          connectionId,
          dbName,
          collection,
          filterJson: matchFilterJson,
          confirmToken: countState.confirmToken,
        });
      }
      onDeleted();
      onClose();
    } catch (e) {
      setErr(getErrorMessage(e, 'Delete failed'));
    } finally {
      setLoading(false);
    }
  };

  const isCounting = isMulti && countState.status === 'pending';
  const countErr = countState.status === 'error' ? countState.message : null;

  const title = isMulti
    ? countState.status === 'ready'
      ? `Delete ${countState.count.toLocaleString()} matching document${countState.count === 1 ? '' : 's'}?`
      : 'Delete matching documents?'
    : 'Delete document?';

  const deleteDisabled =
    readOnly ||
    (isMulti &&
      (!matchesCollectionName ||
        countState.status !== 'ready' ||
        countState.count === 0));

  return (
    <Modal opened onClose={close} title={title} centered size="md">
      <Stack gap="sm">
        <Text size="xs" c="dimmed">
          This cannot be undone.
        </Text>

        {readOnly && (
          <Alert color="yellow" variant="light" role="alert">
            This connection is read-only. Deleting is disabled.
          </Alert>
        )}

        {isCounting && (
          <Text size="xs" c="dimmed">
            Counting matching documents…
          </Text>
        )}

        {isMulti && (
          <Stack gap={6}>
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

        {(err ?? countErr) && (
          <Alert color="red" variant="light" role="alert">
            {err ?? countErr}
          </Alert>
        )}

        <Group justify="flex-end" gap="xs">
          <Button variant="subtle" size="compact-xs" onClick={close}>
            Cancel
          </Button>
          <SubmitButton
            variant="filled"
            color="red"
            size="compact-xs"
            onClick={() => void handleDelete()}
            disabled={deleteDisabled}
            submitting={loading}
          >
            {loading ? 'Deleting…' : 'Delete'}
          </SubmitButton>
        </Group>
      </Stack>
    </Modal>
  );
}
