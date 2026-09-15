import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useDialogFocusReturn } from '../../hooks/useDialogFocusReturn';

/**
 * Spec §4.6 — Disconnect confirms first, naming the Connection and
 * counting its tabs, before `Workspace.tsx`'s `closeTabsForConnection` runs.
 * Sibling to `ConnectionDeleteDialog` (same shape: Modal, `alertdialog`,
 * `useDialogFocusReturn`) but a separate component rather than a shared one
 * with a `kind` flag — Delete's body talks about saved queries/history and
 * server data; Disconnect's talks about tabs and reconnecting. Folding both
 * into one component would mean every reader parsing which sentences apply
 * to which action.
 */
export function ConnectionDisconnectDialog({
  name,
  tabCount,
  onCancel,
  onConfirm,
  returnFocusTo,
}: {
  name: string;
  tabCount: number;
  onCancel: () => void;
  onConfirm: () => void;
  /** See `ConnectionDeleteDialog`'s prop of the same name. */
  returnFocusTo?: HTMLElement | null;
}) {
  // Dismiss paths only — `onConfirm` disconnects the connection this was
  // opened from, so its trigger may already be gone by the time focus could
  // go back, same reasoning as `ConnectionDeleteDialog`.
  const close = useDialogFocusReturn(onCancel, returnFocusTo);
  return (
    <Modal
      opened
      onClose={close}
      title={`Disconnect "${name}"?`}
      centered
      size="md"
      role="alertdialog"
    >
      <Stack gap="md">
        <Text size="xs" c="dimmed" lh={1.5}>
          {tabCount === 0
            ? `"${name}" has no open tabs. Disconnecting removes it from the navigator until you reconnect.`
            : `This closes ${tabCount} open tab${tabCount === 1 ? '' : 's'} and removes "${name}" from the navigator until you reconnect.`}
        </Text>
        <Group justify="flex-end" gap="xs">
          <Button size="compact-xs" variant="subtle" onClick={close}>Cancel</Button>
          <Button size="compact-xs" variant="filled" onClick={onConfirm}>Disconnect</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
