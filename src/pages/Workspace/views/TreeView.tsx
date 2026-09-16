import React from 'react';
import { notify } from '../../../theme/notifications';
import {
  List,
  useDynamicRowHeight,
  type RowComponentProps,
} from 'react-window';
import { I } from '../../../icons';
import { isRecord, toDisplayValue, valueToClipboardText } from '../../../utils/displayValue';
import type { ReferenceRule } from '@shared/types';
import { confirmDestructive } from '../../../utils/confirm';
import { copyToClipboard } from '../../../utils/clipboard';
import { ownGet } from '../../../utils/ownProperty';
import { condFromDragged } from '../builder';
import { useCollectionWorkspace } from '../context';
import { insertAt, parseFilter, printFilter } from '../filterTree';
import { useResultSelection } from '../resultSelection';
import { DocFieldTree, DOC_FIELD_TREE_GRID_TEMPLATE } from './DocFieldTree';
import { getDocId, getFullDocId } from './docId';

interface TreeViewProps {
  documents: unknown[];
  /** Per-row expand state, keyed by docId. Defaults to an empty (fully collapsed) object. */
  expandedRows?: Record<string, boolean>;
  onSelect: (doc: unknown) => void;
  onRowExpand: (docId: string, expanded: boolean) => void;
  /** Fields shown in the collapsed preview strip; `null`/empty falls back to the first 4 keys. */
  previewFields?: string[] | null;
  /** Map from dotted source-field path to the matching reference rule. */
  refsByField?: Map<string, ReferenceRule>;
  onRefHover?: (rule: ReferenceRule, value: unknown, rect: DOMRect) => void;
  onRefHoverLeave?: () => void;
  onRefOpen?: (rule: ReferenceRule, field: string, value: unknown) => void;
}

function getPreviewFields(
  doc: unknown,
  override?: string[] | null,
): Array<[string, unknown]> {
  if (!isRecord(doc)) return [];
  if (override && override.length > 0) {
    return override
      .filter((k) => k !== '_id' && k in doc)
      .map((k) => [k, doc[k]] as [string, unknown]);
  }
  const allKeys = Object.keys(doc).filter((k) => k !== '_id');
  return allKeys.slice(0, 4).map((k) => [k, doc[k]]);
}

/** Rendered height of the FIELD|VALUE|TYPE header; drives the sticky overlay's slide-off. */
const STICKY_HEADER_HEIGHT = 22;

const PREVIEW_VALUE_MAX_CHARS = 25;

function truncatePreviewValue(s: string): string {
  return s.length > PREVIEW_VALUE_MAX_CHARS
    ? s.slice(0, PREVIEW_VALUE_MAX_CHARS) + '…'
    : s;
}

interface CollapsedRowPreviewProps {
  doc: unknown;
  previewFields?: string[] | null;
}

const CollapsedRowPreview = React.memo(function CollapsedRowPreview({
  doc,
  previewFields,
}: CollapsedRowPreviewProps) {
  const preview = React.useMemo(
    () => getPreviewFields(doc, previewFields),
    [doc, previewFields],
  );
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 10,
        overflow: 'hidden',
        flexWrap: 'nowrap',
        minWidth: 0,
      }}
    >
      {preview.map(([field, val]) => {
        const dv = toDisplayValue(val);
        const rendered =
          dv.type === 'string'
            ? `"${truncatePreviewValue(dv.display)}"`
            : truncatePreviewValue(dv.display);
        return (
          <span
            key={field}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              color: 'var(--atelier-text-muted)',
              minWidth: 0,
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            <span style={{ color: 'var(--atelier-text-ghost)', flexShrink: 0 }}>{field}:</span>
            <span
              style={{
                color: 'var(--atelier-text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {rendered}
            </span>
          </span>
        );
      })}
    </div>
  );
});

interface DocRowProps {
  documents: unknown[];
  expandedRows: Record<string, boolean>;
  /** Selected row indices (T0.4 — index-based, shared across Table/Tree/JSON). */
  indices: Set<number>;
  deepPaths: Set<string>;
  copiedPath: string | null;
  previewFields?: string[] | null;
  refsByField?: Map<string, ReferenceRule>;
  onRowExpand: (docId: string, expanded: boolean) => void;
  onEditDoc: (doc: unknown) => void;
  onDeleteDoc: (doc: unknown) => void;
  onSelect: (doc: unknown) => void;
  onToggleSelect: (index: number) => void;
  toggleDeepPath: (path: string) => void;
  handleCopy: (path: string, value: unknown) => void;
  handleOpenMenu: (e: React.MouseEvent, fieldPath: string, value: unknown) => void;
  onRefHover?: (rule: ReferenceRule, value: unknown, rect: DOMRect) => void;
  onRefHoverLeave?: () => void;
  onRefOpen?: (rule: ReferenceRule, field: string, value: unknown) => void;
}

function DocRowImpl({
  index,
  style,
  documents,
  expandedRows,
  indices,
  deepPaths,
  copiedPath,
  previewFields,
  refsByField,
  onRowExpand,
  onEditDoc,
  onDeleteDoc,
  onSelect,
  onToggleSelect,
  toggleDeepPath,
  handleCopy,
  handleOpenMenu,
  onRefHover,
  onRefHoverLeave,
  onRefOpen,
}: RowComponentProps<DocRowProps>) {
  const doc = documents[index];
  const docId = getFullDocId(doc);
  const shortId = getDocId(doc);
  const isExpanded = !!ownGet(expandedRows, docId);
  const isSelected = indices.has(index);

  const handleRowClick = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      onToggleSelect(index);
      onSelect(doc);
    } else {
      onRowExpand(docId, !isExpanded);
    }
  };

  return (
    <div
      // Test hook for the T0.4 cross-view selection repaint (asserted in
      // selection-shared.spec.tsx) — cheaper and less brittle than
      // asserting on the inline background/borderLeft style strings.
      data-selected={isSelected}
      style={{
        ...style,
        borderBottom: '1px solid var(--atelier-border)',
        background: isSelected ? 'var(--atelier-accent-soft)' : 'transparent',
        borderLeft: isSelected
          ? '3px solid var(--atelier-accent)'
          : '3px solid transparent',
      }}
    >
      {/* Collapsed row */}
      <div
        onClick={handleRowClick}
        // Keyboard path is independent of handleRowClick (which reads
        // metaKey/ctrlKey off a MouseEvent for ⌘/Ctrl+click-to-select — a
        // mouse-only gesture). Guarded so a keydown bubbling up from a
        // nested control (the expand button, edit/delete) doesn't also
        // toggle the row — that button already has its own native Enter/
        // Space handling.
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            if (e.key === ' ') e.preventDefault();
            onRowExpand(docId, !isExpanded);
          }
        }}
        role="treeitem"
        aria-expanded={isExpanded}
        tabIndex={-1}
        title="Click to expand · ⌘/Ctrl+click to select"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          cursor: 'pointer',
          fontSize: 12,
          minHeight: 44,
          userSelect: 'none',
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
            width: 28,
            height: 28,
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

        <span
          style={{
            fontFamily: 'monospace',
            fontSize: 11,
            color: 'var(--atelier-accent)',
            fontWeight: 600,
            flexShrink: 0,
            minWidth: 68,
          }}
        >
          {shortId}
        </span>

        <CollapsedRowPreview
          doc={doc}
          previewFields={previewFields}
        />

        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEditDoc(doc);
            }}
            title="Edit document"
            style={{
              background: 'none',
              border: '1px solid var(--atelier-border)',
              borderRadius: 'var(--atelier-radius-xs)',
              padding: '4px 7px',
              cursor: 'pointer',
              color: 'var(--atelier-text-muted)',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {I.edit}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteDoc(doc);
            }}
            title="Delete document"
            style={{
              background: 'none',
              border: '1px solid var(--atelier-border)',
              borderRadius: 'var(--atelier-radius-xs)',
              padding: '4px 7px',
              cursor: 'pointer',
              color: 'var(--atelier-red)',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {I.trash}
          </button>
        </div>
      </div>

      {/* Expanded fields — recursive. The FIELD|VALUE|TYPE column header
          sits at the top of the doc's expansion. A JS-driven overlay in the
          TreeView pins a clone of this header to the top of the
          scroll viewport while the expanded section is in view — needed
          because react-window v2 positions rows with `transform: translateY`,
          which prevents native `position: sticky` from escaping the row. */}
      {isExpanded && isRecord(doc) && (
        <div
          data-expanded-doc-section="true"
          // Ancestor role for DocFieldTree's `treeitem` rows below (axe's
          // aria-required-parent). The rows render as a flat sibling list,
          // not nested per depth, so this isn't a fully-conformant ARIA
          // tree — it's the minimum that satisfies the treeitem/tree pairing.
          role="tree"
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
            copiedPath={copiedPath}
            onCopy={handleCopy}
            onOpenMenu={handleOpenMenu}
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

const DocRow = React.memo(DocRowImpl, (prev, next) => {
  if (prev.index !== next.index || prev.style !== next.style) return false;
  const prevDoc = prev.documents[prev.index];
  const nextDoc = next.documents[next.index];
  if (prevDoc !== nextDoc) return false;
  const docId = getFullDocId(nextDoc);
  if (ownGet(prev.expandedRows, docId) !== ownGet(next.expandedRows, docId)) return false;
  if (prev.indices.has(prev.index) !== next.indices.has(next.index)) return false;
  if (prev.copiedPath !== next.copiedPath) {
    const prefix = `${docId}::`;
    const prevHere = prev.copiedPath?.startsWith(prefix) ?? false;
    const nextHere = next.copiedPath?.startsWith(prefix) ?? false;
    if (prevHere || nextHere) return false;
  }
  const isExpanded = !!ownGet(next.expandedRows, docId);
  if (isExpanded && prev.deepPaths !== next.deepPaths) {
    const prefix = `${docId}::`;
    for (const p of prev.deepPaths) {
      if (p.startsWith(prefix) && !next.deepPaths.has(p)) return false;
    }
    for (const p of next.deepPaths) {
      if (p.startsWith(prefix) && !prev.deepPaths.has(p)) return false;
    }
  }
  return (
    prev.previewFields === next.previewFields &&
    prev.refsByField === next.refsByField &&
    prev.onRowExpand === next.onRowExpand &&
    prev.onEditDoc === next.onEditDoc &&
    prev.onDeleteDoc === next.onDeleteDoc &&
    prev.onSelect === next.onSelect &&
    prev.onToggleSelect === next.onToggleSelect &&
    prev.toggleDeepPath === next.toggleDeepPath &&
    prev.handleCopy === next.handleCopy &&
    prev.handleOpenMenu === next.handleOpenMenu &&
    prev.onRefHover === next.onRefHover &&
    prev.onRefHoverLeave === next.onRefHoverLeave &&
    prev.onRefOpen === next.onRefOpen
  );
});

export function TreeView({
  documents,
  expandedRows: expandedRowsProp,
  onSelect,
  onRowExpand,
  previewFields,
  refsByField,
  onRefHover,
  onRefHoverLeave,
  onRefOpen,
}: TreeViewProps) {
  const { state, actions, meta } = useCollectionWorkspace();
  const onEditDoc = actions.openEdit;
  const onDeleteDoc = actions.openDelete;
  // Falls back to local state when rendered standalone (no provider mounted).
  const selection = useResultSelection(documents);
  const [deepPaths, setDeepPaths] = React.useState<Set<string>>(new Set());
  // Resets on document-set change so the Set doesn't grow monotonically
  // across queries. "Adjust state during render" pattern, not a useEffect,
  // to avoid a cascading effect-then-render cycle.
  const [prevDocuments, setPrevDocuments] =
    React.useState<unknown[]>(documents);
  if (prevDocuments !== documents) {
    setPrevDocuments(documents);
    setDeepPaths(new Set());
  }
  const [copiedPath, setCopiedPath] = React.useState<string | null>(null);
  const [contextMenu, setContextMenu] = React.useState<{
    x: number;
    y: number;
    fieldPath: string;
    value: unknown;
  } | null>(null);
  // Memoized so `?? {}` doesn't allocate a fresh object every render, which
  // would cascade into the rowProps useMemo below.
  const expandedRows = React.useMemo(
    () => expandedRowsProp ?? {},
    [expandedRowsProp],
  );

  const toggleDeepPath = React.useCallback((p: string) => {
    setDeepPaths((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }, []);

  const handleCopy = React.useCallback((path: string, value: unknown) => {
    void copyToClipboard(valueToClipboardText(value)).then((ok) => {
      if (!ok) return;
      setCopiedPath(path);
      window.setTimeout(() => {
        setCopiedPath((prev) => (prev === path ? null : prev));
      }, 600);
    });
  }, []);

  const handleOpenMenu = React.useCallback(
    (e: React.MouseEvent, fieldPath: string, value: unknown) => {
      setContextMenu({ x: e.clientX, y: e.clientY, fieldPath, value });
    },
    [],
  );

  // Menu disables up front when the filter bar's text doesn't parse, rather
  // than showing a toast on click.
  const filterBarValid = React.useMemo(() => parseFilter(state.queryRaw).ok, [state.queryRaw]);

  // Non-drag discovery path onto the Query Builder: same root-level insert
  // the pane's own drop does. Confirms whenever the Filter drawer is open —
  // deliberate over-warn, since it may hold newer local input this patch
  // (direct to state.queryRaw) can't see and would silently discard.
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
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [contextMenu]);

  // Virtualize the outer doc list with react-window v2. Collapsed rows are
  // ~44px; expanded rows grow with field count. useDynamicRowHeight observes
  // each rendered row and caches its measured height — no manual ref wiring,
  // no library-side scroll correction on resize.
  const rowHeight = useDynamicRowHeight({ defaultRowHeight: 44 });

  // Memoize so react-window receives a stable rowProps reference. A fresh
  // object literal on every render would re-trigger every visible DocRow
  // (TableView already does this; TreeView and JsonView were the laggards).
  const rowProps = React.useMemo<DocRowProps>(
    () => ({
      documents,
      expandedRows,
      indices: selection.indices,
      deepPaths,
      copiedPath,
      previewFields,
      refsByField,
      onRowExpand,
      onEditDoc,
      onDeleteDoc,
      onSelect,
      onToggleSelect: selection.toggle,
      toggleDeepPath,
      handleCopy,
      handleOpenMenu,
      onRefHover,
      onRefHoverLeave,
      onRefOpen,
    }),
    [
      documents,
      expandedRows,
      selection.indices,
      selection.toggle,
      deepPaths,
      copiedPath,
      previewFields,
      refsByField,
      onRowExpand,
      onEditDoc,
      onDeleteDoc,
      onSelect,
      toggleDeepPath,
      handleCopy,
      handleOpenMenu,
      onRefHover,
      onRefHoverLeave,
      onRefOpen,
    ],
  );

  // JS-driven sticky header: react-window v2's `translateY` row positioning
  // breaks native `position: sticky` inside a row, so an overlay header is
  // pinned above the list instead while the scroll top lies inside an
  // expanded section. Queries the scroll container by class rather than
  // react-window's imperative handle, whose `element` getter isn't
  // populated until a second render.
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  // null = hidden; 0 = fully pinned; negative = sliding off as the section's
  // bottom enters the header band, matching native sticky semantics.
  const [stickyHeaderOffset, setStickyHeaderOffset] = React.useState<
    number | null
  >(null);

  React.useEffect(() => {
    const scroller = wrapperRef.current?.querySelector<HTMLDivElement>(
      '.tree-view-no-scroll-anchor',
    );
    if (!scroller) return;
    let raf: number | null = null;
    const update = () => {
      raf = null;
      const containerTop = scroller.getBoundingClientRect().top;
      const sections = scroller.querySelectorAll<HTMLElement>(
        '[data-expanded-doc-section="true"]',
      );
      let offset: number | null = null;
      for (const section of sections) {
        const r = section.getBoundingClientRect();
        if (r.top < containerTop && r.bottom > containerTop) {
          const overshoot = r.bottom - containerTop;
          offset = overshoot >= STICKY_HEADER_HEIGHT
            ? 0
            : overshoot - STICKY_HEADER_HEIGHT;
          break;
        }
      }
      setStickyHeaderOffset(offset);
    };
    const onScroll = () => {
      if (raf != null) return;
      raf = requestAnimationFrame(update);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [expandedRows, documents, deepPaths]);

  return (
    <>
      <div
        ref={wrapperRef}
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
        }}
      >
        <List<DocRowProps>
          className="tree-view-no-scroll-anchor"
          rowComponent={DocRow as typeof DocRowImpl}
          rowCount={documents.length}
          rowHeight={rowHeight}
          rowProps={rowProps}
          overscanCount={4}
          style={{
            flex: 1,
            minHeight: 0,
            overflowX: 'hidden',
          }}
        />
        {stickyHeaderOffset !== null && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              transform: `translateY(${stickyHeaderOffset}px)`,
              // Matches DocRow's 3px left border so the columns line up with in-row headers.
              borderLeft: '3px solid transparent',
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
              zIndex: 2,
              pointerEvents: 'none',
            }}
          >
            <span>Field</span>
            <span>Value</span>
            <span>Type</span>
          </div>
        )}
      </div>
      {contextMenu && (
        <div
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
          {contextMenu.value !== undefined && (
            <button
              onClick={(e) => {
                e.stopPropagation();
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
          <button
            onClick={(e) => {
              e.stopPropagation();
              void copyToClipboard(
                contextMenu.fieldPath,
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
          {!meta.isReadOnly && contextMenu.value !== undefined && (
            <button
              disabled={!filterBarValid}
              onClick={(e) => {
                e.stopPropagation();
                void handleAddToFilter(contextMenu.fieldPath, contextMenu.value);
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
        </div>
      )}
    </>
  );
}
