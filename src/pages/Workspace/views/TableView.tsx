import React from 'react';
import { notify } from '../../../theme/notifications';
import {
  List,
  useDynamicRowHeight,
  useListRef,
  type RowComponentProps,
} from 'react-window';
import { useRovingFocus } from '../../../hooks/useRovingFocus';
import { useMenuFocus } from '../../../hooks/useMenuFocus';
import { isContextMenuKey, anchorForRow } from '../../../utils/contextMenuKey';
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
import { DocFieldTree, type FieldMenuOpenPayload } from './DocFieldTree';
import { getFullDocId, isInlineEditable } from './docId';
import {
  deriveColumns,
  resolveColumns,
  getValueAtPath,
  ariaSortFor,
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
 * rather than lifted into `TableRowImpl`'s props, since none of it is
 * needed outside this one cell. Reads `actions`/`meta` straight off the
 * workspace context (rather than threading them through `TableRowProps`)
 * for the same reason.
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
  const [focused, setFocused] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const commitGuardRef = React.useRef(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

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

  // #53 — WCAG 2.4.11: hover alone leaves a Tab'd-to affordance invisible.
  // `onFocus`/`onBlur` here (React routes both through native `focusin`/
  // `focusout`, which bubble) act like CSS `:focus-within` on this cell —
  // real CSS was tried first and rejected for a narrower reason than an
  // earlier version of this comment claimed. jsdom's `getComputedStyle` *does*
  // apply stylesheet rules — a probe in this project's own component project
  // returned the stylesheet's value, not the CSS default. What it does not
  // reflect is dynamic pseudo-class state: with `.cell:focus-within .aff
  // { opacity: 1 }` mounted and the button focused, `cell.matches
  // (':focus-within')` is `true` while `getComputedStyle(btn).opacity` stays
  // at the unfocused value. So a `:focus-within` fix would be unverifiable by
  // the component tests this project requires. React's inline `style` prop
  // cannot express a pseudo-class either, and this file uses no stylesheet, so
  // the CSS route would also mean introducing a styling mechanism for one cell.
  const affordanceVisible = hovered || expandOpen || focused;

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

  // S9379 — an `autoFocus` attribute is a Sonar finding regardless of intent;
  // this is the same "focus the input once it mounts" behaviour without it.
  // Only runs when `editing` flips true, which only happens from the user's
  // own pencil click, so it never steals focus mid-typing elsewhere.
  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

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
      // Part of the grid: `gridcell` is what makes the row's `role="row"`
      // valid, and unlike `option` it is free to hold the drag, copy and
      // inline-edit controls this cell owns.
      role="gridcell"
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
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
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
        // #83 — keep the flash inside the padding: the #60 active-row outline is the
        // same accent, inset 2px, and would vanish into a full-cell flash.
        backgroundClip: isCopied ? 'content-box' : undefined,
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
          ref={inputRef}
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
          // #79 — without this, closing on a click outside a focusable
          // element drops focus to <body>. Safe here because this dropdown
          // has no focusable content to autofocus (see `ColumnChooser`'s
          // comment for why an autofocus would break this).
          returnFocus
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
  /**
   * #60 — the row `useRovingFocus`'s `highlightIndex` currently names, or
   * `-1` when the grid doesn't have focus. Compared against a row's own
   * `index` to decide whether it paints the active-row outline — a
   * different channel from `indices` (selection), so a row can be active,
   * selected, both, or neither, and each combination reads distinctly.
   */
  activeIndex: number;
  copiedCell: string | null;
  expandedRows: Record<string, boolean>;
  deepPaths: Set<string>;
  fieldCopiedPath: string | null;
  refsByField?: Map<string, ReferenceRule>;
  // Widened from React.MouseEvent so a keyboard Enter/Space on the row can
  // drive the same selection logic as a click — both event types carry
  // metaKey/ctrlKey, which is all this reads.
  onSelect: (e: { metaKey: boolean; ctrlKey: boolean }, idx: number) => void;
  // #20 — stable per-row DOM id so the grid's `aria-activedescendant` (set
  // by `useRovingFocus` in the component below) always names a real element.
  rowId: (index: number) => string;
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
  handleOpenFieldMenu: (payload: FieldMenuOpenPayload) => void;
  onRefHover?: (rule: ReferenceRule, value: unknown, rect: DOMRect) => void;
  onRefHoverLeave?: () => void;
  onRefOpen?: (rule: ReferenceRule, field: string, value: unknown) => void;
}

// `ariaAttributes` is intentionally not destructured off the row props.
// react-window offers `role="listitem"` + posinset/setsize to pair with the
// `role="list"` it puts on its own container; this table is a grid, and a
// `listitem` between the grid and its rows would break the rows' ownership.
function TableRowImpl({
  index,
  style,
  documents,
  columns,
  widths,
  indices,
  activeIndex,
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
  rowId,
}: RowComponentProps<TableRowProps>) {
  const doc = documents[index];
  const isSelected = indices.has(index);
  const isActive = index === activeIndex;
  const docId = getFullDocId(doc);
  const isExpanded = !!ownGet(expandedRows, docId);

  return (
    <div
      // No role here on purpose — see the note on this function's props. The
      // grid's row and index attributes are set on the strip below.
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
      {/* S6848 — this strip behaves like a selectable row (click selects,
          ⌘/Ctrl+click multi-selects) while wrapping other real interactive
          controls: draggable cells, the expand chevron, the edit affordances.
          `role="option"` was the first attempt and was wrong: `option` is
          "children presentational" in ARIA, so it may not contain any of
          those, and it needs a `listbox` parent this never had.

          `row` inside `role="grid"` is the pattern for exactly this — a data
          table whose cells hold controls. `row` is not children
          presentational, so the cell controls stay exposed, and
          `aria-selected` is valid on it. `aria-rowindex` is 1-based and
          counts the header, so the first document row is 2.

          No `tabIndex` at all: a plain `div` with none is already out of
          both the Tab order AND click-focusable — #20 originally left
          `tabIndex={-1}` here on the theory that only *sequential* focus
          needed excluding, but the HTML focusing-steps algorithm treats any
          declared `tabIndex` (negative included) as making the element
          focusable via a real click, which review caught: clicking a row
          left real DOM focus sitting on it, so the next Arrow/Home/End
          reached the grid's `onKeyDown` with `e.target` = this row instead
          of the grid itself, and its own-target guard swallowed every one
          of them. Removing it lets a click's focusing steps walk up to the
          nearest focusable ancestor instead, which is the grid — exactly
          where #20's design already wanted real focus to live. The grid's
          `aria-activedescendant` (set in `TableView` below) still points at
          this row via its `id`; `handleSelect` also moves the roving index
          here on click, so a click and the next Arrow agree on which row is
          active. */}
      <div
        id={rowId(index)}
        role="row"
        aria-rowindex={index + 2}
        aria-selected={isSelected}
        style={{
          display: 'flex',
          alignItems: 'stretch',
          cursor: 'pointer',
          fontSize: 11,
          fontFamily: 'monospace',
          // #60 — sighted-visible counterpart to `aria-activedescendant`.
          // An inset outline (paints on top, reserves no layout space) so it
          // never shifts the row, and it's a different channel from the
          // selected background above it, so active-and-selected still
          // reads as both.
          outline: isActive ? '2px solid var(--atelier-accent)' : undefined,
          outlineOffset: isActive ? '-2px' : undefined,
        }}
        onClick={(e) => onSelect(e, index)}
      >
        {/* Fixed expand gutter — independent of the (hide/reorder-able)
            data columns. A `gridcell` like the rest, so the row owns nothing
            but cells. */}
        <div
          role="gridcell"
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

      {/* Row expand (AC1/AC2) — the same recursive FIELD|VALUE|TYPE tree the
          Tree view renders, via the shared `DocFieldTree`, which owns its
          own `role="tree"`/`data-expanded-doc-section` wrapper and (#20)
          its own roving-focus tab stop. */}
      {isExpanded && isRecord(doc) && (
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
      )}
    </div>
  );
}

// X19 #82 — this used to be `React.memo(TableRowImpl, comparator)` with a
// careful index-keyed comparator (selection, copy-flash, expansion, #60
// active row). Deleted: none of it ever ran. react-window's `List` rebuilds
// its row array in a `useMemo` keyed on `rowProps` and hands every rebuilt
// row a brand-new inline `style` object, so the comparator's mandatory
// `prev.style !== next.style` top guard returned `false` for every mounted
// row, every time — the rest of the comparator body was unreachable. See
// #82 for the full writeup and the render-count probe that confirmed it.
//
// Measured before deleting, not guessed. Method: a prod build, 500 seeded
// docs (8 fields), a 1280x800 window, 28 mounted rows x 10 columns; an
// ArrowDown/ArrowUp keydown dispatched in-page and timed to the target
// row's own `style` mutation via a `MutationObserver` plus a forced layout
// read, alternating Down/Up so the mounted set stays constant, n=60-120
// samples per run (throwaway e2e probe, deleted after use). Result: median
// 5.3-5.5ms; p95 ranged 7.2-9.4ms across repeated runs — close to half a
// 60Hz frame (8.3ms), not comfortably clear of it. Page size (default vs.
// 500) didn't move the number: react-window only mounts what's in the
// viewport, so rows-in-view x columns drives cost, not total row count.
// Deleting is still the right call on this measurement — the median has
// headroom, and TreeView (below) clears the threshold by an order of
// magnitude on the same rig — but this one is a judgment call, not a clean
// pass. If TableView picks up materially more columns or heavier cells,
// re-measure before assuming the margin still holds; a value-based `style`
// comparison measured 0.8ms median / 1.4ms p95 in the same conditions and
// is the fallback if it doesn't. Every mounted row re-rendering today is
// also what makes selection, copy-flash, expansion, and #60's active-row
// outline repaint; removing the memo is a no-op on behaviour, just honest
// about it.

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
    // #55/#69 — set by both open paths now, so Escape/click-away always has
    // somewhere to send focus back to instead of stranding it on `<body>`.
    returnFocusTo?: HTMLElement | null;
    // #69 — grabbing focus *into* the menu on open stays keyboard-only; see
    // `useMenuFocus`'s docstring for why `returnFocusTo` alone isn't enough
    // to decide that.
    focusMenuOnOpen?: boolean;
  } | null>(null);
  const cellMenuRef = React.useRef<HTMLDivElement | null>(null);
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
    // #68/#69 — same split as the cell menu above: `returnFocusTo` is set on
    // both the mouse and keyboard open paths (`DocFieldTree` injects it),
    // `focusMenuOnOpen` only on the keyboard one.
    returnFocusTo?: HTMLElement | null;
    focusMenuOnOpen?: boolean;
  } | null>(null);
  const fieldMenuRef = React.useRef<HTMLDivElement | null>(null);
  const handleOpenFieldMenu = React.useCallback(
    ({ anchor, fieldPath, value, returnFocusTo, focusMenuOnOpen }: FieldMenuOpenPayload) => {
      setFieldContextMenu({ ...anchor, fieldPath, value, returnFocusTo, focusMenuOnOpen });
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
  const closeFieldContextMenu = React.useCallback(() => setFieldContextMenu(null), []);
  useMenuFocus(fieldMenuRef, fieldContextMenu, closeFieldContextMenu);

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

  const closeContextMenu = React.useCallback(() => setContextMenu(null), []);
  useMenuFocus(cellMenuRef, contextMenu, closeContextMenu);

  // #20 — the grid is the widget's single tab stop; `useRovingHighlight`
  // (via `useRovingFocus`) owns which row is "active" and this wires it to
  // the DOM: a stable `id` per row (set in `TableRowImpl` above) named by the
  // grid's `aria-activedescendant`, kept in sync with react-window's
  // mounted range by scrolling to the row in the same key handler that
  // moves the index — see `useRovingFocus`'s own docstring for why that has
  // to be one operation, not two. Declared before `handleSelect` below,
  // which needs `roving.setActiveIndex`.
  const listRef = useListRef(null);
  const roving = useRovingFocus({
    count: documents.length,
    idPrefix: 'table-row-',
    resetKey: documents,
    scrollToIndex: (i) => listRef.current?.scrollToRow({ index: i, align: 'auto' }),
  });

  // Plain click: single-row highlight (click again to deselect). ⌘/Ctrl+click
  // toggles the row into/out of a multi-row selection for the bulk-action bar.
  // Also makes the clicked row the roving-focus target — found in review: a
  // clicked row (`tabIndex={-1}` used to make it click-focusable per the HTML
  // focusing-steps algorithm — since removed, see the row strip's own
  // comment) would otherwise leave the highlight sitting wherever it was
  // before the click, so the next Arrow key would jump from there instead of
  // from the row the user just clicked.
  const handleSelect = React.useCallback(
    (e: { metaKey: boolean; ctrlKey: boolean }, idx: number) => {
      if (e.metaKey || e.ctrlKey) selection.toggle(idx);
      else selection.selectOnly(idx);
      roving.setActiveIndex(idx);
    },
    // `roving` itself is a fresh object every render; depend on the one
    // function this actually calls (stable per `useRovingFocus`) so this
    // callback — and everything memoized against it, like `rowProps` below
    // — doesn't get a new identity on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selection, roving.setActiveIndex],
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
      // #69 — same restore-on-close target the keyboard path uses below, so
      // Escape/click-away no longer strands focus on `<body>` after a
      // right-click. `focusMenuOnOpen` stays unset: a mouse open still
      // doesn't grab focus into the menu, only Escape now has somewhere to
      // send it back to.
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        ...payload,
        returnFocusTo: listRef.current?.element ?? null,
      });
    },
    [listRef],
  );

  // Row-expand makes rows variable-height; measure each rendered row rather
  // than assuming a fixed height (mirrors TreeView).
  const rowHeight = useDynamicRowHeight({ defaultRowHeight: 24 });

  const handleGridKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      roving.onKeyDown(e);
      if (e.defaultPrevented) return;
      // Only Enter/Space typed while the grid itself has real DOM focus
      // selects the active row — one bubbling up from a nested button
      // (edit/expand/inline-edit) is that control's own action. Rows are no
      // longer focusable at all (see the row strip's own comment), so this
      // is now the ONLY place that guard can matter.
      if (e.target !== e.currentTarget) return;
      // #55 — Shift+F10 / ContextMenu key: open the (doc-level) cell menu for
      // the active row. No specific field/value — `field: null` is exactly
      // what a right-click on the row background (rather than a cell) would
      // pass, so Copy value/Copy field path correctly don't render while
      // Edit/Duplicate/Delete do.
      if (isContextMenuKey(e)) {
        if (documents.length === 0) return;
        e.preventDefault();
        // #133 — PageDown or the wheel can have scrolled the active row out
        // and unmounted it: open anyway (anchored to the grid) and bring the
        // row back into view.
        const rowEl = document.getElementById(roving.rowId(roving.activeIndex));
        const anchor = anchorForRow(rowEl, listRef.current?.element ?? null);
        if (!anchor) return;
        if (!rowEl) listRef.current?.scrollToRow({ index: roving.activeIndex, align: 'auto' });
        setContextMenu({
          ...anchor,
          doc: documents[roving.activeIndex],
          field: null,
          value: undefined,
          hasValue: false,
          returnFocusTo: listRef.current?.element ?? null,
          focusMenuOnOpen: true,
        });
        return;
      }
      // ⌘/Ctrl+Enter is Run (PanelBody's handler), never this row's action.
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (documents.length === 0) return;
      e.preventDefault();
      handleSelect(e, roving.activeIndex);
    },
    // `roving` itself is a fresh object every render (see `handleSelect`
    // above) — depend on the members this actually reads instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roving.onKeyDown, roving.activeIndex, roving.rowId, documents, handleSelect, listRef],
  );

  const rowProps = React.useMemo<TableRowProps>(
    () => ({
      documents,
      columns,
      widths,
      indices: selection.indices,
      activeIndex: roving.highlightIndex,
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
      rowId: roving.rowId,
    }),
    [
      documents,
      columns,
      widths,
      selection.indices,
      roving.highlightIndex,
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
      roving.rowId,
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
          container so columns stay aligned when the user scrolls right.
          #53 — `role="row"` so its `columnheader` children below are valid.
          It's a DOM sibling of the grid below (sticky positioning needs it
          outside the scrolling/virtualized body), not a descendant, so
          `aria-owns` on the grid (below) is what tells assistive tech this
          is still the grid's first row rather than an orphaned `row`.

          Two residuals, both recorded rather than fixed. ARIA places an
          `aria-owns` target last in accessibility-tree traversal order
          regardless of `aria-rowindex`, so some assistive tech may reach this
          header after the body rows even though it announces as row 1 — the
          sticky-header-must-be-a-sibling constraint leaves no better option.
          And the id is a constant: `TableView` has one call site today
          (`ResultViewer.tsx`), so two instances cannot collide, but a split or
          compare view mounting two would need it made unique. */}
      <div
        id="table-header-row"
        role="row"
        aria-rowindex={1}
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
            column, and hosts the table-level sort note. `columnheader` to
            match its row's required-owned-elements, same as the data
            columns below (#53). */}
        <div
          role="columnheader"
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
          const headerTitle = sortable
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
              : undefined;
          const labelContent = (
            <>
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
            </>
          );
          return (
            <div
              key={col.field}
              role="columnheader"
              aria-sort={ariaSortFor(sortable, dir)}
              title={headerTitle}
              data-testid={`table-header-${col.field}`}
              style={{
                width: w,
                minWidth: w,
                maxWidth: w,
                borderBottom: '1px solid var(--atelier-border)',
                borderRight: '1px solid var(--atelier-border)',
                // Padding moves onto the <button> below when sortable, so
                // its hit area covers the whole cell edge-to-edge.
                padding: sortable ? 0 : '5px 8px',
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
              {/* S6848 — the old fix wrapped a plain onClick div around the
                  label + resize handle. Instead, only the label + indicator
                  (the part that actually sorts) becomes a native <button>;
                  the resize handle stays a sibling, never a descendant of
                  the button, since a <div> inside a <button> is an invalid
                  content model. This gets native Enter/Space for free. */}
              {sortable ? (
                <button
                  type="button"
                  onClick={() => onSortField?.(col.field)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '5px 8px',
                    margin: 0,
                    border: 'none',
                    background: 'none',
                    font: 'inherit',
                    color: 'inherit',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  {labelContent}
                </button>
              ) : (
                labelContent
              )}
              {/* S6848 — a drag-only resize affordance has no discrete
                  "action" to run on Enter/Space the way a button does, so
                  the honest keyboard equivalent is the ARIA "window
                  splitter" pattern: role="separator" + arrow-key resize,
                  reusing the same 60px floor as the mouse drag.

                  This trades S6848 for S6845 ("`tabIndex` should only be
                  declared on interactive elements"), and that second finding
                  is accepted rather than fixed. A focusable `separator` IS
                  interactive — it is the role W3C's APG specifies for exactly
                  this widget, with `tabindex="0"`, `aria-valuenow` and
                  arrow-key resize. S6845's notion of "interactive" is a fixed
                  list that predates the splitter pattern and does not include
                  `separator`. Dropping the `tabIndex` to satisfy it would
                  delete the only keyboard path to resizing a column, which is
                  the opposite of what either rule is for. */}
              <div
                data-resize-handle="1"
                role="separator"
                aria-orientation="vertical"
                aria-label={`Resize ${label} column`}
                aria-valuenow={w}
                aria-valuemin={60}
                tabIndex={0}
                onMouseDown={(e) => handleResizeMouseDown(e, col.field)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                  e.preventDefault();
                  e.stopPropagation();
                  const delta = e.key === 'ArrowRight' ? 10 : -10;
                  onColumnResize(col.field, Math.max(60, propWidth(col.field) + delta));
                }}
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
        // react-window labels its own container `role="list"`, which is the
        // wrong context for the rows below and leaves them with no valid
        // parent. `grid` is the required one, and `aria-rowcount` is how a
        // virtualized grid reports a total larger than what is mounted (+1
        // for the header row).
        role="grid"
        aria-label="Documents"
        aria-rowcount={documents.length + 1}
        // #53 — the sticky header row lives outside this element in the DOM
        // (see the comment above it), so `aria-owns` is what makes it the
        // grid's first row for assistive tech instead of an orphaned `row`.
        aria-owns="table-header-row"
        // #20 — the grid is the widget's only tab stop; see `roving` above.
        listRef={listRef}
        tabIndex={roving.containerProps.tabIndex}
        aria-activedescendant={roving.containerProps['aria-activedescendant']}
        onFocus={roving.containerProps.onFocus}
        onBlur={roving.containerProps.onBlur}
        onKeyDown={handleGridKeyDown}
        rowComponent={TableRowImpl}
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
        // S6848 — this div's onClick only stops propagation so a click
        // inside the menu doesn't hit the window-level "click outside
        // closes" listener above; every action lives on the real <button>s
        // inside, already natively keyboard-operable. role="group", not
        // "menu", which would need role="menuitem" on all six children.
        //
        // Escape is not handled on this element itself — it lives on the
        // window, beside the click-outside dismiss, so it fires the same way
        // whether or not this div happens to hold focus right now. A mouse
        // open still never focuses it; a keyboard open does, via
        // `useMenuFocus` (#55/#87) — which is also what returns focus to the
        // grid once the window listener calls `setContextMenu(null)`, unless
        // the click that dismissed it landed on another focusable control.
        <div
          ref={cellMenuRef}
          role="group"
          aria-label="Cell actions"
          tabIndex={-1}
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
        // S6848 — same reasoning as the cell-level menu above, Escape
        // included: it is a window listener, not an onKeyDown here.
        <div
          ref={fieldMenuRef}
          role="group"
          aria-label="Field actions"
          tabIndex={-1}
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
