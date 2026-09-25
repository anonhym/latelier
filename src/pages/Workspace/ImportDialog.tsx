import React from 'react';
import { Alert, Button, Group, List, Modal, Progress, ScrollArea, Stack, Text } from '@mantine/core';
import type { DataImportProgressEvent, ImportReport } from '@shared/types';
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
  const [progress, setProgress] = React.useState<DataImportProgressEvent | null>(null);
  const cancelTokenRef = React.useRef<string | null>(null);
  const unsubscribeRef = React.useRef<(() => void) | null>(null);

  // The import keeps running in main even if this component unmounts (e.g.
  // the workspace tab closes mid-import), so this only stops listening —
  // it never cancels the run.
  React.useEffect(() => () => unsubscribeRef.current?.(), []);

  const chooseAndImport = async () => {
    setError(null);
    setRunning(true);
    setProgress(null);
    const cancelToken = crypto.randomUUID();
    cancelTokenRef.current = cancelToken;
    unsubscribeRef.current = api.data.onImportProgress((evt) => {
      if (evt.cancelToken === cancelToken) setProgress(evt);
    });
    try {
      const { path } = await api.app.pickFile('data-import');
      if (path === null) return; // cancelled picker: stay open, nothing ran
      const result = await api.data.import({ connectionId, dbName, collection, path, cancelToken });
      setReport(result);
      onImported(result);
    } catch (err) {
      setError(getErrorMessage(err, 'Import failed'));
    } finally {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      cancelTokenRef.current = null;
      setRunning(false);
      setProgress(null);
    }
  };

  const cancelImport = () => {
    const token = cancelTokenRef.current;
    if (token) void api.data.cancelImport({ token });
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
          running ? (
            <Stack gap={4}>
              <Progress
                value={progress && progress.totalBytes > 0 ? Math.min(100, (progress.bytesRead / progress.totalBytes) * 100) : 0}
                size="sm"
                aria-label="Import progress"
              />
              <Group justify="space-between" gap="xs">
                <Text size="xs" c="dimmed">
                  {progress ? `${plural(progress.inserted, 'document')} imported` : 'Starting…'}
                </Text>
                <Button variant="subtle" size="compact-xs" onClick={cancelImport}>
                  Cancel import
                </Button>
              </Group>
            </Stack>
          ) : (
            <Text size="xs" c="dimmed">
              A JSON array or JSONL file of Extended JSON documents (canonical or relaxed), into {dbName}.{collection}.
            </Text>
          )
        ) : (
          <>
            <Text size="sm" role="status">
              {report.cancelled ? 'Cancelled — ' : 'Imported '}
              {plural(report.inserted, 'document')}{report.cancelled ? ' landed' : ''} from {report.fileName}
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
