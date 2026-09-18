import React from 'react';
import { themeVars } from '../theme/themeVars';
import { I } from '../icons';
import {
  ActionIcon,
  Alert,
  Badge as MantineBadge,
  Button,
  Drawer,
  Group,
  Modal,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { api, isIpcError } from '../api/atelier';
import { confirmDestructive } from '../utils/confirm';
import { DisclosureToggle } from '../components/DisclosureToggle';
import { useDialogFocusReturn } from '../hooks/useDialogFocusReturn';
import { ownGet } from '../utils/ownProperty';
import type { CollectionInfo, DbInfo } from '@shared/ipc';
import type {
  ConnectionRuntime,
  ConnectionSummary,
  IndexCreateInput,
  IndexFieldDirection,
  IndexInfo,
} from '@shared/types';

interface Target {
  dbName: string;
  collection: string;
}

const LAST_TARGET_KEY = 'ui.indexes.lastTarget';

function humanBytes(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function humanCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function humanTtl(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

function renderKey(key: IndexInfo['key']): string {
  const inner = key
    .map((k: { field: string; direction: IndexFieldDirection }) => {
      const dir =
        typeof k.direction === 'number' ? String(k.direction) : `'${k.direction}'`;
      return `${k.field}: ${dir}`;
    })
    .join(', ');
  return `{ ${inner} }`;
}

function indexBadges(idx: IndexInfo): Array<{ label: string; tone?: 'accent' | 'warn' }> {
  if (idx.isIdIndex) return [{ label: 'default' }];
  const out: Array<{ label: string; tone?: 'accent' | 'warn' }> = [];
  if (idx.unique) out.push({ label: 'unique', tone: 'accent' });
  if (idx.sparse) out.push({ label: 'sparse' });
  if (typeof idx.expireAfterSeconds === 'number') {
    out.push({ label: `ttl ${humanTtl(idx.expireAfterSeconds)}`, tone: 'warn' });
  }
  if (idx.partialFilterExpression) out.push({ label: 'partial' });
  if (idx.collation) out.push({ label: 'collation' });
  if (idx.hidden) out.push({ label: 'hidden', tone: 'warn' });
  const specials: IndexFieldDirection[] = ['text', 'hashed', '2d', '2dsphere', 'geoHaystack'];
  for (const k of idx.key) {
    if (typeof k.direction === 'string' && specials.includes(k.direction)) {
      out.push({ label: k.direction });
      break;
    }
  }
  if (out.length === 0) out.push({ label: 'standard' });
  return out;
}

function IndexBadge({ label, tone }: { label: string; tone?: 'accent' | 'warn' }) {
  const color = tone === 'accent' ? 'green' : tone === 'warn' ? 'orange' : 'gray';
  return (
    <MantineBadge
      size="xs"
      variant="light"
      color={color}
      style={{ textTransform: 'none', fontFamily: 'inherit', fontWeight: 400 }}
    >
      {label}
    </MantineBadge>
  );
}

export function IndexesTab({
  conn,
  runtime,
}: {
  conn: ConnectionSummary;
  runtime: ConnectionRuntime;
}) {
  const T = themeVars;
  const [dbs, setDbs] = React.useState<DbInfo[] | null>(null);
  const [collsByDb, setCollsByDb] = React.useState<Record<string, CollectionInfo[]>>({});
  const [target, setTarget] = React.useState<Target | null>(null);
  const [indexes, setIndexes] = React.useState<IndexInfo[] | null>(null);
  const [loadingIndexes, setLoadingIndexes] = React.useState(false);
  const [indexError, setIndexError] = React.useState<{ message: string; code?: string } | null>(
    null,
  );
  const [dbError, setDbError] = React.useState<string | null>(null);
  const [showSystem, setShowSystem] = React.useState(false);
  const [expandedRow, setExpandedRow] = React.useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [dropName, setDropName] = React.useState<string | null>(null);
  const initialPickRef = React.useRef(false);

  React.useEffect(() => {
    void api.prefs
      .get<boolean>('ui.showSystemDbs')
      .then((v) => v !== null && setShowSystem(v))
      .catch(() => { /* non-fatal */ });
  }, []);

  React.useEffect(() => {
    void api.prefs
      .get<Target>(LAST_TARGET_KEY)
      .then((v) => v && setTarget(v))
      .catch(() => { /* non-fatal */ });
  }, []);

  const loadDatabases = React.useCallback(async () => {
    if (runtime.status !== 'connected') return;
    try {
      const rows = await api.meta.listDatabases({
        connectionId: conn.id,
        includeSystem: showSystem,
      });
      setDbs(rows);
      setDbError(null);
    } catch (err) {
      setDbError(isIpcError(err) ? err.message : String(err));
    }
  }, [conn.id, runtime.status, showSystem]);

  const loadCollections = React.useCallback(
    async (dbName: string) => {
      const cached = ownGet(collsByDb, dbName);
      if (cached) return cached;
      try {
        const rows = await api.meta.listCollections({ connectionId: conn.id, dbName });
        setCollsByDb((c) => ({ ...c, [dbName]: rows }));
        return rows;
      } catch {
        setCollsByDb((c) => ({ ...c, [dbName]: [] }));
        return [];
      }
    },
    [conn.id, collsByDb],
  );

  const loadIndexes = React.useCallback(
    async (t: Target) => {
      setLoadingIndexes(true);
      setIndexError(null);
      try {
        const rows = await api.index.list({
          connectionId: conn.id,
          dbName: t.dbName,
          collection: t.collection,
        });
        setIndexes(rows);
      } catch (err) {
        if (isIpcError(err)) {
          setIndexError({ message: err.message, code: err.code });
        } else {
          setIndexError({ message: String(err) });
        }
        setIndexes(null);
      } finally {
        setLoadingIndexes(false);
      }
    },
    [conn.id],
  );

  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    void loadDatabases();
  }, [loadDatabases]);

  React.useEffect(() => {
    if (!target) return;
    void loadCollections(target.dbName);
    void loadIndexes(target);
    setExpandedRow(null);
  }, [target, loadCollections, loadIndexes]);

  React.useEffect(() => {
    if (initialPickRef.current) return;
    if (!dbs || dbs.length === 0) return;
    if (target) {
      initialPickRef.current = true;
      return;
    }
    initialPickRef.current = true;
    const firstDb = dbs[0]!.name;
    void loadCollections(firstDb).then((rows) => {
      const first = rows.find((c) => c.type !== 'view');
      if (first) {
        const next = { dbName: firstDb, collection: first.name };
        setTarget(next);
        void api.prefs.set(LAST_TARGET_KEY, next).catch(() => { /* ok */ });
      }
    });
  }, [dbs, target, loadCollections]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const onPickDb = async (dbName: string) => {
    const rows = await loadCollections(dbName);
    const first = rows.find((c) => c.type !== 'view');
    if (!first) {
      setTarget({ dbName, collection: '' });
      return;
    }
    const next = { dbName, collection: first.name };
    setTarget(next);
    void api.prefs.set(LAST_TARGET_KEY, next).catch(() => { /* ok */ });
  };

  const onPickCollection = (collection: string) => {
    if (!target) return;
    const next = { dbName: target.dbName, collection };
    setTarget(next);
    void api.prefs.set(LAST_TARGET_KEY, next).catch(() => { /* ok */ });
  };

  if (runtime.status !== 'connected') {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: T.textMuted }}>
        Not connected. Open the Overview tab to connect.
      </div>
    );
  }

  if (dbError) {
    return (
      <div style={{ padding: 20, color: T.warn }}>
        {dbError}
        <button
          onClick={() => void loadDatabases()}
          style={{ marginLeft: 8, background: 'none', border: 'none', color: T.accent, cursor: 'pointer' }}
        >
          Retry
        </button>
      </div>
    );
  }

  const colls = target ? ownGet(collsByDb, target.dbName) ?? [] : [];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 16px',
          borderBottom: `1px solid ${T.border}`,
          background: T.surface,
        }}
      >
        <select
          aria-label="Database"
          value={target?.dbName ?? ''}
          onChange={(e) => void onPickDb(e.target.value)}
          style={{
            border: `1px solid ${T.border}`,
            borderRadius: T.rs,
            background: T.surfaceRaised,
            padding: '4px 8px',
            fontSize: 12,
            color: T.text,
          }}
        >
          <option value="" disabled>
            Database…
          </option>
          {dbs?.map((d) => (
            <option key={d.name} value={d.name}>
              {d.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Collection"
          value={target?.collection ?? ''}
          onChange={(e) => onPickCollection(e.target.value)}
          disabled={!target || colls.length === 0}
          style={{
            border: `1px solid ${T.border}`,
            borderRadius: T.rs,
            background: T.surfaceRaised,
            padding: '4px 8px',
            fontSize: 12,
            color: T.text,
            minWidth: 160,
          }}
        >
          <option value="" disabled>
            Collection…
          </option>
          {colls
            .filter((c) => c.type !== 'view')
            .map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
        </select>

        <div style={{ flex: 1 }} />

        <Button
          size="compact-xs"
          variant="filled"
          onClick={() => setDrawerOpen(true)}
          disabled={!target || !target.collection}
        >
          + New index
        </Button>

        <Button
          size="compact-xs"
          variant="subtle"
          onClick={() => target && void loadIndexes(target)}
          leftSection={I.sync}
          disabled={!target || loadingIndexes}
        >
          Refresh
        </Button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {!target && (
          <div style={{ padding: 24, color: T.textMuted, fontSize: 13, textAlign: 'center' }}>
            Pick a database and collection to inspect its indexes.
          </div>
        )}

        {target && indexError && (
          <Alert
            role="alert"
            color="orange"
            variant="light"
            m="sm"
            styles={{ message: { fontSize: 12 } }}
          >
            <Group gap="xs" wrap="nowrap" align="flex-start">
              <Text size="xs">
                {indexError.code === 'UNAUTHORIZED'
                  ? `This connection lacks the privilege to read indexes on ${target.dbName}.${target.collection}.`
                  : indexError.message}
              </Text>
              <Button
                variant="subtle"
                size="compact-xs"
                ml="auto"
                style={{ flexShrink: 0 }}
                onClick={() => void loadIndexes(target)}
              >
                Retry
              </Button>
            </Group>
          </Alert>
        )}

        {target && !indexError && loadingIndexes && !indexes && (
          <div style={{ padding: 20, color: T.textMuted, fontSize: 13 }}>Loading indexes…</div>
        )}

        {target && drawerOpen && (
          <CreateIndexDrawer
            target={target}
            onCancel={() => setDrawerOpen(false)}
            onCreated={() => {
              setDrawerOpen(false);
              void loadIndexes(target);
            }}
            connectionId={conn.id}
          />
        )}

        {target && dropName && (
          <DropConfirmDialog
            indexName={dropName}
            onCancel={() => setDropName(null)}
            onDropped={() => {
              setDropName(null);
              void loadIndexes(target);
            }}
            connectionId={conn.id}
            dbName={target.dbName}
            collection={target.collection}
          />
        )}

        {target && !indexError && indexes && (
          <Table
            striped
            highlightOnHover
            withTableBorder
            withColumnBorders={false}
            styles={{
              table: { fontSize: 12 },
              th: {
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                fontWeight: 600,
                color: T.textMuted,
                padding: '8px 12px',
              },
              td: { padding: '8px 12px', verticalAlign: 'middle' },
            }}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Key</Table.Th>
                <Table.Th>Options</Table.Th>
                <Table.Th>Size</Table.Th>
                <Table.Th>Use</Table.Th>
                <Table.Th style={{ width: 36 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {indexes.map((idx) => {
                const isOpen = expandedRow === idx.name;
                return (
                  <React.Fragment key={idx.name}>
                    <Table.Tr
                      onClick={() => setExpandedRow(isOpen ? null : idx.name)}
                      style={{ cursor: 'pointer' }}
                    >
                      <Table.Td>
                        <DisclosureToggle open={isOpen}>
                          <span
                            style={{
                              fontFamily: 'monospace',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              color: T.text,
                            }}
                            title={idx.name}
                          >
                            {idx.name}
                          </span>
                        </DisclosureToggle>
                      </Table.Td>
                      <Table.Td>
                        <Text
                          size="xs"
                          c="dimmed"
                          style={{
                            fontFamily: 'monospace',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={renderKey(idx.key)}
                        >
                          {renderKey(idx.key)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4} wrap="wrap">
                          {indexBadges(idx).map((b) => (
                            <IndexBadge key={b.label} label={b.label} tone={b.tone} />
                          ))}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text
                          size="xs"
                          c="dimmed"
                          style={{ fontVariantNumeric: 'tabular-nums' }}
                        >
                          {typeof idx.sizeBytes === 'number' ? humanBytes(idx.sizeBytes) : '—'}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text
                          size="xs"
                          c="dimmed"
                          style={{ fontVariantNumeric: 'tabular-nums' }}
                          title={idx.usage ? `since ${idx.usage.since}` : undefined}
                        >
                          {idx.usage ? humanCount(idx.usage.ops) : '—'}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Group justify="flex-end">
                          {!idx.isIdIndex && (
                            <ActionIcon
                              aria-label={`Drop index ${idx.name}`}
                              variant="subtle"
                              color="red"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDropName(idx.name);
                              }}
                              title="Drop index"
                            >
                              {I.trash}
                            </ActionIcon>
                          )}
                        </Group>
                      </Table.Td>
                    </Table.Tr>

                    {isOpen && (
                      <Table.Tr>
                        <Table.Td
                          colSpan={6}
                          style={{
                            background: T.surfaceRaised,
                            paddingLeft: 38,
                          }}
                        >
                          <Stack gap={6} py={4}>
                            <Text size="xs" c="dimmed">
                              <span style={{ color: T.textMuted }}>Version</span>
                              {' · v'}
                              {idx.version}
                            </Text>
                            {idx.partialFilterExpression && (
                              <Text
                                size="xs"
                                c="dimmed"
                                style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}
                              >
                                <span style={{ color: T.textMuted, fontFamily: 'inherit' }}>
                                  partialFilterExpression
                                </span>
                                {' · '}
                                {idx.partialFilterExpression}
                              </Text>
                            )}
                            {idx.collation && (
                              <Text
                                size="xs"
                                c="dimmed"
                                style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}
                              >
                                <span style={{ color: T.textMuted, fontFamily: 'inherit' }}>collation</span>
                                {' · '}
                                {idx.collation}
                              </Text>
                            )}
                            {idx.usage && (
                              <Text size="xs" c="dimmed">
                                <span style={{ color: T.textMuted }}>Usage</span>
                                {' · '}
                                {idx.usage.ops.toLocaleString()} ops since{' '}
                                {new Date(idx.usage.since).toLocaleString()}
                              </Text>
                            )}
                          </Stack>
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </React.Fragment>
                );
              })}
            </Table.Tbody>
          </Table>
        )}
      </div>

    </div>
  );
}

const DIRECTION_OPTIONS: IndexFieldDirection[] = [
  1,
  -1,
  'text',
  'hashed',
  '2d',
  '2dsphere',
];

interface FieldRow {
  field: string;
  direction: IndexFieldDirection;
}

// Hoisted so the dirty check below compares against the same literals the fields open with.
const DEFAULT_FIELDS: FieldRow[] = [{ field: '', direction: 1 }];
const DEFAULT_PARTIAL_FILTER = '{}';
const DEFAULT_COLLATION = '{}';

function CreateIndexDrawer({
  target,
  connectionId,
  onCancel,
  onCreated,
}: {
  target: { dbName: string; collection: string };
  connectionId: string;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const T = themeVars;
  const close = useDialogFocusReturn(onCancel);
  const [fields, setFields] = React.useState<FieldRow[]>(DEFAULT_FIELDS);
  const [name, setName] = React.useState('');
  const [unique, setUnique] = React.useState(false);
  const [sparse, setSparse] = React.useState(false);
  const [ttlEnabled, setTtlEnabled] = React.useState(false);
  const [ttlSeconds, setTtlSeconds] = React.useState('');
  const [partialEnabled, setPartialEnabled] = React.useState(false);
  const [partialFilter, setPartialFilter] = React.useState(DEFAULT_PARTIAL_FILTER);
  const [collationEnabled, setCollationEnabled] = React.useState(false);
  const [collation, setCollation] = React.useState(DEFAULT_COLLATION);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const isDirty =
    JSON.stringify(fields) !== JSON.stringify(DEFAULT_FIELDS) ||
    name !== '' ||
    unique ||
    sparse ||
    ttlEnabled ||
    ttlSeconds !== '' ||
    partialEnabled ||
    partialFilter !== DEFAULT_PARTIAL_FILTER ||
    collationEnabled ||
    collation !== DEFAULT_COLLATION;

  const requestClose = async () => {
    if (!isDirty) return close();
    const discard = await confirmDestructive({
      title: 'Discard changes?',
      body: 'This closes the editor and loses what you typed.',
      confirmLabel: 'Discard',
    });
    if (discard) close();
  };

  const updateField = (i: number, patch: Partial<FieldRow>) => {
    setFields((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const removeField = (i: number) => {
    setFields((rows) => (rows.length === 1 ? rows : rows.filter((_, idx) => idx !== i)));
  };

  const submit = async () => {
    setError(null);
    if (ttlEnabled) {
      if (fields.length !== 1) {
        setError('TTL indexes require exactly one field.');
        return;
      }
      const dir = fields[0]!.direction;
      if (dir !== 1 && dir !== -1) {
        setError('TTL indexes require an ascending or descending key.');
        return;
      }
      const n = Number(ttlSeconds);
      if (!Number.isFinite(n) || n < 0) {
        setError('expireAfterSeconds must be a non-negative number.');
        return;
      }
    }
    if (partialEnabled) {
      try {
        JSON.parse(partialFilter);
      } catch {
        setError('partialFilterExpression: invalid JSON.');
        return;
      }
    }
    if (collationEnabled) {
      try {
        JSON.parse(collation);
      } catch {
        setError('collation: invalid JSON.');
        return;
      }
    }

    const options: IndexCreateInput['options'] = {};
    if (name.trim()) options.name = name.trim();
    if (unique) options.unique = true;
    if (sparse) options.sparse = true;
    if (ttlEnabled) options.expireAfterSeconds = Number(ttlSeconds);
    if (partialEnabled) options.partialFilterExpression = partialFilter;
    if (collationEnabled) options.collation = collation;

    setSubmitting(true);
    try {
      await api.index.create({
        connectionId,
        dbName: target.dbName,
        collection: target.collection,
        fields,
        options,
      });
      onCreated();
    } catch (err) {
      setError(isIpcError(err) ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      opened
      onClose={() => void requestClose()}
      position="right"
      size={380}
      title={`New index — ${target.dbName}.${target.collection}`}
      padding="md"
      closeOnClickOutside={false}
      // minHeight: 0 lets the flex scroll region shrink below content — jsdom does no layout, only e2e catches a regression here.
      styles={{
        content: { display: 'flex', flexDirection: 'column' },
        body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
      }}
    >
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Section title="Fields">
          {fields.map((f, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input
                aria-label={`Field ${i + 1}`}
                value={f.field}
                onChange={(e) => updateField(i, { field: e.target.value })}
                placeholder="field name"
                style={inputStyle(T)}
              />
              <select
                aria-label={`Direction ${i + 1}`}
                value={String(f.direction)}
                onChange={(e) => {
                  const v = e.target.value;
                  const dir: IndexFieldDirection =
                    v === '1' || v === '-1' ? (Number(v) as 1 | -1) : (v as IndexFieldDirection);
                  updateField(i, { direction: dir });
                }}
                style={{ ...inputStyle(T), maxWidth: 110 }}
              >
                {DIRECTION_OPTIONS.map((d) => (
                  <option key={String(d)} value={String(d)}>
                    {d === 1 ? 'asc (1)' : d === -1 ? 'desc (-1)' : d}
                  </option>
                ))}
              </select>
              <button
                onClick={() => removeField(i)}
                disabled={fields.length === 1}
                aria-label={`Remove field ${i + 1}`}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: fields.length === 1 ? T.textGhost : T.textMuted,
                  cursor: fields.length === 1 ? 'not-allowed' : 'pointer',
                  fontSize: 14,
                }}
              >
                ×
              </button>
            </div>
          ))}
          <button
            onClick={() => setFields((rows) => [...rows, { field: '', direction: 1 }])}
            style={{
              background: 'transparent',
              border: `1px dashed ${T.border}`,
              borderRadius: T.rs,
              padding: '4px 8px',
              fontSize: 11,
              color: T.textMuted,
              cursor: 'pointer',
            }}
          >
            + Add field
          </button>
        </Section>

        <Section title="Options">
          <Check label="Unique" checked={unique} onChange={setUnique} />
          <Check label="Sparse" checked={sparse} onChange={setSparse} />
          <Check label="TTL — expire after" checked={ttlEnabled} onChange={setTtlEnabled}>
            {ttlEnabled && (
              <input
                aria-label="expireAfterSeconds"
                value={ttlSeconds}
                onChange={(e) => setTtlSeconds(e.target.value)}
                placeholder="seconds"
                style={{ ...inputStyle(T), maxWidth: 100, marginLeft: 6 }}
              />
            )}
          </Check>
          <Check
            label="Partial filter (EJSON)"
            checked={partialEnabled}
            onChange={setPartialEnabled}
          />
          {partialEnabled && (
            <textarea
              aria-label="partialFilterExpression"
              value={partialFilter}
              onChange={(e) => setPartialFilter(e.target.value)}
              rows={3}
              style={{ ...inputStyle(T), fontFamily: 'monospace', resize: 'vertical' }}
            />
          )}
          <Check label="Collation (EJSON)" checked={collationEnabled} onChange={setCollationEnabled} />
          {collationEnabled && (
            <textarea
              aria-label="collation"
              value={collation}
              onChange={(e) => setCollation(e.target.value)}
              rows={2}
              style={{ ...inputStyle(T), fontFamily: 'monospace', resize: 'vertical' }}
            />
          )}
        </Section>

        <Section title="Name (optional)">
          <input
            aria-label="Index name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="server generates one if blank"
            style={inputStyle(T)}
          />
        </Section>

        {error && (
          <div
            role="alert"
            style={{
              padding: '8px 10px',
              borderRadius: T.rs,
              border: `1px solid ${T.warn}`,
              background: 'rgba(184,76,20,0.08)',
              color: T.warn,
              fontSize: 11,
            }}
          >
            {error}
          </div>
        )}
      </div>

      <div
        style={{
          paddingTop: 12,
          borderTop: `1px solid ${T.border}`,
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
        }}
      >
        <Button
          variant="subtle"
          size="compact-xs"
          onClick={() => void requestClose()}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button variant="filled" size="compact-xs" onClick={() => void submit()} disabled={submitting}>
          {submitting ? 'Creating…' : 'Create index'}
        </Button>
      </div>
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const T = themeVars;
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: T.textMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
  children,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  const T = themeVars;
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        color: T.text,
        marginBottom: 4,
        cursor: 'pointer',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: T.accent }}
      />
      <span>{label}</span>
      {children}
    </label>
  );
}

function inputStyle(T: typeof themeVars): React.CSSProperties {
  return {
    flex: 1,
    border: `1px solid ${T.border}`,
    borderRadius: T.rs,
    padding: '4px 8px',
    fontSize: 12,
    color: T.text,
    background: T.surfaceRaised,
    outline: 'none',
    fontFamily: 'inherit',
  };
}

function DropConfirmDialog({
  indexName,
  connectionId,
  dbName,
  collection,
  onCancel,
  onDropped,
}: {
  indexName: string;
  connectionId: string;
  dbName: string;
  collection: string;
  onCancel: () => void;
  onDropped: () => void;
}) {
  const close = useDialogFocusReturn(onCancel);
  const [typed, setTyped] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const matches = typed === indexName;

  const submit = async () => {
    if (!matches) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.index.drop({ connectionId, dbName, collection, name: indexName });
      onDropped();
    } catch (err) {
      setError(isIpcError(err) ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      opened
      onClose={close}
      title={`Drop index "${indexName}"?`}
      centered
      size="md"
      aria-label="Drop index"
    >
      <Stack gap="sm">
        <Text size="xs" c="dimmed" lh={1.5}>
          This is permanent. Queries that relied on this index may slow down.
        </Text>
        <Stack gap={6}>
          <Text size="xs" c="dimmed">
            Type the index name to confirm:
          </Text>
          <TextInput
            aria-label="Confirm index name"
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.currentTarget.value)}
            size="xs"
            styles={{ input: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' } }}
          />
        </Stack>
        {error && (
          <Alert color="red" variant="light" role="alert">
            {error}
          </Alert>
        )}
        <Group justify="flex-end" gap="xs">
          <Button variant="subtle" size="compact-xs" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="filled" color="red" size="compact-xs" onClick={() => void submit()} disabled={!matches || submitting}>
            {submitting ? 'Dropping…' : 'Drop'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
