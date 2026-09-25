import React from 'react';
import { Button, Checkbox, Group, Modal, SegmentedControl, Stack, Text } from '@mantine/core';
import { useDialogFocusReturn } from '../../hooks/useDialogFocusReturn';
import { api, getErrorMessage } from '../../api/atelier';
import { notify } from '../../theme/notifications';
import { useCollectionWorkspace } from './context';
import { EMPTY_DOCUMENTS } from './resultSelection';
import { deriveColumns, resolveColumns } from './views/tableColumns';
import {
  exportColumnsFrom,
  exportFileExtension,
  serializeCsv,
  serializeJsonArray,
  serializeJsonl,
  type ExportFormat,
} from './exportFormat';

interface ExportDialogProps {
  onClose: () => void;
}

const FORMAT_DATA: { value: ExportFormat; label: string }[] = [
  { value: 'json', label: 'JSON array' },
  { value: 'jsonl', label: 'JSONL' },
  { value: 'csv', label: 'CSV' },
];

/**
 * Export the current result page only — exporting all matching documents
 * (up to a cap) is a separate channel, not built here. Reads the page's
 * documents and the Fields control's visible-column config straight off
 * `useCollectionWorkspace()`, same as `FieldsControl` itself, so this needs
 * no prop plumbing from `ResultBar`.
 *
 * Format defaults to Canonical EJSON with a single Relaxed checkbox, and CSV
 * columns are exactly the Fields control's visible (ordered, non-hidden,
 * including computed) field list.
 */
export function ExportDialog({ onClose }: ExportDialogProps) {
  const { state, meta } = useCollectionWorkspace();
  const close = useDialogFocusReturn(onClose);
  const documents = state.lastRun?.documents ?? EMPTY_DOCUMENTS;
  const [format, setFormat] = React.useState<ExportFormat>('json');
  const [relaxed, setRelaxed] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const canExport = documents.length > 0 && !saving;

  const handleExport = async () => {
    if (!canExport) return;
    setSaving(true);
    try {
      const content =
        format === 'csv'
          ? serializeCsv(
              documents,
              exportColumnsFrom(resolveColumns(deriveColumns(documents), state.columnConfig)),
            )
          : format === 'jsonl'
            ? serializeJsonl(documents, relaxed)
            : serializeJsonArray(documents, relaxed);
      const defaultName = `${meta.collection}.${exportFileExtension(format)}`;
      const { path } = await api.app.saveFile({ defaultName, content });
      // `null` is a cancelled save panel: stay open with the format choice
      // intact so the user can just try again.
      if (path !== null) close();
    } catch (err) {
      notify.error(`Export failed: ${getErrorMessage(err, 'the file could not be written')}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened onClose={close} title="Export current page" size={380} centered>
      <Stack gap={12}>
        <Text size="xs" c="dimmed">
          {documents.length.toLocaleString()} document{documents.length === 1 ? '' : 's'} on this
          page.
        </Text>

        <SegmentedControl
          size="xs"
          fullWidth
          value={format}
          onChange={(v) => setFormat(v as ExportFormat)}
          data={FORMAT_DATA}
        />

        {format !== 'csv' && (
          <Checkbox
            size="xs"
            label="Relaxed EJSON (friendlier to other tools; not lossless for every type)"
            checked={relaxed}
            onChange={(e) => setRelaxed(e.currentTarget.checked)}
          />
        )}

        <Group justify="flex-end" gap={8} mt={4}>
          <Button variant="default" size="xs" onClick={close}>
            Cancel
          </Button>
          <Button size="xs" disabled={!canExport} onClick={() => void handleExport()}>
            {saving ? 'Exporting…' : 'Export…'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
