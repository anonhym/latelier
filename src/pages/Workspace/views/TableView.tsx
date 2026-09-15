import React from 'react';
import { notify } from '../../../theme/notifications';
import {
  List,
  useDynamicRowHeight,
  type RowComponentProps,
} from 'react-window';
import { Popover } from '@mantine/core';
import { I } from '../../../icons';
import { isRecord, toDisplayValue, valueToClipboardText } from '../../../utils/displayValue';
import { ownGet, ownSet } from '../../../utils/ownProperty';
import {
  DRAGGED_FIELD_MIME,
  classifySort,
  condFromDragged,
  parseSortString,
  type DraggedField,
  type SortClass,
} from '../builder';
import type { ReferenceRule, TableColumnConfig } from '@shared/types';
import { ReferenceChip } from '../../../features/references/ReferenceChip';
import { confirmDestructive } from '../../../utils/confirm';
import { copyToClipboard } from '../../../utils/clipboard';
import { useCollectionWorkspace } from '../context';
import { insertAt, parseFilter, printFilter } from '../filterTree';
import { useResultSelection } from '../resultSelection';
import { DocFieldTree } from './DocFieldTree';
import { getFullDocId, isInlineEditable } from './docId';
import {
  deriveColumns,
  resolveColumns,
  getValueAtPath,
  type ResolvedColumn,
} from './tableColumns';

interface TableViewProps {
  documents: unknown[];
  /** Per-column width overrides, keyed by field. Falls back to 200px for `_id`, 160px otherwise. */
  columns?: Record<string, { width: number }>;
  columnConfig?: TableColumnConfig;
  onColumnResize: (field: string, width: number) => void;
  /** Click-to-sort cycle (asc → desc → off); omit to disable (e.g. read-only result views). */
  onSortField?: (field: string) => void;
  /** Current sort EJSON string — drives the ↑/↓ indicator in the header. */
  sort?: string;
  /** Per-row expand state, keyed by docId — shared with the Tree view. */
  expandedRows?: Record<string, boolean>;
  onRowExpand?: (docId: string, expanded: boolean) => void;
  refsByField?: Map<string, ReferenceRule>;
  onRefHover?: (rule: ReferenceRule, value: unknown, rect: DOMRect) => void;
  onRefHoverLeave?: () => void;
  onRefOpen?: (rule: ReferenceRule, field: string, value: unknown) => void;
}

// Kept independent of the data columns — the column chooser can hide/reorder
// any derived field including `_id`, so the expand control can't live in a data cell.
const GUTTER_WIDTH = 28;

const EMPTY_EXPANDED_ROWS: Record<string, boolean> = {};

/**
 * The table-level sort slot in the gutter header, covering sort states the
 * per-column ↑/↓ arrows can't draw: partial, hidden (drawable but the column
 * is hidden), absent (excluded from the projection), unrepresentable (no
 * mappable key), and invalid (won't run). `'none'`/`'mapped'` need no note —
 * the arrows already tell the truth for those.
 */
const SORT_NOTE: Partial<Record<SortClass, { glyph: string; text: string; warn: boolean }>> = {
  partial: {
    glyph: '↕',
    text: 'Sorted — some of the sort fields cannot be shown in this header',
    warn: false,
  },
  hidden: {
    glyph: '↕',
    text: 'Sorted by a hidden column — show it again to see the direction',
    warn: false,
  },
  absent: {
    glyph: '↕',
    text: 'Sorted by a field that is not one of these columns',
    warn: false,
  },
  unrepresentable: {
    glyph: '↕',
    text: 'Sorted by a rule this header cannot show',
    warn: false,
  },
  invalid: {
    glyph: '!',
    text: 'The sort is not valid — this query will not run',
    warn: true,
  },
};

interface TableCellProps {
  value: unknown;
  /** Dotted path or plain field name — drag payload, title, "Copy field path". */
  fieldPath: string;
  /** Inline-edit eligibility, computed by the caller since only it knows `col.kind`
   * (a computed accessor column's `fieldPath` is a display label, not a real `$set` target). */
  editable: boolean;
  /** The row's document, needed to build the `{_id}` filter for inline-edit writes. */
  doc: unknown;
  width: number;
  cellKey: string;
  isCopied: boolean;
  rule?: ReferenceRule;
  onCopyCell: (text: string, cellKey: string) => void;
  onContextMenu: (
    e: React.MouseEvent,
    payload: { field: string | null; value: unknown; hasValue: boolean },
  ) => void;
  onRefHover?: (rule: ReferenceRule, value: unknown, rect: DOMRect) => void;
  onRefHoverLeave?: () => void;
  onRefOpen?: (rule: ReferenceRule, field: string, value: unknown) => void;
}

/**
 * A single Table cell. Owns its own hover/popover-open/inline-edit state for
 * the click-to-expand (AC5) and inline-edit (T2.6) affordances — kept local
 * rather than lifted into `TableRow`'s props so hovering/editing one cell
 * doesn't invalidate the row's memo comparator for every other cell in the
 * row. Reads `actions`/`meta` straight off the workspace context (rather
 * than threading them through `TableRowProps`) for the same reason.
 */
function TableCell({
  value,
  fieldPath,
  editable,
  doc,
  width,
  cellKey,
  isCopied,
  rule,
  onCopyCell,
  onContextMenu,
  onRefHover,
  onRefHoverLeave,
  onRefOpen,
}: TableCellProps) {
  const { actions, meta } = useCollectionWorkspace();
  const dv = toDisplayValue(value);
  const display = dv.display;
  const draggable = value !== undefined;
  const [hovered, setHovered] = React.useState(false);
  const [expandOpen, setExpandOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const commitGuardRef = React.useRef(false);

  // Index-virtualization rebinds this same TableCell instance to a different
  // document when the array swaps mid-edit; without cancelling here, the
  // trailing unmount-blur would commit the stale draft onto the wrong document.
  const [prevDoc, setPrevDoc] = React.useState(doc);
  if (prevDoc !== doc) {
    setPrevDoc(doc);
    if (editing) {
      // eslint-disable-next-line react-hooks/refs
      commitGuardRef.current = true;
      setEditing(false);
      setDraft('');
    }
  }

  const affordanceVisible = hovered || expandOpen;

  const canInlineEdit = editable && !meta.isReadOnly && typeof actions.updateField === 'function';

  const startEdit = () => {
    setDraft(typeof value === 'string' ? value : '');
    commitGuardRef.current = false;
    setEditing(true);
  };
  const cancelEdit = () => {
    // Unmounting a focused element fires a trailing real-browser blur (jsdom
    // doesn't reproduce it) that would otherwise commit the cancelled draft.
    commitGuardRef.current = true;
    setEditing(false);
  };
  // Guarded against a double-fire: Enter's setEditing(false) unmounts the
  // input, and the browser also emits a blur for the same interaction.
  const commitEdit = () => {
    if (commitGuardRef.current) return;
    commitGuardRef.current = true;
    setEditing(false);
    if (draft === value) return; // unchanged — AC: no IPC call
    actions.updateField?.(doc, fieldPath, draft);
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    const payload: DraggedField = { field: fieldPath, value };
    e.dataTransfer.setData(DRAGGED_FIELD_MIME, JSON.stringify(payload));
    e.dataTransfer.setData(
      'text/plain',
      typeof value === 'string' ? value : JSON.stringify(value),
    );
    e.dataTransfer.effectAllowed = 'copy';
    e.stopPropagation();
  };

  return (
    <div
      draggable={draggable && !editing}
      onDragStart={draggable && !editing ? handleDragStart : undefined}
      onDoubleClick={(e) => {
        if (!draggable || editing) return;
        e.stopPropagation();
        onCopyCell(valueToClipboardText(value), cellKey);
      }}
      onContextMenu={(e) => {
        if (editing) return;
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e, { field: fieldPath, value, hasValue: draggable });
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width,
        minWidth: width,
        maxWidth: width,
        position: 'relative',
        borderBottom: '1px solid var(--atelier-border)',
        borderRight: '1px solid var(--atelier-border)',
        padding: '4px 8px',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
        cursor: draggable ? 'grab' : 'default',
        background: isCopied ? 'var(--atelier-accent)' : undefined,
        transition: 'background 120ms',
        color: isCopied
          ? '#fff'
          : dv.type === 'null' || dv.type === 'undefined'
          ? 'var(--atelier-text-ghost)'
          : dv.type === 'boolean'
          ? 'var(--atelier-warn)'
          : dv.type === 'number' || dv.type === 'long' || dv.type === 'decimal'
          ? 'var(--atelier-color-number)'
          : 'var(--atelier-text)',
        textAlign: isCopied ? 'center' : 'left',
        fontWeight: isCopied ? 600 : 400,
        boxSizing: 'border-box',
      }}
      title={
        draggable
          ? `Drag to add "${fieldPath} $eq …" to builder · double-click to copy`
          : undefined
      }
    >
      {editing ? (
        <input
          autoFocus
          aria-label={`Edit ${fieldPath}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              commitEdit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              cancelEdit();
            }
          }}
          onBlur={commitEdit}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
          draggable={false}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            fontFamily: 'inherit',
            fontSize: 'inherit',
            color: 'var(--atelier-text)',
            background: 'var(--atelier-surface)',
            border: '1px solid var(--atelier-accent)',
            borderRadius: 2,
            padding: '0 2px',
            outline: 'none',
          }}
        />
      ) : isCopied ? (
        '✓ Copied'
      ) : rule ? (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            maxWidth: '100%',
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
              flexShrink: 1,
            }}
          >
            {String(display)}
          </span>
          <ReferenceChip
            rule={rule}
            onHover={(rect) => onRefHover?.(rule, value, rect)}
            onLeave={() => onRefHoverLeave?.()}
            onClick={() => onRefOpen?.(rule, fieldPath, value)}
          />
        </span>
      ) : (
        String(display)
      )}

      {/* T2.6 — inline single-field edit: hover-revealed pencil turns the
          cell into a text input. Own stopPropagation so it doesn't steal
          row-select / drag / dblclick-copy / contextmenu, matching the
          expand affordance below. Gated on `canInlineEdit` (string values on
          a real field column, not a computed accessor or `_id`, and never
          on a read-only workspace) so a sentinel-typed or computed cell
          can't be silently corrupted via `$set`. */}
      {canInlineEdit && !editing && (
        <button
          aria-label="Edit cell value"
          onClick={(e) => {
            e.stopPropagation();
            startEdit();
          }}
          style={{
            position: 'absolute',
            right: 20,
            top: '50%',
            transform: 'translateY(-50%)',
            opacity: affordanceVisible ? 1 : 0,
            pointerEvents: affordanceVisible ? 'auto' : 'none',
            width: 16,
            height: 16,
            padding: 0,
            border: 'none',
            borderRadius: 3,
            background: 'var(--atelier-surface-raised)',
            color: 'var(--atelier-text-ghost)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {I.edit}
        </button>
      )}

      {/* AC5 — click-to-expand: hover-revealed affordance opens a
          read-only popover with the untruncated value. Doesn't steal
          row-select / drag / dblclick-copy / contextmenu (own
          stopPropagation, and pointer-events are off until hovered). */}
      {draggable && !editing && (
        <Popover
          opened={expandOpen}
          onChange={setExpandOpen}
          position="bottom-start"
          withinPortal
          shadow="md"
        >
          <Popover.Target>
            <button
              aria-label="Expand cell value"
              onClick={(e) => {
                e.stopPropagation();
                setExpandOpen(true);
              }}
              style={{
                position: 'absolute',
                right: 2,
                top: '50%',
                transform: 'translateY(-50%)',
                opacity: affordanceVisible ? 1 : 0,
                pointerEvents: affordanceVisible ? 'auto' : 'none',
                width: 16,
                height: 16,
                padding: 0,
                border: 'none',
                borderRadius: 3,
                background: 'var(--atelier-surface-raised)',
                color: 'var(--atelier-text-ghost)',
                cursor: 'pointer',
                fontSize: 10,
                lineHeight: '16px',
              }}
            >
              ⤢
            </button>
          </Popover.Target>
          <Popover.Dropdown>
            <div
              style={{
                maxWidth: 320,
                maxHeight: 240,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 11,
                color: 'var(--atelier-text)',
              }}
            >
              {dv.type === 'string' ? `"${display}"` : display}
            </div>
          </Popover.Dropdown>
        </Popover>
      )}
    </div>
  );
}

interface TableRowProps {
  documents: unknown[];
  columns: ResolvedColumn[];
  widths: Record<string, number>;
  indices: Set<number>;
  copiedCell: string | null;
  expandedRows: Record<string, boolean>;
  deepPaths: Set<string>;
  fieldCopiedPath: string | null;
  refsByField?: Map<string, ReferenceRule>;
  onSelect: (e: React.MouseEvent, idx: number) => void;
  onCopyCell: (text: string, cellKey: string) => void;
  onContextMenu: (
    e: React.MouseEvent,
    payload: {
      doc: unknown;
      field: string | null;
      value: unknown;
      hasValue: boolean;
    },
  ) => void;
  onRowExpand: (docId: string, expanded: boolean) => void;
  toggleDeepPath: (path: string) => void;
  handleCopyField: (path: string, value: unknown) => void;
  handleOpenFieldMenu: (e: React.MouseEvent, fieldPath: string, value: unknown) => void;
  onRefHover?: (rule: ReferenceRule, value: unknown, rect: DOMRect) => void;
  onRefHoverLeave?: () => void;
  onRefOpen?: (rule: ReferenceRule, field: string, value: unknown) => void;
}

function TableRowImpl({
  index,
  style,
  documents,
  columns,
  widths,
  indices,
  copiedCell,
  expandedRows,
  deepPaths,
  fieldCopiedPath,
  refsByField,
  onSelect,
  onCopyCell,
  onContextMenu,
  onRowExpand,
  toggleDeepPath,
  handleCopyField,
  handleOpenFieldMenu,
  onRefHover,
  onRefHoverLeave,
  onRefOpen,
}: RowComponentProps<TableRowProps>) {
  const doc = documents[index];
  const isSelected = indices.has(index);
  const docId = getFullDocId(doc);
  const isExpanded = !!ownGet(expandedRows, docId);

  return (
    <div
      data-selected={isSelected}
      style={{
        ...style,
        background: isSelected
          ? 'var(--atelier-accent-soft)'
          : index % 2 === 0
          ? 'var(--atelier-surface-raised)'
          : 'var(--atelier-surface)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          cursor: 'pointer',
          fontSize: 11,
          fontFamily: 'monospace',
        }}
        onClick={(e) => onSelect(e, index)}
      >
        {/* Fixed expand gutter — independent of the (hide/reorder-able)
            data columns. */}
        <div
          style={{
            width: GUTTER_WIDTH,
            minWidth: GUTTER_WIDTH,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderBottom: '1px solid var(--atelier-border)',
            borderRight: '1px solid var(--atelier-border)',
            boxSizing: 'border-box',
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRowExpand(docId, !isExpanded);
            }}
            aria-label={isExpanded ? 'Collapse document' : 'Expand document'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 20,
              padding: 0,
              background: 'none',
              border: 'none',
              color: 'var(--atelier-text-ghost)',
              cursor: 'pointer',
              flexShrink: 0,
              transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 120ms',
            }}
          >
            {I.chevD}
          </button>
        </div>

        {columns.map((col) => {
          const val =
            col.kind === 'field'
              ? isRecord(doc)
                ? doc[col.field]
                : undefined
              : isRecord(doc)
              ? getValueAtPath(doc, col.path)
              : undefined;
          const fieldPath = col.kind === 'field' ? col.field : col.label ?? col.path;
          const cellKey = `${index}:${col.field}`;
          const isCopied = copiedCell === cellKey;
          const width = ownGet(widths, col.field) ?? 160;
          const rule = val !== undefined ? refsByField?.get(fieldPath) : undefined;
          // T2.6 — restricted to real field columns: a computed accessor
          // column's `fieldPath` is a display label (or dotted path), never
          // a real document field, so it must never reach `$set`.
          const editable = col.kind === 'field' && isInlineEditable(val, fieldPath);

          return (
            <TableCell
              key={col.field}
              value={val}
              fieldPath={fieldPath}
              editable={editable}
              doc={doc}
              width={width}
              cellKey={cellKey}
              isCopied={isCopied}
              rule={rule}
              onCopyCell={onCopyCell}
              onContextMenu={(e, payload) => onContextMenu(e, { doc, ...payload })}
              onRefHover={onRefHover}
              onRefHoverLeave={onRefHoverLeave}
              onRefOpen={onRefOpen}
            />
          );
        })}
      </div>

      {/* Row expand (AC1/AC2) — the same recursive FIELD|VALUE|TYPE tree
          the Tree view renders, via the shared `DocFieldTree`. */}
      {isExpanded && isRecord(doc) && (
        <div
          data-expanded-doc-section="true"
          style={{
            padding: '0 0 10px 0',
            borderTop: '1px solid var(--atelier-border)',
            background: 'var(--atelier-surface)',
          }}
        >
          <DocFieldTree
            doc={doc}
            docId={docId}
            expandedPaths={deepPaths}
            onToggle={toggleDeepPath}
            copiedPath={fieldCopiedPath}
            onCopy={handleCopyField}
            onOpenMenu={handleOpenFieldMenu}
            refsByField={refsByField}
            onRefHover={onRefHover}
            onRefHoverLeave={onRefHoverLeave}
            onRefOpen={onRefOpen}
          />
        </div>
      )}
    </div>
  );
}

// Index-keyed comparator (selection/copy-flash are index-keyed here, unlike
// TreeView's docId-keyed `DocRow`); row-expand/deepPaths stay docId-scoped.
const TableRow = React.memo(TableRowImpl, (prev, next) => {
  if (prev.index !== next.index || prev.style !== next.style) return false;
  const prevDoc = prev.documents[prev.index];
  const nextDoc = next.documents[next.index];
  if (prevDoc !== nextDoc) return false;
  if (
    prev.columns !== next.columns ||
    prev.widths !== next.widths ||
    prev.refsByField !== next.refsByField ||
    prev.onSelect !== next.onSelect ||
    prev.onCopyCell !== next.onCopyCell ||
    prev.onContextMenu !== next.onContextMenu ||
    prev.onRowExpand !== next.onRowExpand ||
    prev.toggleDeepPath !== next.toggleDeepPath ||
    prev.handleCopyField !== next.handleCopyField ||
    prev.handleOpenFieldMenu !== next.handleOpenFieldMenu ||
    prev.onRefHover !== next.onRefHover ||
    prev.onRefHoverLeave !== next.onRefHoverLeave ||
    prev.onRefOpen !== next.onRefOpen
  ) {
    return false;
  }

  if (prev.indices.has(prev.index) !== next.indices.has(next.index)) return false;

  if (prev.copiedCell !== next.copiedCell) {
    const prefix = `${next.index}:`;
    const prevHere = prev.copiedCell?.startsWith(prefix) ?? false;
    const nextHere = next.copiedCell?.startsWith(prefix) ?? false;
    if (prevHere || nextHere) return false;
  }

  const docId = getFullDocId(nextDoc);
  if (ownGet(prev.expandedRows, docId) !== ownGet(next.expandedRows, docId)) return false;

  const isExpanded = !!ownGet(next.expandedRows, docId);
  if (isExpanded) {
    if (prev.fieldCopiedPath !== next.fieldCopiedPath) {
      const prefix = `${docId}::`;
      const prevHere = prev.fieldCopiedPath?.startsWith(prefix) ?? false;
      const nextHere = next.fieldCopiedPath?.startsWith(prefix) ?? false;
      if (prevHere || nextHere) return false;
    }
    if (prev.deepPaths !== next.deepPaths) {
      const prefix = `${docId}::`;
      for (const p of prev.deepPaths) {
        if (p.startsWith(prefix) && !next.deepPaths.has(p)) return false;
      }
      for (const p of next.deepPaths) {
        if (p.startsWith(prefix) && !prev.deepPaths.has(p)) return false;
      }
    }
  }

  return true;
});

export function TableView({
  documents,
  columns: columnsProp,
  columnConfig,
  onColumnResize,
  onSortField,
  sort,
  expandedRows: expandedRowsProp,
  onRowExpand,
  refsByField,
  onRefHover,
  onRefHoverLeave,
  onRefOpen,
}: TableViewProps) {
  const { state, actions, meta } = useCollectionWorkspace();
  const onEditDoc = actions.openEdit;
  const onDeleteDoc = actions.openDelete;
  const onDuplicateDoc = actions.openDuplicate;
  // Falls back to local state when rendered standalone (no provider mounted).
  const selection = useResultSelection(documents);
  const [contextMenu, setContextMenu] = React.useState<{
    x: number;
    y: number;
    doc: unknown;
    field: string | null;
    value: unknown;
    hasValue: boolean;
  } | null>(null);
  const [copiedCell, setCopiedCell] = React.useState<string | null>(null);

  // Badge, not toast — a toast per cell copy would be noise; a failed copy toasts instead.
  const copyCell = React.useCallback(
    (text: string, cellKey: string) => {
      void copyToClipboard(text).then((ok) => {
        if (!ok) return;
        setCopiedCell(cellKey);
        window.setTimeout(() => {
          setCopiedCell((prev) => (prev === cellKey ? null : prev));
        }, 600);
      });
    },
    [],
  );

  const expandedRows = React.useMemo(
    () => expandedRowsProp ?? EMPTY_EXPANDED_ROWS,
    [expandedRowsProp],
  );
  const handleRowExpand = React.useCallback(
    (docId: string, expanded: boolean) => {
      onRowExpand?.(docId, expanded);
    },
    [onRowExpand],
  );

  // Ephemeral, Table-local, reset when the document set changes (mirrors TreeView).
  const [deepPaths, setDeepPaths] = React.useState<Set<string>>(new Set());
  const [prevDocuments, setPrevDocuments] = React.useState<unknown[]>(documents);
  if (prevDocuments !== documents) {
    setPrevDocuments(documents);
    setDeepPaths(new Set());
  }
  const toggleDeepPath = React.useCallback((p: string) => {
    setDeepPaths((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }, []);

  const [fieldCopiedPath, setFieldCopiedPath] = React.useState<string | null>(null);
  const handleCopyField = React.useCallback((path: string, value: unknown) => {
    // Badge, not toast — same ruling as `copyCell` above.
    void copyToClipboard(valueToClipboardText(value)).then((ok) => {
      if (!ok) return;
      setFieldCopiedPath(path);
      window.setTimeout(() => {
        setFieldCopiedPath((prev) => (prev === path ? null : prev));
      }, 600);
    });
  }, []);

  const [fieldContextMenu, setFieldContextMenu] = React.useState<{
    x: number;
    y: number;
    fieldPath: string;
    value: unknown;
  } | null>(null);
  const handleOpenFieldMenu = React.useCallback(
    (e: React.MouseEvent, fieldPath: string, value: unknown) => {
      setFieldContextMenu({ x: e.clientX, y: e.clientY, fieldPath, value });
    },
    [],
  );

  // Menus disable up front when the filter bar's text doesn't parse, rather
  // than showing a toast on click.
  const filterBarValid = React.useMemo(() => parseFilter(state.queryRaw).ok, [state.queryRaw]);

  // Mirrors TreeView's handler. Confirms whenever the Filter drawer is open
  // (deliberate over-warn — it may hold newer local input this can't see).
  const handleAddToFilter = React.useCallback(
    async (fieldPath: string, value: unknown) => {
      if (state.activeBuilderTab === 'Builder') {
        const proceed = await confirmDestructive({
          title: 'Add to filter?',
          body: 'The filter drawer is open and may hold edits that haven\'t been applied yet. Adding this field will replace the drawer\'s content.',
          confirmLabel: 'Add',
        });
        if (!proceed) return;
      }
      const parsed = parseFilter(state.queryRaw);
      if (!parsed.ok) {
        notify.error("Nothing added — the filter bar's text isn't valid JSON.");
        return;
      }
      const nextRoot = insertAt(parsed.root, [], condFromDragged({ field: fieldPath, value }));
      const printed = printFilter(nextRoot);
      if (!printed.ok) {
        notify.error('Nothing added — the filter could not be updated.');
        return;
      }
      actions.expandBuilder?.();
      actions.patch({ queryRaw: printed.json });
    },
    [state.queryRaw, state.activeBuilderTab, actions],
  );
  React.useEffect(() => {
    if (!fieldContextMenu) return;
    const handler = () => setFieldContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [fieldContextMenu]);

  const derivedFields = React.useMemo(() => deriveColumns(documents), [documents]);
  const columns = React.useMemo(
    () => resolveColumns(derivedFields, columnConfig),
    [derivedFields, columnConfig],
  );
  const sortMap = React.useMemo(() => parseSortString(sort ?? ''), [sort]);
  // Excludes computed columns — a computed column named after a sort key
  // must not count as "drawn" and silence the note.
  const shownFields = React.useMemo(
    () => new Set(columns.filter((c) => c.kind === 'field').map((c) => c.field)),
    [columns],
  );
  // The derived list before `hidden` is applied, so an excluded-by-projection
  // key reads "absent" rather than a chooser-unreachable "hidden".
  const schemaFields = React.useMemo(() => new Set(derivedFields), [derivedFields]);
  const sortNote = SORT_NOTE[classifySort(sort ?? '', shownFields, schemaFields)];
  const multiFieldSort = Object.keys(sortMap).length > 1;

  // Tracks the cursor on every mousemove, committed to the parent only on
  // mouseup — every-pixel commits would re-render the whole workspace tree at ~60fps.
  const [liveDrag, setLiveDrag] = React.useState<{ field: string; width: number } | null>(null);

  const propWidth = React.useCallback(
    (field: string) => columnsProp?.[field]?.width ?? (field === '_id' ? 200 : 160),
    [columnsProp],
  );
  const getWidth = React.useCallback(
    (field: string) =>
      liveDrag && liveDrag.field === field ? liveDrag.width : propWidth(field),
    [liveDrag, propWidth],
  );

  const widths = React.useMemo(() => {
    const out: Record<string, number> = {};
    for (const col of columns) ownSet(out, col.field, getWidth(col.field));
    return out;
  }, [columns, getWidth]);
  const totalWidth = React.useMemo(
    () => GUTTER_WIDTH + columns.reduce((sum, c) => sum + (ownGet(widths, c.field) ?? 160), 0),
    [columns, widths],
  );

  const dragState = React.useRef<{
    field: string;
    startX: number;
    startW: number;
  } | null>(null);

  const handleResizeMouseDown = (e: React.MouseEvent, field: string) => {
    e.preventDefault();
    e.stopPropagation();
    const startW = propWidth(field);
    dragState.current = {
      field,
      startX: e.clientX,
      startW,
    };
    setLiveDrag({ field, width: startW });

    const onMove = (me: MouseEvent) => {
      if (!dragState.current) return;
      const delta = me.clientX - dragState.current.startX;
      const newWidth = Math.max(60, dragState.current.startW + delta);
      setLiveDrag({ field: dragState.current.field, width: newWidth });
    };

    const onUp = () => {
      const finished = dragState.current;
      dragState.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (finished) {
        // Functional setter to read the final value without a stale closure.
        setLiveDrag((current) => {
          if (current && current.field === finished.field) {
            onColumnResize(finished.field, current.width);
          }
          return null;
        });
      } else {
        setLiveDrag(null);
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  React.useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [contextMenu]);

  // Plain click: single-row highlight (click again to deselect). ⌘/Ctrl+click
  // toggles the row into/out of a multi-row selection for the bulk-action bar.
  const handleSelect = React.useCallback(
    (e: React.MouseEvent, idx: number) => {
      if (e.metaKey || e.ctrlKey) selection.toggle(idx);
      else selection.selectOnly(idx);
    },
    [selection],
  );

  const handleContextMenu = React.useCallback(
    (
      e: React.MouseEvent,
      payload: {
        doc: unknown;
        field: string | null;
        value: unknown;
        hasValue: boolean;
      },
    ) => {
      setContextMenu({ x: e.clientX, y: e.clientY, ...payload });
    },
    [],
  );

  // Row-expand makes rows variable-height; measure each rendered row rather
  // than assuming a fixed height (mirrors TreeView).
  const rowHeight = useDynamicRowHeight({ defaultRowHeight: 24 });

  const rowProps = React.useMemo<TableRowProps>(
    () => ({
      documents,
      columns,
      widths,
      indices: selection.indices,
      copiedCell,
      expandedRows,
      deepPaths,
      fieldCopiedPath,
      refsByField,
      onSelect: handleSelect,
      onCopyCell: copyCell,
      onContextMenu: handleContextMenu,
      onRowExpand: handleRowExpand,
      toggleDeepPath,
      handleCopyField,
      handleOpenFieldMenu,
      onRefHover,
      onRefHoverLeave,
      onRefOpen,
    }),
    [
      documents,
      columns,
      widths,
      selection.indices,
      copiedCell,
      expandedRows,
      deepPaths,
      fieldCopiedPath,
      refsByField,
      handleSelect,
      copyCell,
      handleContextMenu,
      handleRowExpand,
      toggleDeepPath,
      handleCopyField,
      handleOpenFieldMenu,
      onRefHover,
      onRefHoverLeave,
      onRefOpen,
    ],
  );

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowX: 'auto',
        overflowY: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      {/* Header — sits above the List inside the same horizontal scroll
          container so columns stay aligned when the user scrolls right. */}
      <div
        style={{
          display: 'flex',
          background: 'var(--atelier-surface)',
          minWidth: totalWidth,
          flexShrink: 0,
          position: 'sticky',
          top: 0,
          zIndex: 1,
        }}
      >
        {/* Gutter — keeps the header aligned with the body's fixed expand
            column, and hosts the table-level sort note. */}
        <div
          style={{
            width: GUTTER_WIDTH,
            minWidth: GUTTER_WIDTH,
            flexShrink: 0,
            borderBottom: '1px solid var(--atelier-border)',
            borderRight: '1px solid var(--atelier-border)',
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {sortNote && (
            <span
              role="img"
              aria-label={sortNote.text}
              title={sortNote.text}
              data-testid="table-header-sort-note"
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: sortNote.warn ? 'var(--atelier-warn)' : 'var(--atelier-accent)',
              }}
            >
              {sortNote.glyph}
            </span>
          )}
        </div>
        {columns.map((col) => {
          const w = ownGet(widths, col.field) ?? 160;
          const sortable = !!onSortField && col.kind === 'field';
          const dir = col.kind === 'field' ? ownGet(sortMap, col.field) : undefined;
          const indicator = dir === 1 ? '↑' : dir === -1 ? '↓' : null;
          const label = col.kind === 'field' ? col.field : col.label ?? col.path;
          return (
            <div
              key={col.field}
              onClick={
                sortable
                  ? (e) => {
                      // Ignore clicks that started on the resize gutter
                      // (the resize-handle child stops propagation, but be
                      // defensive against drift between dev/test envs).
                      if ((e.target as HTMLElement).dataset.resizeHandle === '1') return;
                      onSortField?.(col.field);
                    }
                  : undefined
              }
              title={
                sortable
                  ? (dir === 1
                      ? `Sorted ascending — click for descending`
                      : dir === -1
                        ? `Sorted descending — click to clear`
                        : `Click to sort by ${label}`) +
                    (multiFieldSort
                      ? ' (replaces the whole multi-field sort — edit it in the query bar’s sort field)'
                      : '')
                  : col.kind === 'computed'
                    ? label
                    : undefined
              }
              data-testid={`table-header-${col.field}`}
              style={{
                width: w,
                minWidth: w,
                maxWidth: w,
                borderBottom: '1px solid var(--atelier-border)',
                borderRight: '1px solid var(--atelier-border)',
                padding: '5px 8px',
                textAlign: 'left',
                fontWeight: 600,
                color: dir ? 'var(--atelier-accent)' : 'var(--atelier-text-muted)',
                fontSize: 11,
                position: 'relative',
                userSelect: 'none',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                boxSizing: 'border-box',
                cursor: sortable ? 'pointer' : 'default',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </span>
              {indicator && (
                <span
                  aria-label={dir === 1 ? 'sorted ascending' : 'sorted descending'}
                  style={{ fontSize: 10, color: 'var(--atelier-accent)', flexShrink: 0 }}
                >
                  {indicator}
                </span>
              )}
              <div
                data-resize-handle="1"
                onMouseDown={(e) => handleResizeMouseDown(e, col.field)}
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 0,
                  bottom: 0,
                  width: 5,
                  cursor: 'col-resize',
                  background: 'transparent',
                }}
              />
            </div>
          );
        })}
      </div>

      <List<TableRowProps>
        rowComponent={TableRow as typeof TableRowImpl}
        rowCount={documents.length}
        rowHeight={rowHeight}
        rowProps={rowProps}
        overscanCount={8}
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: totalWidth,
        }}
      />

      {/* Cell-level context menu (doc-aware — Edit/Delete included). */}
      {contextMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            background: 'var(--atelier-surface)',
            border: '1px solid var(--atelier-border-med)',
            borderRadius: 'var(--atelier-radius-sm)',
            boxShadow: 'var(--atelier-shadow)',
            zIndex: 1000,
            minWidth: 160,
            padding: '4px 0',
          }}
        >
          {contextMenu.hasValue && contextMenu.field && (
            <button
              onClick={() => {
                void copyToClipboard(
                  valueToClipboardText(contextMenu.value),
                  'Value copied to the clipboard.',
                );
                setContextMenu(null);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 12px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                color: 'var(--atelier-text)',
              }}
            >
              Copy value
            </button>
          )}
          {contextMenu.field && (
            <button
              onClick={() => {
                void copyToClipboard(
                  contextMenu.field ?? '',
                  'Field name copied to the clipboard.',
                );
                setContextMenu(null);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 12px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                color: 'var(--atelier-text)',
              }}
            >
              Copy field path
            </button>
          )}
          {/* Parity with the field-level menu below: same
              `!meta.isReadOnly && value !== undefined` gate (`hasValue` is
              exactly that check, computed alongside `draggable`). This menu
              has no expand-first step, so it's arguably the more
              discoverable of the two surfaces for the same action. */}
          {!meta.isReadOnly && contextMenu.hasValue && contextMenu.field && (
            <button
              disabled={!filterBarValid}
              onClick={() => {
                void handleAddToFilter(contextMenu.field!, contextMenu.value);
                setContextMenu(null);
              }}
              title={filterBarValid ? undefined : "The filter bar's text isn't valid JSON"}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 12px',
                background: 'none',
                border: 'none',
                cursor: filterBarValid ? 'pointer' : 'not-allowed',
                fontSize: 12,
                color: filterBarValid ? 'var(--atelier-text)' : 'var(--atelier-text-muted)',
              }}
            >
              Add to filter
            </button>
          )}
          {contextMenu.field && (
            <div
              style={{
                height: 1,
                background: 'var(--atelier-border)',
                margin: '4px 0',
              }}
            />
          )}
          <button
            onClick={() => {
              onEditDoc(contextMenu.doc);
              setContextMenu(null);
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '6px 12px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              color: 'var(--atelier-text)',
            }}
          >
            Edit
          </button>
          {/* T2.6 — omitted for read-only providers (preview/snapshot,
              ScriptTab's synthetic result provider), which either set
              `meta.isReadOnly` or simply don't wire `openDuplicate`. */}
          {!meta.isReadOnly && onDuplicateDoc && (
            <button
              onClick={() => {
                onDuplicateDoc(contextMenu.doc);
                setContextMenu(null);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 12px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                color: 'var(--atelier-text)',
              }}
            >
              Duplicate document
            </button>
          )}
          <button
            onClick={() => {
              onDeleteDoc(contextMenu.doc);
              setContextMenu(null);
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '6px 12px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              color: 'var(--atelier-red)',
            }}
          >
            Delete
          </button>
        </div>
      )}

      {/* Field-level context menu — from inside an expanded row's
          DocFieldTree panel. Mirrors TreeView's (Copy value / Copy field
          path only — no Edit/Delete, matching the Tree view's nested-field
          menu). */}
      {fieldContextMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: fieldContextMenu.y,
            left: fieldContextMenu.x,
            background: 'var(--atelier-surface)',
            border: '1px solid var(--atelier-border-med)',
            borderRadius: 'var(--atelier-radius-sm)',
            boxShadow: 'var(--atelier-shadow)',
            zIndex: 1000,
            minWidth: 160,
            padding: '4px 0',
          }}
        >
          {fieldContextMenu.value !== undefined && (
            <button
              onClick={() => {
                void copyToClipboard(
                  valueToClipboardText(fieldContextMenu.value),
                  'Value copied to the clipboard.',
                );
                setFieldContextMenu(null);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 12px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                color: 'var(--atelier-text)',
              }}
            >
              Copy value
            </button>
          )}
          <button
            onClick={() => {
              void copyToClipboard(
                fieldContextMenu.fieldPath,
                'Field name copied to the clipboard.',
              );
              setFieldContextMenu(null);
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '6px 12px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              color: 'var(--atelier-text)',
            }}
          >
            Copy field path
          </button>
          {!meta.isReadOnly && fieldContextMenu.value !== undefined && (
            <button
              disabled={!filterBarValid}
              onClick={() => {
                void handleAddToFilter(fieldContextMenu.fieldPath, fieldContextMenu.value);
                setFieldContextMenu(null);
              }}
              title={filterBarValid ? undefined : "The filter bar's text isn't valid JSON"}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 12px',
                background: 'none',
                border: 'none',
                cursor: filterBarValid ? 'pointer' : 'not-allowed',
                fontSize: 12,
                color: filterBarValid ? 'var(--atelier-text)' : 'var(--atelier-text-muted)',
              }}
            >
              Add to filter
            </button>
          )}
        </div>
      )}
    </div>
  );
}
