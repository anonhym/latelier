import React from 'react';
import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useHints } from '../hints/HintsContext';
import { api, getErrorMessage } from '../api/atelier';
import { notify } from '../theme/notifications';
import { useDialogFocusReturn } from '../hooks/useDialogFocusReturn';

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { reset } = useHints();
  const close = useDialogFocusReturn(onClose);
  const [resetting, setResetting] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  const handleResetHints = () => {
    setResetting(true);
    reset();
    notify.success("Hints reset — you'll see them again as you use the app.");
    setResetting(false);
  };

  const handleExportDiagnostic = async () => {
    setExporting(true);
    try {
      const { path } = await api.app.diagnosticBundle();
      if (path) {
        notify.success(`Saved to ${path}`, { title: 'Diagnostic bundle exported' });
      }
    } catch (err) {
      notify.error(getErrorMessage(err, 'Failed to export bundle.'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal opened onClose={close} title="Settings" centered size="md">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={2} style={{ flex: 1 }}>
            <Text size="sm" fw={600}>
              Hints
            </Text>
            <Text size="xs" c="dimmed">
              Re-enable contextual tips you've dismissed.
            </Text>
          </Stack>
          <Button
            variant="default"
            size="compact-xs"
            onClick={handleResetHints}
            disabled={resetting}
          >
            {resetting ? 'Resetting…' : 'Reset hints'}
          </Button>
        </Group>

        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={2} style={{ flex: 1 }}>
            <Text size="sm" fw={600}>
              Diagnostic bundle
            </Text>
            <Text size="xs" c="dimmed">
              Export recent logs and redacted connection metadata for support.
            </Text>
          </Stack>
          <Button
            variant="default"
            size="compact-xs"
            onClick={handleExportDiagnostic}
            disabled={exporting}
          >
            {exporting ? 'Exporting…' : 'Export bundle'}
          </Button>
        </Group>

        <Group justify="flex-end">
          <Button variant="subtle" size="compact-xs" onClick={close}>
            Close
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
