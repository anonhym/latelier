import React from 'react';
import { Alert, Button, Group, List, Modal, ScrollArea, Stack, Text } from '@mantine/core';
import type { ImportReport } from '@shared/types';
import { api, getErrorMessage } from '../../api/atelier';
import { useDialogFocusReturn } from '../../hooks/useDialogFocusReturn';
import { SubmitButton } from '../../components/SubmitButton';

interface ImportDialogProps {
  connectionId: string;
  dbName: string;
  collection: string;
  /** Known only to the navigator; the workspace host learns it from main's refusal. */
  readOnly?: boolean;
  onClose: () => void;
  /** Called once the import has run, while the dialog stays open on its report. */
  onImported: (report: ImportReport) => void;
  /** Supplied when the opener is gone by first render (context menu). */
  returnFocusTo?: HTMLElement | null;
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Import a JSON array or JSONL file into an existing collection: pick a file,
 * run the import, show what landed and what didn't. Props-driven rather than
 * reading the collection workspace, because the navigator hosts it too.
 */
export function ImportDialog({
  connectionId,
  dbName,
  collection,
  readOnly = false,
  onClose,
  onImported,
  returnFocusTo,
}: ImportDialogProps) {
  const close = useDialogFocusReturn(onClose, returnFocusTo);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [report, setReport] = React.useState<ImportReport | null>(null);

  const chooseAndImport = async () => {
    setError(null);
    setRunning(true);
    try {
      const { path } = await api.app.pickFile('data-import');
      if (path === null) return; // cancelled picker: stay open, nothing ran
      const result = await api.data.import({ connectionId, dbName, collection, path });
      setReport(result);
      onImported(result);
    } catch (err) {
      setError(getErrorMessage(err, 'Import failed'));
    } finally {
      setRunning(false);
    }
  };

  const at = (n: number) => (report?.format === 'jsonl' ? `Line ${n}` : `Index ${n}`);

  return (
    <Modal
      opened
      // The import keeps running in main whatever the dialog does, so it
      // stays up until the report is in.
      onClose={running ? () => {} : close}
      withCloseButton={!running}
      title={`Import into "${collection}"`}
      centered
      size="md"
    >
      <Stack gap="sm">
        {report === null ? (
          <Text size="xs" c="dimmed">
            A JSON array or JSONL file of Extended JSON documents (canonical or relaxed), into {dbName}.{collection}.
          </Text>
        ) : (
          <>
            <Text size="sm" role="status">
              Imported {plural(report.inserted, 'document')} from {report.fileName}
              {report.failed > 0 ? `; ${plural(report.failed, 'document')} failed.` : '.'}
            </Text>
            {report.errors.length > 0 && (
              <ScrollArea.Autosize mah={220} type="auto">
                <List size="xs" spacing={2} aria-label="Import failures">
                  {report.errors.map((e) => (
                    <List.Item key={e.at}>
                      <Text span size="xs" ff="monospace">{at(e.at)}:</Text> {e.message}
                    </List.Item>
                  ))}
                </List>
              </ScrollArea.Autosize>
            )}
            {report.errorsTruncated && (
              <Text size="xs" c="dimmed">
                Only the first {report.errors.length} failures are listed.
              </Text>
            )}
          </>
        )}
        {readOnly && (
          <Alert color="yellow" variant="light" role="alert">
            This connection is read-only. Importing is disabled.
          </Alert>
        )}
        {error && (
          <Alert color="red" variant="light" role="alert">
            {error}
          </Alert>
        )}
        <Group justify="flex-end" gap="xs">
          <Button variant="subtle" size="compact-xs" onClick={close} disabled={running}>
            {report === null ? 'Cancel' : 'Close'}
          </Button>
          <SubmitButton
            size="compact-xs"
            submitting={running}
            disabled={readOnly}
            onClick={() => void chooseAndImport()}
          >
            {running ? 'Importing…' : report === null ? 'Choose file…' : 'Import another file…'}
          </SubmitButton>
        </Group>
      </Stack>
    </Modal>
  );
}
