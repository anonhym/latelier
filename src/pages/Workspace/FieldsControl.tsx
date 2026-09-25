import React from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Popover,
  Stack,
  TextInput,
  VisuallyHidden,
} from '@mantine/core';
import { themeVars } from '../../theme/themeVars';
import { I } from '../../icons';
import { useCollectionWorkspace } from './context';
import { EMPTY_DOCUMENTS } from './resultSelection';
import { deriveColumns, orderFields } from './views/tableColumns';
import { focusTargetAfterMove, type MoveDirection } from './columnReorderFocus';
import type { CollectionTabState, ComputedColumn } from '@shared/types';

/**
 * Fields control (T2.5, AC3/AC4/AC8) — show/hide + reorder the
 * schema-derived fields, shared by Tree, JSON and Table (Table consumes the
 * config for its columns; Tree reads it too, for its collapsed-row preview
 * — see `TreeView.tsx`. JSON reads the hidden list too — see `JsonView.tsx`).
 * Also add/remove dotted-path computed columns, but that section only
 * renders in Table — `computed` only ever feeds `TableView`'s column
 * resolution (`tableColumns.ts`), so offering it elsewhere would let a
 * user add a column that visibly does nothing.
 * A Popover-anchored-Button pattern; reads everything off
 * `useCollectionWorkspace()` (documents, `columnConfig`) so it can be
 * dropped into `<ResultBar>` with no prop plumbing, and writes back through
 * the existing `actions.patchWith` read-modify-write — the same pattern
 * `columns` / `expandedRows` / `schema` already use.
 */
export function FieldsControl() {
  const T = themeVars;
  const { state, actions } = useCollectionWorkspace();
  const isTableView = state.view === 'Table';
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

  // Keyboard reorder path (#57): same `moveField` entry point as onDrop, plus
  // focus management drag never needed. Moving a field to an end disables
  // the button the user just pressed (acceptance: disabled, not a no-op) —
  // a disabled focused button drops focus to <body> (the #55/#70 defect), so
  // `pendingMoveRef` records which button was pressed and a layout effect,
  // once `orderedFields` reflects the real reorder, redirects focus to the
  // still-enabled sibling button on that same row.
  const buttonRefs = React.useRef(new Map<string, { up: HTMLButtonElement | null; down: HTMLButtonElement | null }>());
  const pendingMoveRef = React.useRef<{ field: string; direction: MoveDirection } | null>(null);
  const [announcement, setAnnouncement] = React.useState('');

  const requestMove = (field: string, index: number, direction: MoveDirection) => {
    const to = direction === 'up' ? index - 1 : index + 1;
    if (to < 0 || to >= orderedFields.length) return;
    pendingMoveRef.current = { field, direction };
    setAnnouncement(`${field} moved to position ${to + 1} of ${orderedFields.length}`);
    moveField(index, to);
  };

  React.useLayoutEffect(() => {
    const pending = pendingMoveRef.current;
    if (!pending) return;
    pendingMoveRef.current = null;
    const newIndex = orderedFields.indexOf(pending.field);
    if (newIndex === -1) return;
    const refs = buttonRefs.current.get(pending.field);
    if (!refs) return;
    refs[focusTargetAfterMove(pending.direction, newIndex, orderedFields.length)]?.focus();
  }, [orderedFields]);

  const setButtonRef = (field: string, which: MoveDirection) => (el: HTMLButtonElement | null) => {
    const entry = buttonRefs.current.get(field) ?? { up: null, down: null };
    entry[which] = el;
    buttonRefs.current.set(field, entry);
  };

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
    <Popover
      position="bottom-end"
      shadow="md"
      withinPortal
      // #79 — a click that closes the popover on a non-focusable area
      // otherwise drops focus to <body>. Mantine's own `useFocusReturn` only
      // restores when the element focused at close is still `null`/`<body>`/
      // itself, so a click on another control still keeps focus there. Safe
      // here only because nothing in this dropdown autofocuses on open —
      // Mantine captures its return target in a passive effect *after* open,
      // so an autofocused element would win that race (see
      // `ConnectionSwitcher`, which can't use this for that reason).
      returnFocus
      // The dropdown unmounts on close but `announcement` lives out here, so
      // without this the live region is reborn already holding the last
      // move's sentence. `aria-live` only announces mutations, never the
      // content a region mounts with, so that text is never spoken — it just
      // sits in the accessibility tree describing a move from last time.
      onChange={(opened) => { if (!opened) setAnnouncement(''); }}
    >
      <Popover.Target>
        <Button
          variant="default"
          size="compact-xs"
          rightSection={
            hiddenCount > 0 || (isTableView && computed.length > 0) ? (
              <Badge size="xs" variant="light" color="violet">
                {isTableView && computed.length > 0 ? `+${computed.length}` : hiddenCount}
              </Badge>
            ) : undefined
          }
        >
          Fields
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
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  aria-label={`Move ${field} up`}
                  disabled={index === 0}
                  ref={setButtonRef(field, 'up')}
                  onClick={() => requestMove(field, index, 'up')}
                >
                  {I.chevU}
                </ActionIcon>
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  aria-label={`Move ${field} down`}
                  disabled={index === orderedFields.length - 1}
                  ref={setButtonRef(field, 'down')}
                  onClick={() => requestMove(field, index, 'down')}
                >
                  {I.chevD}
                </ActionIcon>
              </div>
            ))}
          </Stack>
        )}
        {/* `aria-live`: announces a keyboard reorder's result, which is
            otherwise silent to anyone not watching the list (#57). */}
        <VisuallyHidden aria-live="polite">{announcement}</VisuallyHidden>

        {/* Computed columns only feed TableView's rendering — meaningless
            in Tree/JSON, so the whole section (list + add form) is Table-only. */}
        {isTableView && (
          <>
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
          </>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
