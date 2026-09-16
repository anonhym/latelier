import React from 'react';
import { I } from '../../../icons';
import { isRecord, toDisplayValue, type DisplayType } from '../../../utils/displayValue';
import { DRAGGED_FIELD_MIME, type DraggedField } from '../builder';
import type { ReferenceRule } from '@shared/types';
import { ReferenceChip } from '../../../features/references/ReferenceChip';

// Shared FIELD | VALUE | TYPE column layout — the Tree view's expanded-row
// header (TreeView's sticky overlay) and the Table view's row-expand panel
// both rely on this exact template so their headers and the FieldNode rows
// underneath line up.
export const DOC_FIELD_TREE_GRID_TEMPLATE = '140px 1fr 72px';

// Soft, translucent badges that read as labels rather than blocks of color.
// Backgrounds are alpha-blended brand tones; foregrounds are the matching
// solid tone so the badge stays legible on both Paper and Deep surfaces.
// Theme-derived entries (string/number/boolean/null) use Mantine CSS vars so
// dark mode switches automatically without JS.
// NOTE: kept private — component files here can't export object/array/
// function constants (eslint-plugin-react-refresh only-export-components).
const TYPE_HUES: Partial<Record<DisplayType, { bg: string; fg: string }>> = {
  objectid: { bg: 'rgba(138,107,64,0.12)', fg: '#8A6B40' },
  date: { bg: 'rgba(26,80,104,0.10)', fg: '#1A5068' },
  long: { bg: 'rgba(107,58,138,0.10)', fg: '#6B3A8A' },
  decimal: { bg: 'rgba(107,58,138,0.10)', fg: '#6B3A8A' },
  regex: { bg: 'rgba(184,76,20,0.12)', fg: '#B84C14' },
  binary: { bg: 'rgba(80,80,80,0.10)', fg: '#666' },
  array: { bg: 'rgba(107,58,138,0.10)', fg: '#6B3A8A' },
  object: { bg: 'rgba(80,80,138,0.10)', fg: '#5050A8' },
};

// Theme-sensitive badge colors expressed purely as CSS variables so no JS
// re-read is needed when the color scheme flips. Defined in index.css under
// :root / [data-mantine-color-scheme="dark"].
const TYPE_THEMED: Partial<Record<DisplayType, { bg: string; fg: string }>> = {
  string: { bg: 'transparent', fg: 'var(--atelier-text-ghost)' },
  number: { bg: 'var(--atelier-accent-soft)', fg: 'var(--atelier-accent)' },
  boolean: { bg: 'var(--atelier-green-soft)', fg: 'var(--atelier-green-text)' },
  null: { bg: 'var(--atelier-surface-raised)', fg: 'var(--atelier-text-ghost)' },
  undefined: { bg: 'var(--atelier-surface-raised)', fg: 'var(--atelier-text-ghost)' },
};

export function TypeBadge({ type }: { type: DisplayType }) {
  const colors = TYPE_HUES[type] ?? TYPE_THEMED[type] ?? {
    bg: 'var(--atelier-surface-raised)',
    fg: 'var(--atelier-text-muted)',
  };
  return (
    <span
      style={{
        fontSize: 9,
        padding: '1px 5px',
        borderRadius: 'var(--atelier-radius-xs)',
        background: colors.bg,
        color: colors.fg,
        fontWeight: 600,
        letterSpacing: '0.03em',
        textTransform: 'uppercase',
        flexShrink: 0,
      }}
    >
      {type}
    </span>
  );
}

interface FieldNodeProps {
  name: string;
  value: unknown;
  depth: number;
  /** Path key used for tracking expansion state — includes a docId prefix. */
  path: string;
  /** Dot-path of the field within the document (no docId prefix). */
  fieldPath: string;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  copiedPath: string | null;
  onCopy: (path: string, value: unknown) => void;
  onOpenMenu: (e: React.MouseEvent, fieldPath: string, value: unknown) => void;
  refsByField?: Map<string, ReferenceRule>;
  onRefHover?: (rule: ReferenceRule, value: unknown, rect: DOMRect) => void;
  onRefHoverLeave?: () => void;
  onRefOpen?: (rule: ReferenceRule, field: string, value: unknown) => void;
}

function FieldNodeImpl({
  name,
  value,
  depth,
  path,
  fieldPath,
  expandedPaths,
  onToggle,
  copiedPath,
  onCopy,
  onOpenMenu,
  refsByField,
  onRefHover,
  onRefHoverLeave,
  onRefOpen,
}: FieldNodeProps) {
  const dv = toDisplayValue(value);
  const isExpandable = dv.type === 'object' || dv.type === 'array';
  const isExpanded = isExpandable && expandedPaths.has(path);
  const isCopied = copiedPath === path;
  const rule = refsByField?.get(fieldPath);

  const childEntries: Array<[string, unknown]> = React.useMemo(() => {
    if (!isExpanded) return [];
    if (dv.type === 'array' && Array.isArray(value)) {
      return value.map((v, i): [string, unknown] => [String(i), v]);
    }
    if (dv.type === 'object' && isRecord(value)) {
      return Object.entries(value);
    }
    return [];
  }, [isExpanded, dv.type, value]);

  const rowClickable = isExpandable;

  // A doc field can legitimately hold JS `undefined` (BSON's deprecated
  // Undefined type round-trips to it via EJSON `{$undefined:true}`), and
  // dragging that row crashed —
  // `condFromDragged` stored `undefined` where a string is required, and
  // the printer's validation later called `.trim()` on it. `TableView`'s
  // cell already gates its own drag source on `value !== undefined`; this
  // row didn't. Root-cause fix belongs here, not just at the drop end.
  const draggable = value !== undefined;

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
    <>
      <div
        draggable={draggable}
        onDragStart={draggable ? handleDragStart : undefined}
        onClick={rowClickable ? () => onToggle(path) : undefined}
        // Guarded so a keydown bubbling from the nested expand button
        // doesn't also fire this handler and cancel the toggle out.
        onKeyDown={
          rowClickable
            ? (e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  if (e.key === ' ') e.preventDefault();
                  onToggle(path);
                }
              }
            : undefined
        }
        role="treeitem"
        aria-expanded={isExpandable ? isExpanded : undefined}
        tabIndex={-1}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onCopy(path, value);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpenMenu(e, fieldPath, value);
        }}
        title={
          draggable
            ? `Drag to add "${fieldPath} $eq …" to builder · double-click to copy`
            : undefined
        }
        style={{
          display: 'grid',
          gridTemplateColumns: DOC_FIELD_TREE_GRID_TEMPLATE,
          alignItems: 'center',
          gap: 12,
          padding: '3px 12px',
          paddingLeft: 12 + depth * 16,
          minHeight: 24,
          fontSize: 11,
          cursor: rowClickable ? 'pointer' : 'grab',
          userSelect: 'none',
          background: isCopied ? 'var(--atelier-accent)' : undefined,
          color: isCopied ? '#fff' : undefined,
          transition: 'background 120ms',
        }}
      >
        {isCopied ? (
          <span
            style={{
              gridColumn: '1 / -1',
              textAlign: 'center',
              fontWeight: 600,
              fontFamily: '"JetBrains Mono", monospace',
            }}
          >
            ✓ Copied
          </span>
        ) : (
          <>
            {/* Col 1 — chevron + field name (mono, muted) */}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                color: 'var(--atelier-text-muted)',
                fontFamily: '"JetBrains Mono", monospace',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {isExpandable ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle(path);
                  }}
                  aria-label={isExpanded ? 'Collapse' : 'Expand'}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 14,
                    height: 14,
                    padding: 0,
                    background: 'none',
                    border: 'none',
                    color: isCopied ? '#fff' : 'var(--atelier-text-ghost)',
                    cursor: 'pointer',
                    flexShrink: 0,
                    transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                    transition: 'transform 120ms',
                  }}
                >
                  {I.chevD}
                </button>
              ) : (
                <span style={{ width: 14, flexShrink: 0 }} />
              )}
              {name}
            </span>

            {/* Col 2 — value (mono, default text) */}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                minWidth: 0,
                overflow: 'hidden',
              }}
            >
              <span
                style={{
                  color: isCopied ? '#fff' : 'var(--atelier-text)',
                  fontFamily: '"JetBrains Mono", monospace',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                  flexShrink: 1,
                }}
              >
                {dv.type === 'string' ? `"${dv.display}"` : dv.display}
              </span>
              {rule && (
                <ReferenceChip
                  rule={rule}
                  onHover={(rect) => onRefHover?.(rule, value, rect)}
                  onLeave={() => onRefHoverLeave?.()}
                  onClick={() => onRefOpen?.(rule, fieldPath, value)}
                />
              )}
            </span>

            {/* Col 3 — type badge */}
            <span style={{ display: 'inline-flex', justifyContent: 'flex-start' }}>
              <TypeBadge type={dv.type} />
            </span>
          </>
        )}
      </div>
      {isExpanded &&
        childEntries.map(([k, v]) => (
          <FieldNode
            key={`${path}.${k}`}
            name={k}
            value={v}
            depth={depth + 1}
            path={`${path}.${k}`}
            fieldPath={`${fieldPath}.${k}`}
            expandedPaths={expandedPaths}
            onToggle={onToggle}
            copiedPath={copiedPath}
            onCopy={onCopy}
            onOpenMenu={onOpenMenu}
            refsByField={refsByField}
            onRefHover={onRefHover}
            onRefHoverLeave={onRefHoverLeave}
            onRefOpen={onRefOpen}
          />
        ))}
    </>
  );
}

export const FieldNode = React.memo(FieldNodeImpl, (prev, next) => {
  // Cheap identity checks first.
  if (
    prev.value !== next.value ||
    prev.name !== next.name ||
    prev.path !== next.path ||
    prev.fieldPath !== next.fieldPath ||
    prev.depth !== next.depth ||
    prev.onToggle !== next.onToggle ||
    prev.onCopy !== next.onCopy ||
    prev.onOpenMenu !== next.onOpenMenu ||
    prev.refsByField !== next.refsByField ||
    prev.onRefHover !== next.onRefHover ||
    prev.onRefHoverLeave !== next.onRefHoverLeave ||
    prev.onRefOpen !== next.onRefOpen
  ) {
    return false;
  }
  // copiedPath only matters if it just became / stopped being THIS path.
  const wasCopied = prev.copiedPath === prev.path;
  const isCopied = next.copiedPath === next.path;
  if (wasCopied !== isCopied) return false;
  // expandedPaths Set identity changes on every toggle, but most FieldNodes
  // are unaffected. Skip render if neither THIS path's expansion changed nor
  // (when expanded) any descendant path's expansion changed.
  if (prev.expandedPaths !== next.expandedPaths) {
    const wasExpanded = prev.expandedPaths.has(prev.path);
    const isExpanded = next.expandedPaths.has(next.path);
    if (wasExpanded !== isExpanded) return false;
    if (isExpanded) {
      const prefix = `${next.path}.`;
      for (const p of prev.expandedPaths) {
        if (p.startsWith(prefix) && !next.expandedPaths.has(p)) return false;
      }
      for (const p of next.expandedPaths) {
        if (p.startsWith(prefix) && !prev.expandedPaths.has(p)) return false;
      }
    }
  }
  return true;
});

export interface DocFieldTreeProps {
  /** The document to render. Callers should guard with `isRecord` first. */
  doc: Record<string, unknown>;
  /** Full docId (see `docId.ts`) — prefixes each top-level field's path. */
  docId: string;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  copiedPath: string | null;
  onCopy: (path: string, value: unknown) => void;
  onOpenMenu: (e: React.MouseEvent, fieldPath: string, value: unknown) => void;
  refsByField?: Map<string, ReferenceRule>;
  onRefHover?: (rule: ReferenceRule, value: unknown, rect: DOMRect) => void;
  onRefHoverLeave?: () => void;
  onRefOpen?: (rule: ReferenceRule, field: string, value: unknown) => void;
}

/**
 * Recursive FIELD | VALUE | TYPE tree for a single document, including its
 * own column header. Extracted from `TreeView.tsx`'s `DocRow` so the Table
 * view's row-expand panel renders an identical tree instead of a second,
 * drifting implementation.
 *
 * The header markup/styling here must stay byte-for-byte in sync with
 * TreeView's `stickyHeaderOffset` overlay (`TreeView.tsx`) — that overlay
 * clones this same header and pins it to the scroll viewport while
 * an expanded section is in view. It keys off the
 * `data-expanded-doc-section="true"` wrapper that callers (DocRow, TableView)
 * place around this component, not off anything internal to this file.
 */
export function DocFieldTree({
  doc,
  docId,
  expandedPaths,
  onToggle,
  copiedPath,
  onCopy,
  onOpenMenu,
  refsByField,
  onRefHover,
  onRefHoverLeave,
  onRefOpen,
}: DocFieldTreeProps) {
  return (
    <>
      <div
        aria-hidden="true"
        style={{
          display: 'grid',
          gridTemplateColumns: DOC_FIELD_TREE_GRID_TEMPLATE,
          gap: 12,
          padding: '4px 12px',
          fontSize: 9,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          color: 'var(--atelier-text-ghost)',
          background: 'var(--atelier-surface-raised)',
          borderBottom: '1px solid var(--atelier-border)',
        }}
      >
        <span>Field</span>
        <span>Value</span>
        <span>Type</span>
      </div>
      {Object.entries(doc).map(([field, val]) => (
        <FieldNode
          key={field}
          name={field}
          value={val}
          depth={0}
          path={`${docId}::${field}`}
          fieldPath={field}
          expandedPaths={expandedPaths}
          onToggle={onToggle}
          copiedPath={copiedPath}
          onCopy={onCopy}
          onOpenMenu={onOpenMenu}
          refsByField={refsByField}
          onRefHover={onRefHover}
          onRefHoverLeave={onRefHoverLeave}
          onRefOpen={onRefOpen}
        />
      ))}
    </>
  );
}
