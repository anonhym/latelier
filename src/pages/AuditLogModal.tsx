import React from 'react';
import { Button, Group, Modal, NativeSelect, Stack, Table, Text, TextInput } from '@mantine/core';
import type { AuditEntry, ConnectionSummary } from '@shared/types';
import { api, getErrorMessage } from '../api/atelier';
import { useDialogFocusReturn } from '../hooks/useDialogFocusReturn';

interface AuditLogModalProps {
  /** The Focused Tab's Connection; the picker falls back to the first one. */
  initialConnectionId: string | null;
  onClose: () => void;
}

function target(e: AuditEntry): string {
  if (e.summary.op === 'collectionRename') {
    return `${e.dbName}.${e.summary.fromName} → ${e.summary.toName}`;
  }
  return e.collection === null ? e.dbName : `${e.dbName}.${e.collection}`;
}

function details(e: AuditEntry): string {
  const s = e.summary;
  const parts: string[] = [];
  if ('filter' in s) parts.push(s.filter);
  if ('insertedCount' in s && s.insertedCount !== undefined) parts.push(`${s.insertedCount} inserted`);
  if ('matchedCount' in s && s.matchedCount !== undefined) parts.push(`${s.matchedCount} matched`);
  if ('modifiedCount' in s && s.modifiedCount !== undefined) parts.push(`${s.modifiedCount} modified`);
  if ('deletedCount' in s && s.deletedCount !== undefined) parts.push(`${s.deletedCount} deleted`);
  return parts.join(' · ');
}

function outcome(e: AuditEntry): string {
  if (e.outcome === 'ok') return 'Done';
  return `${e.outcome === 'partial' ? 'Partial' : 'Failed'} (${e.errorCode ?? 'unknown'})`;
}

/**
 * Read-only view of one Connection's Audit Log, newest first. Filters match a
 * database or collection name exactly.
 */
export function AuditLogModal({ initialConnectionId, onClose }: AuditLogModalProps) {
  const close = useDialogFocusReturn(onClose);
  const [connections, setConnections] = React.useState<ConnectionSummary[]>([]);
  const [connectionId, setConnectionId] = React.useState(initialConnectionId);
  const [dbName, setDbName] = React.useState('');
  const [collection, setCollection] = React.useState('');
  const [entries, setEntries] = React.useState<AuditEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    api.conn
      .list()
      .then((rows) => {
        setConnections(rows);
        setConnectionId((id) => id ?? rows[0]?.id ?? null);
      })
      .catch((err: unknown) => setError(getErrorMessage(err, 'Failed to load connections.')));
  }, []);

  React.useEffect(() => {
    if (!connectionId) return;
    let cancelled = false;
    api.audit
      .list({
        connectionId,
        dbName: dbName.trim() || undefined,
        collection: collection.trim() || undefined,
      })
      .then((rows) => {
        if (cancelled) return;
        setEntries(rows);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'Failed to load the audit log.'));
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, dbName, collection]);

  return (
    <Modal opened onClose={close} title="Audit log" centered size="xl">
      <Stack gap="md">
        <Group grow align="flex-end">
          <NativeSelect
            label="Connection"
            value={connectionId ?? ''}
            onChange={(e) => setConnectionId(e.currentTarget.value || null)}
            data={connections.map((c) => ({ value: c.id, label: c.name }))}
          />
          <TextInput label="Database" value={dbName} onChange={(e) => setDbName(e.currentTarget.value)} />
          <TextInput label="Collection" value={collection} onChange={(e) => setCollection(e.currentTarget.value)} />
        </Group>

        {error && (
          <Text size="sm" c="red" role="alert">
            {error}
          </Text>
        )}
        {entries !== null && entries.length === 0 && !error && (
          <Text size="sm" c="dimmed">
            No Operations recorded.
          </Text>
        )}
        {entries !== null && entries.length > 0 && (
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Time</Table.Th>
                <Table.Th>Operation</Table.Th>
                <Table.Th>Target</Table.Th>
                <Table.Th>Details</Table.Th>
                <Table.Th>Outcome</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {entries.map((e) => (
                <Table.Tr key={e.id}>
                  <Table.Td>{new Date(e.ranAt).toLocaleString()}</Table.Td>
                  <Table.Td>{e.op}</Table.Td>
                  <Table.Td>{target(e)}</Table.Td>
                  <Table.Td style={{ fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>
                    {details(e)}
                  </Table.Td>
                  <Table.Td>{outcome(e)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}

        <Group justify="flex-end">
          <Button variant="subtle" size="compact-xs" onClick={close}>
            Close
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
