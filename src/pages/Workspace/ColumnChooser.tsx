import React from 'react';
import { ActionIcon, Badge, Button, Checkbox, Popover, Stack, TextInput } from '@mantine/core';
import { themeVars } from '../../theme/themeVars';
import { I } from '../../icons';
import { useCollectionWorkspace } from './context';
import { EMPTY_DOCUMENTS } from './resultSelection';
import { deriveColumns, orderFields } from './views/tableColumns';
import type { CollectionTabState, ComputedColumn } from '@shared/types';

/**
 * Table-view column chooser (T2.5, AC3/AC4/AC8) — show/hide + reorder the
 * schema-derived fields, and add/remove dotted-path computed columns.
 * Modeled on `PreviewPicker.tsx`'s Popover-anchored-Button pattern; reads
 * everything off `useCollectionWorkspace()` (documents, `columnConfig`) so
 * it can be dropped into `<ResultBar>` with no prop plumbing, and writes
 * back through the existing `actions.patchWith` read-modify-write — the
 * same pattern `columns` / `expandedRows` / `schema` already use.
 */
export function ColumnChooser() {
  const T = themeVars;
  const { state, actions } = useCollectionWorkspace();
  const documents = state.lastRun?.documents ?? EMPTY_DOCUMENTS;
  const config = state.columnConfig;
  const [newPath, setNewPath] = React.useState('');

  const derived = React.useMemo(() => deriveColumns(documents), [documents]);
  const orderedFields = React.useMemo(
    () => orderFields(derived, config?.order),
    [derived, config?.order],
  );
  const hidden = React.useMemo(() => new Set(config?.hidden ?? []), [config?.hidden]);
  const computed = config?.computed ?? [];

  const patchColumnConfig = (
    updater: (prev: NonNullable<CollectionTabState['columnConfig']>) => CollectionTabState['columnConfig'],
  ) => {
    actions.patchWith((prev) => ({
      columnConfig: updater(prev.columnConfig ?? {}),
    }));
  };

  const toggleHidden = (field: string) => {
    patchColumnConfig((prev) => {
      const prevHidden = prev.hidden ?? [];
      const nextHidden = prevHidden.includes(field)
        ? prevHidden.filter((f) => f !== field)
        : [...prevHidden, field];
      return { ...prev, hidden: nextHidden };
    });
  };

  const moveField = (from: number, to: number) => {
    if (to < 0 || to >= orderedFields.length || from === to) return;
    patchColumnConfig((prev) => {
      // Recompute against the *current* orderedFields (closed over at call
      // time) rather than `prev.order` directly — `prev.order` may not yet
      // list every derived field (schema drift), and dragging must reorder
      // the full visible list the user sees, not just their explicit order.
      const next = orderedFields.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { ...prev, order: next };
    });
  };

  const dragIndex = React.useRef<number | null>(null);

  const trimmedNewPath = newPath.trim();
  const isDuplicatePath = computed.some((c) => c.path === trimmedNewPath);
  const canAdd = trimmedNewPath.length > 0 && !isDuplicatePath;

  const addComputedColumn = () => {
    if (!canAdd) return;
    const column: ComputedColumn = {
      id: crypto.randomUUID(),
      path: trimmedNewPath,
    };
    patchColumnConfig((prev) => ({
      ...prev,
      computed: [...(prev.computed ?? []), column],
    }));
    setNewPath('');
  };

  const removeComputedColumn = (id: string) => {
    patchColumnConfig((prev) => ({
      ...prev,
      computed: (prev.computed ?? []).filter((c) => c.id !== id),
    }));
  };

  const hiddenCount = hidden.size;

  return (
    <Popover position="bottom-end" shadow="md" withinPortal>
      <Popover.Target>
        <Button
          variant="default"
          size="compact-xs"
          rightSection={
            hiddenCount > 0 || computed.length > 0 ? (
              <Badge size="xs" variant="light" color="violet">
                {computed.length > 0 ? `+${computed.length}` : hiddenCount}
              </Badge>
            ) : undefined
          }
        >
          Columns
        </Button>
      </Popover.Target>
      <Popover.Dropdown p="xs">
        {documents.length === 0 ? (
          <div style={{ padding: '4px 8px', fontSize: 12, color: T.textMuted }}>
            No fields available
          </div>
        ) : (
          <Stack gap={4} style={{ maxHeight: 260, overflowY: 'auto', minWidth: 200 }}>
            {orderedFields.map((field, index) => (
              <div
                key={field}
                draggable
                onDragStart={() => {
                  dragIndex.current = index;
                }}
                onDragEnd={() => {
                  // A drag cancelled without a drop (Escape, or dropped
                  // outside a valid target) never fires onDrop, leaving a
                  // stale index for an unrelated later drop to consume.
                  dragIndex.current = null;
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = dragIndex.current;
                  dragIndex.current = null;
                  if (from === null) return;
                  moveField(from, index);
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'grab' }}
                title="Drag to reorder"
              >
                <span style={{ color: T.textGhost, fontSize: 11, display: 'flex' }}>{I.drag}</span>
                <Checkbox
                  size="xs"
                  label={field}
                  checked={!hidden.has(field)}
                  onChange={() => toggleHidden(field)}
                  style={{ flex: 1 }}
                />
              </div>
            ))}
          </Stack>
        )}

        {computed.length > 0 && (
          <Stack gap={4} mt="xs" style={{ minWidth: 200 }}>
            {computed.map((c) => (
              <div
                key={c.id}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}
              >
                <span style={{ flex: 1, color: T.text, fontFamily: 'monospace' }}>
                  {c.label ?? c.path}
                </span>
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  color="red"
                  aria-label={`Remove ${c.label ?? c.path}`}
                  onClick={() => removeComputedColumn(c.id)}
                >
                  {I.close}
                </ActionIcon>
              </div>
            ))}
          </Stack>
        )}

        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <TextInput
            size="xs"
            aria-label="Computed column path"
            placeholder="e.g. address.city"
            value={newPath}
            onChange={(e) => setNewPath(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addComputedColumn();
            }}
            style={{ flex: 1 }}
          />
          <Button
            size="compact-xs"
            aria-label="Add column"
            disabled={!canAdd}
            onClick={addComputedColumn}
          >
            Add
          </Button>
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}
