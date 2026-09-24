import React from 'react';
import {
  List,
  useDynamicRowHeight,
  type RowComponentProps,
} from 'react-window';
import { I } from '../../../icons';
import { ejsonStringify } from '../../../utils/ejson';
import { docKey } from '../../../utils/displayValue';
import { tokenizeJson, type Token, type TokenKind } from '../../../utils/jsonHighlight';
import { copyToClipboard } from '../../../utils/clipboard';
import { useCollectionWorkspace } from '../context';
import { useResultSelection } from '../resultSelection';

interface JsonViewProps {
  documents: unknown[];
}

function tokenColor(kind: TokenKind): string {
  switch (kind) {
    case 'key':     return 'var(--atelier-accent)';
    case 'string':  return '#2e7d32';
    case 'number':  return 'var(--atelier-color-number)';
    case 'boolean': return '#e65100';
    case 'null':    return 'var(--atelier-text-ghost)';
    case 'punct':   return 'var(--atelier-text-muted)';
    default:        return 'var(--atelier-text)';
  }
}

function tokenWeight(kind: TokenKind): React.CSSProperties['fontWeight'] {
  return kind === 'key' ? 600 : undefined;
}

// A node in the bracket-nesting tree over the flat token stream: either a
// single token, or a `{`/`[` ... `}`/`]` group holding its inner tokens as
// children (recursively, for nested groups). Building this tree is what lets
// a group collapse to a one-line summary without re-deriving JSON
// serialization — the existing tokenizer already did the formatting work.
type JsonNode =
  | { kind: 'leaf'; token: Token }
  | { kind: 'group'; id: number; open: Token; close: Token; children: JsonNode[]; entries: number };

function buildJsonTree(tokens: Token[]): JsonNode[] {
  let i = 0;
  let nextId = 0;
  function parseNodes(): JsonNode[] {
    const nodes: JsonNode[] = [];
    while (i < tokens.length) {
      const t = tokens[i]!;
      if (t.text === '}' || t.text === ']') break;
      if (t.text === '{' || t.text === '[') {
        const open = t;
        i++;
        const children = parseNodes();
        const close = tokens[i]!;
        i++;
        let commas = 0;
        let hasContent = false;
        for (const c of children) {
          if (c.kind === 'leaf') {
            if (c.token.text === ',') commas++;
            else if (!(c.token.kind === 'punct' && /^\s*$/u.test(c.token.text))) hasContent = true;
          } else {
            hasContent = true;
          }
        }
        nodes.push({ kind: 'group', id: nextId++, open, close, children, entries: hasContent ? commas + 1 : 0 });
        continue;
      }
      nodes.push({ kind: 'leaf', token: t });
      i++;
    }
    return nodes;
  }
  return parseNodes();
}

function JsonToken({ token }: { token: Token }) {
  return (
    <span style={{ color: tokenColor(token.kind), fontWeight: tokenWeight(token.kind) }}>
      {token.text}
    </span>
  );
}

function JsonTreeNodes({
  nodes,
  docKey,
  collapsedKeys,
  onToggle,
}: {
  nodes: JsonNode[];
  docKey: string;
  collapsedKeys: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <>
      {nodes.map((node, i) => {
        if (node.kind === 'leaf') return <JsonToken key={i} token={node.token} />;
        const nodeKey = `${docKey}:${node.id}`;
        const collapsed = collapsedKeys.has(nodeKey);
        const toggle = (e: React.SyntheticEvent) => {
          e.stopPropagation();
          onToggle(nodeKey);
        };
        return (
          <React.Fragment key={i}>
            <span
              role="button"
              tabIndex={0}
              onClick={toggle}
              onKeyDown={(e) => {
                // ⌘/Ctrl+Enter is Run (PanelBody's handler), not a toggle.
                if ((e.key === 'Enter' && !e.metaKey && !e.ctrlKey) || e.key === ' ') {
                  e.preventDefault();
                  toggle(e);
                }
              }}
              aria-label={collapsed ? 'Expand' : 'Collapse'}
              style={{ cursor: 'pointer' }}
            >
              <JsonToken token={node.open} />
              {collapsed && node.entries > 0 && (
                <span style={{ color: 'var(--atelier-text-ghost)', fontStyle: 'italic' }}>
                  {` …${node.entries} `}
                </span>
              )}
            </span>
            {!collapsed && (
              <JsonTreeNodes
                nodes={node.children}
                docKey={docKey}
                collapsedKeys={collapsedKeys}
                onToggle={onToggle}
              />
            )}
            <JsonToken token={node.close} />
          </React.Fragment>
        );
      })}
    </>
  );
}

// Collapse state is keyed by `${docKey}:${nodeId}` and owned by the caller
// (not local state here) so it survives a react-window row unmounting on
// scroll, and so a refreshed document at the same row index doesn't inherit
// another document's collapsed nodes.
export function HighlightedJson({
  json,
  docKey,
  collapsedKeys,
  onToggle,
}: {
  json: string;
  docKey: string;
  collapsedKeys: Set<string>;
  onToggle: (key: string) => void;
}) {
  const tree = React.useMemo(() => buildJsonTree(tokenizeJson(json)), [json]);

  return (
    <pre
      style={{
        margin: 0,
        fontFamily: 'monospace',
        fontSize: 11,
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        color: 'var(--atelier-text)',
      }}
    >
      <JsonTreeNodes nodes={tree} docKey={docKey} collapsedKeys={collapsedKeys} onToggle={onToggle} />
    </pre>
  );
}

interface DocCardProps {
  doc: unknown;
  idx: number;
  isSelected: boolean;
  isCopied: boolean;
  collapsedKeys: Set<string>;
  onToggleCollapse: (key: string) => void;
  onToggle: (idx: number) => void;
  onCopy: (doc: unknown, idx: number) => void;
  onEdit: (doc: unknown) => void;
  onDelete: (doc: unknown) => void;
}

function DocCard({
  doc,
  idx,
  isSelected,
  isCopied,
  collapsedKeys,
  onToggleCollapse,
  onToggle,
  onCopy,
  onEdit,
  onDelete,
}: DocCardProps) {
  const json = React.useMemo(() => {
    try {
      return ejsonStringify(doc, 2);
    } catch {
      return JSON.stringify(doc, null, 2);
    }
  }, [doc]);

  return (
    <div
      onClick={() => onToggle(idx)}
      // `group`, deliberately not `button`. `button` is "children
      // presentational" in ARIA, and this card holds real <button>s — the
      // corner actions below, and the JSON body's own collapse toggles at
      // :111 via HighlightedJson — which such a role may not contain at any
      // depth (axe's nested-interactive). `group` is not children
      // presentational, so the controls inside stay exposed, and it is honest:
      // this is a document and the things you can do to it.
      //
      // It also keeps S6848 closed. That rule wants a role on an element with
      // a handler, not specifically an interactive one — the `role="group"`
      // context menus in TableView carry an onClick and came back clean on the
      // #18 scan. So the wide-area click survives without either finding.
      //
      // The keyboard path is the dedicated Select button below, which is a
      // leaf; this div is mouse convenience on top of it.
      role="group"
      aria-label={`Document ${idx + 1}`}
      style={{
        border: `1px solid ${isSelected ? 'var(--atelier-accent-border)' : 'var(--atelier-border)'}`,
        borderRadius: 'var(--atelier-radius-sm)',
        background: isSelected ? 'var(--atelier-accent-soft)' : 'var(--atelier-surface-raised)',
        padding: '8px 10px',
        cursor: 'pointer',
        position: 'relative',
      }}
    >
      <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 4 }}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(idx);
          }}
          aria-pressed={isSelected}
          aria-label={isSelected ? 'Deselect document' : 'Select document'}
          title={isSelected ? 'Deselect document' : 'Select document'}
          style={{
            background: isSelected ? 'var(--atelier-accent-soft)' : 'var(--atelier-surface)',
            border: `1px solid ${isSelected ? 'var(--atelier-accent-border)' : 'var(--atelier-border)'}`,
            borderRadius: 'var(--atelier-radius-xs)',
            padding: '2px 5px',
            margin: 0,
            font: 'inherit',
            cursor: 'pointer',
            color: isSelected ? 'var(--atelier-accent)' : 'var(--atelier-text-ghost)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {I.check}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCopy(doc, idx);
          }}
          title="Copy JSON"
          style={{
            background: 'var(--atelier-surface)',
            border: '1px solid var(--atelier-border)',
            borderRadius: 'var(--atelier-radius-xs)',
            padding: '2px 5px',
            cursor: 'pointer',
            color: isCopied ? 'var(--atelier-accent)' : 'var(--atelier-text-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            fontSize: 10,
          }}
        >
          {isCopied ? I.check : I.copy}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit(doc);
          }}
          title="Edit"
          style={{
            background: 'var(--atelier-surface)',
            border: '1px solid var(--atelier-border)',
            borderRadius: 'var(--atelier-radius-xs)',
            padding: '2px 5px',
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
            onDelete(doc);
          }}
          title="Delete"
          style={{
            background: 'var(--atelier-surface)',
            border: '1px solid var(--atelier-border)',
            borderRadius: 'var(--atelier-radius-xs)',
            padding: '2px 5px',
            cursor: 'pointer',
            color: 'var(--atelier-red)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {I.trash}
        </button>
      </div>
      <HighlightedJson
        json={json}
        docKey={docKey(doc, idx)}
        collapsedKeys={collapsedKeys}
        onToggle={onToggleCollapse}
      />
    </div>
  );
}

const MemoDocCard = React.memo(DocCard);

interface JsonRowProps {
  documents: unknown[];
  selectedIndices: Set<number>;
  copiedIdx: number | null;
  collapsedKeys: Set<string>;
  onToggleCollapse: (key: string) => void;
  onToggle: (idx: number) => void;
  onCopy: (doc: unknown, idx: number) => void;
  onEdit: (doc: unknown) => void;
  onDelete: (doc: unknown) => void;
}

function JsonRow({
  index,
  style,
  documents,
  selectedIndices,
  copiedIdx,
  collapsedKeys,
  onToggleCollapse,
  onToggle,
  onCopy,
  onEdit,
  onDelete,
}: RowComponentProps<JsonRowProps>) {
  const doc = documents[index];
  return (
    <div style={{ ...style, paddingBottom: 8 }} data-doc-key={docKey(doc, index)}>
      <MemoDocCard
        doc={doc}
        idx={index}
        isSelected={selectedIndices.has(index)}
        isCopied={copiedIdx === index}
        collapsedKeys={collapsedKeys}
        onToggleCollapse={onToggleCollapse}
        onToggle={onToggle}
        onCopy={onCopy}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </div>
  );
}

export function JsonView({ documents }: JsonViewProps) {
  const { actions } = useCollectionWorkspace();
  const onEditDoc = actions.openEdit;
  const onDeleteDoc = actions.openDelete;
  // T0.4 — selection lifted to the shared cross-view context (index-based,
  // scoped to the enclosing <ResultViewer>); falls back to local state when
  // rendered standalone (no provider mounted).
  const selection = useResultSelection(documents);
  const selectedIndices = selection.indices;
  const toggleSelect = selection.toggle;
  const [copiedIdx, setCopiedIdx] = React.useState<number | null>(null);
  const [collapsedKeys, setCollapsedKeys] = React.useState<Set<string>>(() => new Set());
  const toggleCollapse = React.useCallback((key: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const copyDoc = React.useCallback((doc: unknown, idx: number) => {
    const text = ejsonStringify(doc, 2);
    // The badge is the success feedback, so it waits for the write to
    // resolve. A failure toasts and leaves no badge behind.
    void copyToClipboard(text).then((ok) => {
      if (!ok) return;
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1200);
    });
  }, []);

  // Cards are variable-height (driven by the doc's serialized size). The
  // estimate is intentionally generous; useDynamicRowHeight refines on render.
  const rowHeight = useDynamicRowHeight({ defaultRowHeight: 180 });

  // Memoize so react-window receives a stable rowProps reference. A fresh
  // object literal on every render would force all visible rows to re-render
  // even when nothing they depend on changed (TableView does this too).
  const rowProps = React.useMemo<JsonRowProps>(
    () => ({
      documents,
      selectedIndices,
      copiedIdx,
      collapsedKeys,
      onToggleCollapse: toggleCollapse,
      onToggle: toggleSelect,
      onCopy: copyDoc,
      onEdit: onEditDoc,
      onDelete: onDeleteDoc,
    }),
    [
      documents,
      selectedIndices,
      copiedIdx,
      collapsedKeys,
      toggleCollapse,
      toggleSelect,
      copyDoc,
      onEditDoc,
      onDeleteDoc,
    ],
  );

  return (
    <List<JsonRowProps>
      rowComponent={JsonRow}
      rowCount={documents.length}
      rowHeight={rowHeight}
      rowProps={rowProps}
      overscanCount={4}
      style={{
        flex: 1,
        minHeight: 0,
        padding: '8px 12px',
      }}
    />
  );
}
