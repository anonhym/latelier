import React from 'react';
import { ActionIcon, Button, Group, Kbd, Modal, NativeSelect, SegmentedControl, Switch, Text, Textarea, TextInput, Tooltip } from '@mantine/core';
import { themeVars } from '../../theme/themeVars';
import { confirmDestructive } from '../../utils/confirm';
import { useDialogFocusReturn } from '../../hooks/useDialogFocusReturn';
import { SubmitButton } from '../../components/SubmitButton';
import { api, getErrorMessage } from '../../api/atelier';
import { logFailure } from '../../utils/rendererLog';
import { ejsonParse, ejsonStringify, ejsonStringifyReadable, isPlainDocument } from '../../utils/ejson';
import { refusalMessage } from '../../utils/shellSyntax';
import { useShellSyntaxField } from './useShellSyntaxField';
import { classifyInsertPayload, type InsertPayloadClassification } from '../../utils/insertPayload';
import { ScriptEditor } from '../../components/ScriptEditor';
import { copyToClipboard } from '../../utils/clipboard';
import { formatShortcut } from '../../commands/shortcutLabel';
import { isMacRenderer } from '../../utils/platform';
import { checkFieldType, inferType, type TypeWarning } from './schemaSummary';
import { getStructureEntries } from '../../features/fieldSuggestions/sources/sampleSchemaSource';
import { FieldAutocompleteInput } from '../../features/fieldSuggestions/FieldAutocompleteInput';
import type { SuggestionContext } from '../../features/fieldSuggestions/types';
import {
  buildUpdateRequest,
  changeList,
  classifyConflict,
  deleteAtSegments,
  diff,
  getAtSegments,
  isEdited,
  isEmptyDiff,
  isUnsafeFieldName,
  parseJsonDraft,
  resolveConflict,
  setAtSegments,
  typeChangeOf,
  typeChangeText,
  type DocDiff,
} from './documentDiff';
import { DocumentChangeStrip } from './DocumentChangeStrip';
import { DeletedDocumentPanel, DocumentConflictPanel, type ConflictChoice } from './DocumentConflictPanel';
import { confirmMove } from './confirmMove';
import {
  SELECTABLE_KINDS,
  TYPE_LABEL,
  convertType,
  kindOf,
  parseAs,
  textOf,
  typeLabel,
  type FieldKind,
} from './documentFieldTypes';
import {
  decodeKey,
  editAddress,
  keyOf,
  purgeCollapsedUnder,
  purgeUnder,
  rekeyAfterRemoval,
  rekeyMapAfterRemoval,
  rekeySetAfterRemoval,
} from './editorRowKeys';
import type { SchemaSampleEntry } from '@shared/types';

type Doc = Record<string, unknown>;

interface DocumentEditorBaseProps {
  connectionId: string;
  dbName: string;
  collection: string;
  onClose: () => void;
}

interface EditModeProps extends DocumentEditorBaseProps {
  mode: 'edit';
  /** A result row: canonical EJSON sentinels, as `find` hands them over. */
  doc: unknown;
  /** `auditId` is the Reversible entry id of the update, for undo. */
  onSaved: (auditId?: string) => void;
  /**
   * W18 §8 — Quick Edit opens the editor straight at a field it can't edit
   * inline (Date, ObjectId, Object, Array, …) instead of leaving the user to
   * find the row themselves: scrolled into view and focused once the editor
   * mounts. Always a top-level field name (Quick Edit never targets a
   * computed or nested column), so `data-field`/`aria-label` match it
   * exactly.
   */
  focusPath?: string;
  /**
   * W18 §13.5 — the documents of the result the editor was opened from, in
   * the order the list shows them; the ‹ › buttons walk it. Absent or not
   * containing `doc`: no previous/next.
   */
  siblings?: readonly unknown[];
}

interface InsertModeProps extends DocumentEditorBaseProps {
  mode: 'insert';
  /**
   * Pre-fill the draft (W18 §6, "Duplicate document") with the source
   * document's EJSON minus `_id` — the existing `stripIdForDuplicate`
   * helper in `views/docId.ts`. Defaults to the empty document `{}` when
   * omitted (plain "Insert").
   */
  initialDocJson?: string;
  onInserted: () => void;
  /**
   * Called instead of `onInserted`/`onClose` when an ordered `insertMany`
   * fails partway through the batch (a duplicate-key error on doc N of an
   * array leaves docs 0..N-1 persisted). Refresh the grid so the
   * partially-inserted rows are visible, but keep the editor open so the
   * user's unresolved text isn't discarded.
   */
  onPartialInsert?: () => void;
}

type DocumentEditorProps = EditModeProps | InsertModeProps;

const SIZE_PREF_KEY = 'ui.workspace.documentEditorSize';
const DEFAULT_WIDTH = 720;
// A definite default height, so the dialog is the same size for a one-line
// document and a long one, and the JSON editor has a height to fill. The 80vh
// cap on the dialog still wins in a short window.
const DEFAULT_HEIGHT = 520;
/** W18 §3 — the filter box appears only past this many top-level fields. */
const FILTER_BOX_THRESHOLD = 15;

interface EditorSize {
  width: number;
  height?: number;
}

function isEditorSize(v: unknown): v is EditorSize {
  if (v === null || typeof v !== 'object') return false;
  const { width, height } = v as Record<string, unknown>;
  return typeof width === 'number' && Number.isFinite(width) && (height === undefined || (typeof height === 'number' && Number.isFinite(height)));
}

/** The row's value, revived: live BSON instances, which `ejsonStringify` writes back with their type. */
function revive(doc: unknown): Doc {
  const revived = ejsonParse<unknown>(JSON.stringify(doc));
  if (!isPlainDocument(revived)) throw new Error('The Document Editor opens a document, not a bare value');
  return revived as Doc;
}

/**
 * The insert/duplicate seed, revived the same way `revive` does for an
 * existing row. Unlike `revive`, malformed or non-document input falls back
 * to the empty draft rather than throwing — this text was generated by
 * `stripIdForDuplicate` (which has the same fallback) or is the plain
 * Insert default, never something the user could have mistyped yet.
 */
function reviveInsertSeed(json: string | undefined): Doc {
  try {
    const parsed = ejsonParse<unknown>(json ?? '{}');
    return isPlainDocument(parsed) ? (parsed as Doc) : {};
  } catch {
    return {};
  }
}

interface RowCtx {
  connectionId: string;
  dbName: string;
  collection: string;
  /** What the editor loaded: the type preview under a row compares against it. */
  original: Doc;
  draft: Doc;
  changes: DocDiff;
  texts: ReadonlyMap<string, string>;
  collapsed: ReadonlySet<string>;
  entriesByPath: Map<string, SchemaSampleEntry>;
  /** Root-level-only (W18 §3); narrows visible rows by name, never their edits. */
  filterText: string;
  patchDraft: (updater: (d: Doc) => Doc) => void;
  patchTexts: (updater: (m: ReadonlyMap<string, string>) => ReadonlyMap<string, string>) => void;
  patchCollapsed: (updater: (s: ReadonlySet<string>) => ReadonlySet<string>) => void;
  toggleCollapsed: (key: string) => void;
  setErr: (e: string | null) => void;
  /** The "Edit in JSON" link on a read-only ("other" kind) row. */
  switchToJson: () => void;
  /** Focus the row with this key once the next render has committed it (a removal remounts array siblings, so no DOM node survives to be focused now). */
  focusRowAfterRender: (key: string | null) => void;
}

/** Whether some row nested under `segments` holds text that doesn't parse. */
function hasPendingErrorUnder(ctx: RowCtx, segments: readonly string[]): boolean {
  for (const [key, text] of ctx.texts) {
    const rowSegments = decodeKey(key);
    if (!rowSegments || rowSegments.length <= segments.length) continue;
    if (!segments.every((s, i) => rowSegments[i] === s)) continue;
    const found = getAtSegments(ctx.draft, rowSegments);
    if (found && !parseAs(kindOf(found.value), text).ok) return true;
  }
  return false;
}

function warningFor(entriesByPath: Map<string, SchemaSampleEntry>, field: string, value: unknown): TypeWarning | null {
  if (entriesByPath.size === 0 || field.includes('.')) return null;
  // `inferType` reads sentinel shapes, the vocabulary the sample was
  // recorded in, so the revived value goes back to one first.
  const actual = inferType(JSON.parse(ejsonStringify(value)) as unknown);
  return actual === 'object' ? null : checkFieldType(entriesByPath, field, actual);
}

/** One level of indent for a container's children — a constant step per level, applied once per nesting, never multiplied by depth. */
const INDENT = 16;
/** How far the Add-field/Add-item row sits in from the rows it adds to, so it reads as belonging to that level. */
const ADD_ROW_OFFSET = 16;

/**
 * W18 §13.1 — Escape in a value hands focus to the row. Mantine's own Escape
 * (a capture-phase `window` listener) reads this marker off the event target
 * and stands down, so this Escape never reaches the dismiss path; the next
 * one, from the row, does.
 */
const VALUE_STOP = { 'data-mantine-stop-propagation': 'true' } as const;

const ROW_SELECTOR = '[data-field-row]';

function FieldRow({ ctx, segments }: { ctx: RowCtx; segments: string[] }) {
  const T = themeVars;
  const rowRef = React.useRef<HTMLDivElement>(null);
  const valueRef = React.useRef<HTMLElement | null>(null);
  const typeRef = React.useRef<HTMLSelectElement>(null);
  const found = getAtSegments(ctx.draft, segments);
  if (!found) return null; // removed by a sibling edit in the same render pass
  const value = found.value;
  const kind = kindOf(value);
  const name = segments[segments.length - 1]!;
  const isRoot = segments.length === 1;
  const locked = isRoot && (name === '_id' || isUnsafeFieldName(name));
  const dotted = segments.join('.');
  const key = keyOf(segments);
  // `editAddress` redirects a row under an unsafe name or an array to its
  // nearest safe/array ancestor — the only path the diff could actually
  // contain. Whether that redirected address is the row's own tells apart
  // the ancestor that legitimately owns the mark from a descendant (an
  // array element, or anything nested under one) that merely shares it;
  // only the former claims the "edited" marker.
  const safeAddress = editAddress(ctx.draft, segments);
  const edited = safeAddress === dotted && isEdited(ctx.changes, safeAddress);
  const warning = isRoot ? warningFor(ctx.entriesByPath, name, value) : null;

  const parentSegments = segments.slice(0, -1);
  const parentValue = parentSegments.length > 0 ? getAtSegments(ctx.draft, parentSegments)?.value : undefined;
  const isArrayElement = Array.isArray(parentValue);
  const displayName = isArrayElement ? `[${name}]` : name;

  const isContainer = kind === 'object' || kind === 'array';
  const hasTypeSelector = !locked && kind !== 'other';
  const hasValueControl = hasTypeSelector && kind !== 'null' && !isContainer;
  const removable = !locked;
  // A container stays open, even if the user collapsed it, while a row
  // nested under it holds text that doesn't parse — collapsing must never
  // hide the only explanation for why Save is disabled.
  const isCollapsed = ctx.collapsed.has(key) && !hasPendingErrorUnder(ctx, segments);

  // The type preview (W18 §13.2): shown under the row as soon as the selector
  // changes the type, before anything is saved.
  // Not for an array element or anything under one: removing a sibling shifts
  // the indexes, so "the same address" would compare two different values.
  const loaded = safeAddress === dotted ? getAtSegments(ctx.original, segments) : null;
  const typeChange = loaded ? typeChangeOf(loaded.value, value) : undefined;
  const typeNote = loaded && typeChange ? typeChangeText(loaded.value, value, typeChange) : null;

  const text = ctx.texts.get(key) ?? (hasValueControl ? textOf(kind, value) : '');
  const parsedText = hasValueControl && ctx.texts.has(key) ? parseAs(kind, ctx.texts.get(key)!) : null;
  const rowError = parsedText && !parsedText.ok ? parsedText.error : undefined;

  const editText = (nextText: string) => {
    ctx.patchTexts((m) => new Map(m).set(key, nextText));
    ctx.setErr(null);
    const parsed = parseAs(kind, nextText);
    if (parsed.ok) ctx.patchDraft((d) => setAtSegments(d, segments, parsed.value));
  };

  const onTypeChange = (nextKind: FieldKind) => {
    const converted = convertType(kind, nextKind, value);
    ctx.patchDraft((d) => setAtSegments(d, segments, converted));
    ctx.patchTexts((m) => purgeUnder(m, segments));
    ctx.setErr(null);
  };

  // Removing an array *element* shifts every later index down, so pending
  // text/collapsed state keyed by a later index moves down with it — a
  // half-typed value stays on the element it was typed into. Removing an
  // object field never reindexes anything, so purging its own segments is
  // enough there.
  const onRemove = () => {
    ctx.patchDraft((d) => deleteAtSegments(d, segments));
    if (isArrayElement) {
      ctx.patchTexts((m) => rekeyMapAfterRemoval(m, segments));
      ctx.patchCollapsed((s) => rekeySetAfterRemoval(s, segments));
    } else {
      ctx.patchTexts((m) => purgeUnder(m, segments));
      ctx.patchCollapsed((s) => purgeCollapsedUnder(s, segments));
    }
    ctx.setErr(null);
  };

  // Row mode (W18 §13.1): the row itself holds focus, and a key acts on it.
  // Only keys pressed on the row count — the same keys typed in a value or
  // the type selector bubble through here and must be left alone.
  const rowEls = () => Array.from(rowRef.current?.closest('[data-testid="document-editor-fields-body"]')?.querySelectorAll<HTMLElement>(ROW_SELECTOR) ?? []);
  const onRowKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case 't':
      case 'T': {
        const select = typeRef.current;
        if (!select) return;
        e.preventDefault();
        select.focus();
        if (typeof select.showPicker === 'function') select.showPicker();
        return;
      }
      case 'Backspace':
      case 'Delete': {
        if (!removable) return;
        e.preventDefault();
        // Focus a neighbour that survives the removal: the next row outside
        // this one's own children, else the one above. By key, after the
        // render: removing an array element remounts its siblings, and a
        // later one then sits one index lower.
        const rows = rowEls();
        const at = rows.indexOf(e.currentTarget);
        const item = e.currentTarget.parentElement;
        const survivor = rows.find((r, i) => i > at && !item?.contains(r)) ?? rows[at - 1];
        const survivorKey = survivor?.dataset.fieldRow ?? null;
        ctx.focusRowAfterRender(survivorKey !== null && isArrayElement ? rekeyAfterRemoval(survivorKey, segments) : survivorKey);
        onRemove();
        return;
      }
      case 'Enter':
        e.preventDefault();
        valueRef.current?.focus();
        return;
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        const rows = rowEls();
        rows[rows.indexOf(e.currentTarget) + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
        return;
      }
    }
  };
  // Escape in a value or the expand control: up to the row, consumed here.
  const onValueKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    rowRef.current?.focus();
  };

  return (
    // The listitem wraps the row and its children, so a nested list stays
    // inside an item rather than becoming a bare child of the parent list.
    <div role="listitem" data-field={dotted} data-edited={edited || undefined}>
      <div
        ref={rowRef}
        tabIndex={-1}
        data-field-row={key}
        onKeyDown={onRowKeyDown}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: T.gapSm,
          padding: '4px 6px',
          borderLeft: `2px solid ${edited ? T.accent : 'transparent'}`,
        }}
      >
        <div style={{ width: 180, flexShrink: 0, display: 'flex', alignItems: 'center', gap: T.gapXs, paddingTop: 4 }}>
          {isContainer && (
            <ActionIcon
              type="button"
              variant="subtle"
              color="gray"
              size="xs"
              aria-expanded={!isCollapsed}
              aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${dotted}`}
              ref={valueRef as React.Ref<HTMLButtonElement>}
              {...VALUE_STOP}
              onKeyDown={onValueKeyDown}
              onClick={() => ctx.toggleCollapsed(key)}
              style={{ fontSize: T.fsXs }}
            >
              {isCollapsed ? '▸' : '▾'}
            </ActionIcon>
          )}
          <Text size="sm" ff="monospace" style={{ overflowWrap: 'anywhere' }}>
            {displayName}
            {edited && (
              <Text span size="xs" c={T.accentInk} ml={6}>
                edited
              </Text>
            )}
          </Text>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {!hasValueControl ? (
            isContainer ? null : (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: T.gapSm, flexWrap: 'wrap' }}>
                <Text size="sm" ff="monospace" c="dimmed" style={{ overflowWrap: 'anywhere', paddingTop: 4 }}>
                  {kind === 'null' ? 'null' : textOf(kind, value)}
                </Text>
                {kind === 'other' && (
                  <Button size="compact-xs" variant="subtle" onClick={ctx.switchToJson} px={4}>
                    Edit in JSON
                  </Button>
                )}
              </div>
            )
          ) : kind === 'boolean' ? (
            <Switch
              aria-label={dotted}
              ref={valueRef as React.Ref<HTMLInputElement>}
              {...VALUE_STOP}
              onKeyDown={onValueKeyDown}
              checked={value === true}
              onChange={(e) => {
                const { checked } = e.currentTarget;
                ctx.setErr(null);
                ctx.patchDraft((d) => setAtSegments(d, segments, checked));
              }}
              mt={6}
            />
          ) : kind === 'string' ? (
            <Textarea
              aria-label={dotted}
              ref={valueRef as React.Ref<HTMLTextAreaElement>}
              {...VALUE_STOP}
              onKeyDown={onValueKeyDown}
              value={text}
              onChange={(e) => editText(e.currentTarget.value)}
              error={rowError}
              // Grows past one line natively (Chromium's `field-sizing`),
              // without Mantine's JS autosize.
              rows={1}
              styles={{ input: { fieldSizing: 'content', maxHeight: 160 } }}
              size="xs"
              ff="monospace"
              spellCheck={false}
            />
          ) : (
            <TextInput
              aria-label={dotted}
              ref={valueRef as React.Ref<HTMLInputElement>}
              {...VALUE_STOP}
              onKeyDown={onValueKeyDown}
              value={text}
              onChange={(e) => editText(e.currentTarget.value)}
              error={rowError}
              inputMode={kind === 'date' || kind === 'objectId' ? undefined : 'decimal'}
              size="xs"
              ff="monospace"
              spellCheck={false}
              description={kind === 'date' && value instanceof Date ? `Local: ${value.toLocaleString()}` : undefined}
              inputWrapperOrder={['label', 'input', 'description', 'error']}
            />
          )}
          {typeNote && (
            <Text size="xs" c="dimmed" mt={2} ff="monospace" data-testid="document-editor-type-change">
              {typeNote}
            </Text>
          )}
          {warning && (
            <Text size="xs" c="dimmed" mt={2} data-testid="document-editor-type-warning">
              {`Field "${warning.field}" is usually ${warning.expectedType} (${warning.percent}% of sampled documents). This value is ${warning.actualType}.`}
            </Text>
          )}
        </div>
        {/* Wide enough for the longest type name, "Decimal128" (W18 §13.1). */}
        <div style={{ width: 136, flexShrink: 0, paddingTop: 2 }}>
          {hasTypeSelector ? (
            <NativeSelect
              aria-label={`${dotted} type`}
              ref={typeRef}
              // Out of the Tab order, not out of the tree (W18 §13.1): `T` on
              // the row opens it, and a click still works.
              tabIndex={-1}
              value={kind}
              // A bare JS number isn't a selectable target — bson infers its
              // saved type, not this selector — so it gets a disabled
              // placeholder option instead of being folded into 'double',
              // which would make Double look already selected and take a
              // click to convert without firing onChange.
              data={[
                ...(kind === 'number' ? [{ value: 'number', label: TYPE_LABEL.number, disabled: true }] : []),
                ...SELECTABLE_KINDS.map((k) => ({ value: k, label: TYPE_LABEL[k] })),
              ]}
              onChange={(e) => onTypeChange(e.currentTarget.value as FieldKind)}
              size="xs"
            />
          ) : (
            <Text size="xs" c="dimmed" style={{ paddingTop: 6 }}>
              {typeLabel(kind, value)}
            </Text>
          )}
        </div>
        <div style={{ width: 28, flexShrink: 0 }}>
          {removable && (
            <Button
              size="compact-xs"
              variant="subtle"
              color="red"
              aria-label={`Remove ${dotted}`}
              tabIndex={-1}
              onClick={onRemove}
              px={4}
            >
              &times;
            </Button>
          )}
        </div>
      </div>
      {isContainer && !isCollapsed && (
        <div style={{ paddingLeft: INDENT }}>
          <RowsList ctx={ctx} parentSegments={segments} />
        </div>
      )}
    </div>
  );
}

function AddFieldRow({
  ctx,
  parentSegments,
  existing,
}: {
  ctx: RowCtx;
  parentSegments: readonly string[];
  existing: readonly string[];
}) {
  const [name, setName] = React.useState('');
  const [err, setErrLocal] = React.useState<string | null>(null);
  const isRootLevel = parentSegments.length === 0;

  const suggestionContext: SuggestionContext = React.useMemo(
    () => ({ connectionId: ctx.connectionId, dbName: ctx.dbName, collection: ctx.collection }),
    [ctx.connectionId, ctx.dbName, ctx.collection],
  );
  const ariaLabel = isRootLevel ? 'New field name' : `New field name under ${parentSegments.join('.')}`;

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    if (existing.includes(trimmed)) {
      setErrLocal(`A field named "${trimmed}" already exists`);
      return;
    }
    if (isRootLevel && isUnsafeFieldName(trimmed)) {
      setErrLocal('This name cannot be saved from here: it must not contain "." or start with "$"');
      return;
    }
    ctx.patchDraft((d) => setAtSegments(d, [...parentSegments, trimmed], ''));
    ctx.setErr(null);
    setName('');
    setErrLocal(null);
  };

  return (
    <div
      data-testid={`add-field-${isRootLevel ? 'root' : parentSegments.join('.')}`}
      style={{ display: 'flex', alignItems: 'center', gap: themeVars.gapSm, padding: '4px 6px', marginLeft: ADD_ROW_OFFSET }}
    >
      <div style={{ flex: 1, minWidth: 0, maxWidth: 260 }}>
        <FieldAutocompleteInput
          value={name}
          onChange={(v) => {
            setName(v);
            setErrLocal(null);
          }}
          context={suggestionContext}
          ariaLabel={ariaLabel}
          placeholder="Add field"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          style={{ width: '100%', fontFamily: 'monospace', fontSize: themeVars.fsSm, padding: '4px 6px' }}
        />
      </div>
      <Button size="compact-xs" variant="default" disabled={name.trim() === ''} onClick={submit}>
        Add field
      </Button>
      {err && (
        <Text size="xs" c="red">
          {err}
        </Text>
      )}
    </div>
  );
}

/** The array counterpart of `AddFieldRow`: no name to type, just appends an empty-string element. */
function AddItemRow({ ctx, parentSegments, length }: { ctx: RowCtx; parentSegments: readonly string[]; length: number }) {
  const submit = () => {
    ctx.patchDraft((d) => setAtSegments(d, [...parentSegments, String(length)], ''));
    ctx.setErr(null);
  };

  return (
    <div
      data-testid={`add-item-${parentSegments.join('.')}`}
      style={{ display: 'flex', alignItems: 'center', gap: themeVars.gapSm, padding: '4px 6px', marginLeft: ADD_ROW_OFFSET }}
    >
      <Button size="compact-xs" variant="default" onClick={submit}>
        Add item
      </Button>
    </div>
  );
}

function RowsList({ ctx, parentSegments }: { ctx: RowCtx; parentSegments: readonly string[] }) {
  const isRoot = parentSegments.length === 0;
  const found = isRoot ? { value: ctx.draft as unknown } : getAtSegments(ctx.draft, parentSegments);
  const listLabel = isRoot ? 'Fields' : `Fields of ${parentSegments.join('.')}`;

  if (Array.isArray(found?.value)) {
    const length = found.value.length;
    return (
      <div role="list" aria-label={listLabel} style={{ minHeight: 0 }}>
        {/* Keyed by length too: a removal shifts every later element down an
            index, so each element's subtree remounts rather than inheriting
            the local state (a half-typed Add field name) of the one before. */}
        {found.value.map((_, i) => (
          <FieldRow key={`${length}:${i}`} ctx={ctx} segments={[...parentSegments, String(i)]} />
        ))}
        <AddItemRow ctx={ctx} parentSegments={parentSegments} length={length} />
      </div>
    );
  }

  const obj = found && isPlainDocument(found.value) ? (found.value as Doc) : {};
  const allKeys = Object.keys(obj);
  // The filter box is root-only (W18 §3): a nested object's own rows are
  // never narrowed, only which top-level rows are shown.
  const needle = isRoot ? ctx.filterText.trim().toLowerCase() : '';
  const keys = needle ? allKeys.filter((k) => k.toLowerCase().includes(needle)) : allKeys;
  return (
    <div role="list" aria-label={listLabel} style={{ minHeight: 0 }}>
      {keys.map((k) => (
        <FieldRow key={k} ctx={ctx} segments={[...parentSegments, k]} />
      ))}
      <AddFieldRow ctx={ctx} parentSegments={parentSegments} existing={allKeys} />
    </div>
  );
}

/** Where `doc` sits in `list`: the same object, else the same `_id`; -1 when neither. */
function indexOfDoc(list: readonly unknown[], doc: unknown): number {
  const at = list.indexOf(doc);
  if (at >= 0) return at;
  const idOf = (d: unknown) => JSON.stringify((d as { _id?: unknown } | null)?._id);
  const id = idOf(doc);
  return id === undefined ? -1 : list.findIndex((d) => idOf(d) === id);
}

/** `{ doc }` from a committed Fields-shaped draft, or `{ docs }` from a
 * top-level array — only reachable in `mode: 'insert'` (§6). */
type JsonCommit = { kind: 'doc'; doc: Doc } | { kind: 'array'; docs: unknown[] };

export function DocumentEditor(props: DocumentEditorProps) {
  const { connectionId, dbName, collection, onClose, mode } = props;
  const onSaved = props.mode === 'edit' ? props.onSaved : undefined;
  const focusPath = props.mode === 'edit' ? props.focusPath : undefined;
  const siblings = props.mode === 'edit' ? props.siblings : undefined;
  const onInserted = props.mode === 'insert' ? props.onInserted : undefined;
  const onPartialInsert = props.mode === 'insert' ? props.onPartialInsert : undefined;

  const seedDoc = () => (props.mode === 'edit' ? revive(props.doc) : reviveInsertSeed(props.initialDocJson));

  const [original, setOriginal] = React.useState<Doc>(seedDoc);
  const [draft, setDraft] = React.useState<Doc>(seedDoc);
  // Text as typed, only for rows the user has touched, keyed by
  // `keyOf(segments)`. A value that doesn't parse stays here, and out of the
  // draft, until it does.
  const [texts, setTexts] = React.useState<ReadonlyMap<string, string>>(() => new Map());
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() => new Set());
  const [err, setErr] = React.useState<string | null>(null);
  // W18 §13.3/§13.4: `changed` carries the server's current copy, `deleted`
  // means the fetch found nothing.
  const [conflict, setConflict] = React.useState<{ kind: 'changed'; server: Doc } | { kind: 'deleted' } | null>(null);
  const [choices, setChoices] = React.useState<ReadonlyMap<string, ConflictChoice>>(() => new Map());
  // W18 §13.5 — the documents ‹ › walk, and where in them this one sits. The
  // list is a copy: a save updates its own entry, so stepping back to a
  // document just saved shows what was saved, not what the page loaded.
  const [list, setList] = React.useState<readonly unknown[]>(() => siblings ?? []);
  const [index, setIndex] = React.useState(() => (props.mode === 'edit' ? indexOfDoc(siblings ?? [], props.doc) : -1));
  // Set by a successful write: closing then reports it, once, so the tab's
  // query re-runs when the editor closes and not on every move.
  const savedRef = React.useRef<{ auditId: string | undefined } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [filterText, setFilterText] = React.useState('');

  // W18 §2/§4 — the JSON view's own draft of the same document, as Shell
  // Syntax text (X14). It is regenerated from `draft` on every switch *into*
  // this view, and only written back into `draft` on a successful switch
  // away or Save — never per keystroke, so a half-typed edit is never
  // reflected (or lost) behind the user's back.
  const [view, setView] = React.useState<'fields' | 'json'>('fields');
  const [jsonText, setJsonText] = React.useState('');

  // One diff drives the edited markers, the dirty guard and the save, so the
  // three cannot disagree. In `mode: 'insert'` `original` is the seed the
  // editor opened with (the empty document, or the duplicate source minus
  // `_id`) — there is no server copy to diff against (§6) — so this is
  // "differs from what the draft started as", the same thing it means in
  // `mode: 'edit'`.
  const changes = React.useMemo(() => diff(original, draft), [original, draft]);
  const changeEntries = React.useMemo(() => (mode === 'edit' ? changeList(original, draft) : []), [mode, original, draft]);
  const conflictRows = React.useMemo(
    () => (conflict?.kind === 'changed' ? classifyConflict(original, draft, conflict.server) : []),
    [conflict, original, draft],
  );
  const choicesPending = conflictRows.some((r) => r.changedBy === 'both' && !choices.has(r.path));
  const rowErrors = React.useMemo(() => {
    const out = new Map<string, string>();
    for (const [key, text] of texts) {
      const segments = decodeKey(key);
      if (!segments) continue;
      const found = getAtSegments(draft, segments);
      if (!found) continue; // the row was removed or its type changed since
      const parsed = parseAs(kindOf(found.value), text);
      if (!parsed.ok) out.set(key, parsed.error);
    }
    return out;
  }, [texts, draft]);

  // Live, from the raw `jsonText` — never written back until a commit point
  // (blur, switch, Save), the same asymmetry X14's read surfaces use. The
  // transform's own refusal comes first; a text that repairs but isn't
  // usable fails a second, mode-specific check instead.
  const jsonField = useShellSyntaxField({ value: jsonText, commit: setJsonText });
  const jsonOutcome = jsonField.outcome;
  const jsonLiveError = React.useMemo(() => {
    if (jsonOutcome.kind === 'failed') return refusalMessage(jsonText, jsonOutcome);
    const canonical = jsonOutcome.kind === 'repaired' ? jsonOutcome.text : jsonText;
    if (mode === 'edit') {
      const parsed = parseJsonDraft(canonical, original._id);
      return parsed.ok ? null : parsed.error;
    }
    // mode: 'insert' — a document or a top-level array of documents, per §6.
    let parsedValue: unknown;
    try {
      parsedValue = ejsonParse(canonical);
    } catch {
      return 'Invalid EJSON';
    }
    const cls = classifyInsertPayload(parsedValue);
    if (cls.kind === 'array-empty') return 'Array must contain at least one document';
    if (cls.kind === 'array-invalid-items') return 'Every array item must be a document';
    if (cls.kind === 'single' && !isPlainDocument(parsedValue)) return 'Enter a JSON document or an array of documents';
    return null;
  }, [jsonOutcome, jsonText, original, mode]);

  // Repairs and commits `jsonText` (writing the canonical text back into the
  // box, per X14), then parses it into a draft document or (`mode: 'insert'`
  // only) an array to insert-many. Null means refused — `jsonLiveError`
  // already carries why, recomputed from the (possibly now repaired) text on
  // the next render.
  const commitJson = (): JsonCommit | null => {
    const result = jsonField.commitNow();
    if (result.outcome.kind === 'failed') return null;
    if (mode === 'edit') {
      const parsed = parseJsonDraft(result.text, original._id);
      return parsed.ok ? { kind: 'doc', doc: parsed.doc } : null;
    }
    let parsedValue: unknown;
    try {
      parsedValue = ejsonParse(result.text);
    } catch {
      return null;
    }
    const cls = classifyInsertPayload(parsedValue);
    if (cls.kind === 'array-empty' || cls.kind === 'array-invalid-items') return null;
    if (cls.kind === 'array') return { kind: 'array', docs: parsedValue as unknown[] };
    if (!isPlainDocument(parsedValue)) return null;
    return { kind: 'doc', doc: parsedValue as Doc };
  };

  const switchToJson = () => {
    // A row's typed text that doesn't parse lives only in `texts`, out of
    // `draft` — building `jsonText` from `draft` alone would show the old
    // value, and the switch away from Fields (§4a) clears `texts`
    // unconditionally, so that text would vanish with no warning.
    if (rowErrors.size > 0) {
      setErr('Fix the invalid values in Fields before switching to JSON');
      return;
    }
    setJsonText(ejsonStringifyReadable(draft, 2));
    setView('json');
  };

  const trySwitchToFields = () => {
    const result = commitJson();
    if (!result) return; // refused; stays on JSON with the text and error intact
    if (result.kind === 'array') {
      // W18 §6 — Fields shows one document; an array stays on JSON.
      setErr('Fields view is not available for an array of documents. Edit it here, or Insert to add them all.');
      return;
    }
    setDraft(result.doc);
    setTexts(new Map());
    setView('fields');
  };

  const isDirty =
    !isEmptyDiff(changes) ||
    rowErrors.size > 0 ||
    (view === 'json' && jsonText !== ejsonStringifyReadable(draft, 2));

  const close = useDialogFocusReturn(onClose);
  // Every way out of an edit goes through here, so a document saved on the
  // way (Save and go) is reported when the editor closes, whichever way that is.
  const finish = () => {
    if (savedRef.current) onSaved?.(savedRef.current.auditId);
    close();
  };

  const requestClose = async () => {
    if (!isDirty) return finish();
    const discard = await confirmDestructive({
      title: 'Discard changes?',
      body: 'This closes the editor and loses what you typed.',
      confirmLabel: 'Discard',
    });
    if (discard) finish();
  };

  // W17 — read-only: nothing here feeds the save, and nothing disables it.
  const [structureEntries, setStructureEntries] = React.useState<SchemaSampleEntry[]>([]);
  React.useEffect(() => {
    let live = true;
    void getStructureEntries(connectionId, dbName, collection).then((entries) => {
      if (live) setStructureEntries(entries);
    });
    return () => {
      live = false;
    };
  }, [connectionId, dbName, collection]);
  const entriesByPath = React.useMemo(() => new Map(structureEntries.map((e) => [e.path, e])), [structureEntries]);

  /**
   * The draft as it stands, ready to send. The JSON view's own text is
   * committed first (a refusal returns null, and `jsonLiveError` already says
   * why); in Fields, a row whose text does not parse blocks the save.
   */
  const committedDraft = (): Doc | null => {
    if (view === 'json') {
      const result = commitJson();
      if (!result || result.kind !== 'doc') return null;
      setDraft(result.doc);
      return result.doc;
    }
    return rowErrors.size > 0 ? null : draft;
  };

  /** What a write changed, for the list ‹ › walks and for the close that reports it. */
  const recordSaved = (auditId: string | undefined, saved: Doc) => {
    savedRef.current = { auditId };
    if (index < 0) return;
    // The list holds canonical sentinels, as `find` delivers them.
    const stored = JSON.parse(ejsonStringify(saved)) as unknown;
    setList((l) => l.map((d, i) => (i === index ? stored : d)));
  };

  /** W18 §13.3 — the guarded write matched nothing: look at what is on the server now. */
  const loadConflict = async () => {
    try {
      const res = await api.query.findOne({
        connectionId,
        dbName,
        collection,
        filter: ejsonStringify({ _id: original._id }),
      });
      if (res.document === null) {
        setConflict({ kind: 'deleted' });
        return;
      }
      setChoices(new Map());
      setConflict({ kind: 'changed', server: revive(res.document) });
    } catch (e) {
      setErr(getErrorMessage(e, 'Could not load the current version of this document'));
    }
  };

  /** One guarded write of `next` over `base`. True: it landed, or there was nothing to send. */
  const writeEdit = async (base: Doc, next: Doc): Promise<boolean> => {
    let request;
    try {
      request = buildUpdateRequest(base, next);
    } catch (e) {
      setErr(getErrorMessage(e, 'Cannot save this document'));
      return false;
    }
    if (request === null) return true;
    setBusy(true);
    setErr(null);
    try {
      const res = await api.doc.updateOne({
        connectionId,
        dbName,
        collection,
        filterJson: request.filterJson,
        updateJson: request.updateJson,
      });
      if (res.matchedCount === 0) {
        await loadConflict();
        return false;
      }
      recordSaved(res.auditId, next);
      return true;
    } catch (e) {
      setErr(getErrorMessage(e, 'Save failed'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  /**
   * W18 §13.3 — the table is answered. The server's copy becomes the new
   * `original`, the user's diff goes back on top minus the paths given to the
   * server, and the write carries fresh guards. A second concurrent change
   * lands in `writeEdit` again and shows the table again.
   */
  const confirmConflict = async (server: Doc, mine: Doc): Promise<boolean> => {
    const resolved = resolveConflict(original, mine, server, choices);
    setOriginal(server);
    setDraft(resolved);
    setChoices(new Map());
    setConflict(null);
    const kept = diff(server, resolved);
    setTexts((m) => {
      const next = new Map<string, string>();
      for (const [key, text] of m) {
        const segments = decodeKey(key);
        if (segments && isEdited(kept, editAddress(resolved, segments))) next.set(key, text);
      }
      return next;
    });
    if (view === 'json') setJsonText(ejsonStringifyReadable(resolved, 2));
    const ok = await writeEdit(server, resolved);
    // Nothing left to send (everything went to the server): the list still
    // shows the old copy, so the close has to re-run the query.
    if (ok && !savedRef.current) savedRef.current = { auditId: undefined };
    return ok;
  };

  // Same guard as the Save button's `disabled`: ⌘↵ calls this directly,
  // bypassing the button.
  const saveBlocked =
    (view === 'fields' ? rowErrors.size > 0 : jsonLiveError !== null) ||
    conflict?.kind === 'deleted' ||
    (conflict?.kind === 'changed' && choicesPending);

  /** True when the edit is saved (or there was nothing to save). */
  const trySave = async (): Promise<boolean> => {
    if (busy || saveBlocked) return false;
    const next = committedDraft();
    if (!next) return false;
    if (conflict?.kind !== 'changed') return writeEdit(original, next);
    // JSON text committed just now can have added a clash the table has not
    // shown yet: it gets its own choice before anything is sent.
    const clashes = classifyConflict(original, next, conflict.server);
    if (clashes.some((r) => r.changedBy === 'both' && !choices.has(r.path))) return false;
    return confirmConflict(conflict.server, next);
  };

  const sendEdit = async () => {
    if (await trySave()) finish();
  };

  /** W18 §13.4 — "Insert as new document": the draft, with its original `_id`, as an insert. */
  const insertAsNew = async () => {
    if (busy) return;
    const next = committedDraft();
    if (!next) return;
    setBusy(true);
    setErr(null);
    try {
      await api.doc.insert({ connectionId, dbName, collection, docJson: ejsonStringify(next) });
      savedRef.current = { auditId: undefined };
      finish();
    } catch (e) {
      setErr(getErrorMessage(e, 'Insert failed'));
    } finally {
      setBusy(false);
    }
  };

  // The default copy format is the readable one (W06 §8.6).
  const copyMine = () => {
    // The JSON view's text may still be Shell Syntax: commit it, then print the draft.
    const mine = view === 'json' ? committedDraft() : draft;
    if (mine) void copyToClipboard(ejsonStringifyReadable(mine, 2), 'Copied your version');
  };

  const goTo = async (delta: -1 | 1) => {
    const target = index + delta;
    if (busy || target < 0 || target >= list.length) return;
    if (isDirty) {
      const choice = await confirmMove({ canSave: !saveBlocked });
      if (choice === 'stay') return;
      // Moves only if the save went through; a conflict keeps this document.
      if (choice === 'save' && !(await trySave())) return;
    }
    const next = revive(list[target]);
    setIndex(target);
    setOriginal(next);
    setDraft(next);
    setTexts(new Map());
    setCollapsed(new Set());
    setErr(null);
    setConflict(null);
    setChoices(new Map());
    setFilterText('');
    setView('fields');
    setJsonText('');
  };

  // W18 §6 — Insert sends the whole draft; there is no diff for a document
  // that doesn't exist yet. A top-level array routes to `doc:insertMany`
  // instead, via `classifyInsertPayload`.
  const sendInsert = async () => {
    if (busy) return;
    let payload: Doc | unknown[] = draft;
    if (view === 'json') {
      const result = commitJson();
      if (!result) return; // refused; jsonLiveError already shows why
      if (result.kind === 'array') {
        payload = result.docs;
      } else {
        setDraft(result.doc);
        payload = result.doc;
      }
    } else if (rowErrors.size > 0) {
      return;
    }
    // Only 'array' or 'single' can reach here: `commitJson` above already
    // refuses 'array-empty'/'array-invalid-items', and the Fields view can
    // only ever hold a plain document.
    const cls = classifyInsertPayload(payload);
    setBusy(true);
    setErr(null);
    try {
      if (cls.kind === 'array') {
        await api.doc.insertMany({ connectionId, dbName, collection, docsJson: ejsonStringify(payload) });
      } else {
        await api.doc.insert({ connectionId, dbName, collection, docJson: ejsonStringify(payload) });
      }
      onInserted?.();
      close();
    } catch (e) {
      const code = (e as { code?: string }).code;
      const details = (e as { details?: unknown }).details;
      const msg = getErrorMessage(e, 'Insert failed');
      const base = code === 'CONFLICT' ? `Conflict: ${msg}` : msg;
      const insertedCount =
        cls.kind === 'array' && details !== null && typeof details === 'object'
          ? (details as { insertedCount?: unknown }).insertedCount
          : undefined;
      if (cls.kind === 'array' && typeof insertedCount === 'number' && insertedCount > 0) {
        setErr(`${base} (${insertedCount} of ${cls.count} documents inserted before the error)`);
        onPartialInsert?.();
      } else {
        setErr(base);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSave = () => (mode === 'edit' ? sendEdit() : sendInsert());

  // ⌘↵ only: ⌘S is deliberately not a save key. PanelBody's own ⌘↵ (Run)
  // already skips events from inside a dialog.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
    e.preventDefault();
    void handleSave();
  };

  const [size, setSize] = React.useState<EditorSize>({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const renderedSize = React.useRef(size);
  // Layout effect: it lands before the browser's resize notifications for the
  // same frame, so a size just rendered is never mistaken for a drag.
  React.useLayoutEffect(() => {
    renderedSize.current = size;
  }, [size]);
  React.useEffect(() => {
    let live = true;
    void api.prefs
      .get<unknown>(SIZE_PREF_KEY)
      .then((v) => {
        // A remembered width with no height keeps the default height rather
        // than letting the dialog size itself to its content.
        if (live && isEditorSize(v)) setSize({ height: DEFAULT_HEIGHT, ...v });
      })
      // An unreadable pref leaves the default size; the log keeps the cause.
      .catch((err) => logFailure(`reading preference ${SIZE_PREF_KEY}`, err));
    return () => {
      live = false;
    };
  }, []);
  // The browser writes an inline width/height only when the user drags the
  // resize handle, so an inline size that differs from the rendered one is a
  // resize to remember — content growing inside an auto height is not.
  const observer = React.useRef<ResizeObserver | null>(null);
  const [surfaceEl, setSurfaceEl] = React.useState<HTMLDivElement | null>(null);
  const surfaceRef = React.useCallback((el: HTMLDivElement | null) => {
    setSurfaceEl(el);
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    observer.current = new ResizeObserver(() => {
      const width = Number.parseFloat(el.style.width);
      const height = Number.parseFloat(el.style.height);
      if (!Number.isFinite(width) || !Number.isFinite(height)) return;
      const shown = renderedSize.current;
      if (width === shown.width && height === shown.height) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Losing a remembered size costs nothing but the next open's width.
        void api.prefs
          .set(SIZE_PREF_KEY, { width, height })
          .catch((err) => logFailure(`saving preference ${SIZE_PREF_KEY}`, err));
      }, 300);
    });
    observer.current.observe(el);
  }, []);

  // W18 §8 — Quick Edit's "open the editor on that field": scroll the row
  // into view, and marks its control `data-autofocus` for Mantine's own
  // `FocusTrap` (`@mantine/hooks`' `useFocusTrap`) to focus. `focusPath` is
  // fixed for this instance's whole lifetime (it comes from the props that
  // created it), and Fields — where the row lives — is always the view on
  // open (§2's default), so this never has to react to a later change.
  //
  // Marking the attribute rather than calling `.focus()` directly is
  // load-bearing, not stylistic: the trap schedules its own initial-focus
  // pass with `setTimeout(0)` (`use-focus-trap.ts`'s `setRef`/mount effect,
  // both deferred), which always runs after this effect's synchronous body
  // — a direct `.focus()` here would just lose that race and read as
  // "focused" for one tick before the trap grabs it back to the modal's
  // Close button. `querySelector('[data-autofocus]')` is the trap's own
  // first lookup, ahead of its tabbable-element fallback, so setting the
  // attribute now is visible to it whenever it actually runs.
  //
  // It follows the surface element arriving (`surfaceEl`) rather than running
  // once on mount: the dialog's content mounts in a portal after this
  // component's first effects, so a mount-time lookup finds no container.
  React.useEffect(() => {
    const container = surfaceEl;
    if (!container) return;
    if (!focusPath) {
      // No targeted field: open on the first one a person can type in (the
      // filter box when there is one), not on the dialog's Close button.
      // Only when `focusPath` is absent, or this would compete with the
      // targeted `data-autofocus` below. Scoped to the fields list: the view
      // switch above it has inputs of its own.
      container
        .querySelector('[data-testid="document-editor-fields-body"]')
        ?.querySelector('input:not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly])')
        ?.setAttribute('data-autofocus', 'true');
      return;
    }
    const path = focusPath;
    const escaped = CSS.escape(path);
    const rowEl = container.querySelector(`[data-field="${escaped}"]`);
    rowEl?.scrollIntoView({ block: 'center' });
    // The row's own value control (Switch/TextInput/Textarea share the
    // `aria-label={dotted}` convention); an Object row has none of those and
    // gets its collapse toggle instead, and an 'other' row its "Edit in
    // JSON" link — both live inside `rowEl`.
    const control =
      container.querySelector(`[aria-label="${escaped}"]`) ??
      rowEl?.querySelector('button') ??
      null;
    control?.setAttribute('data-autofocus', 'true');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceEl]);

  // A removed row's neighbour, focused once the removal has rendered.
  const focusRowKey = React.useRef<string | null>(null);
  React.useLayoutEffect(() => {
    const key = focusRowKey.current;
    if (key === null) return;
    focusRowKey.current = null;
    surfaceEl?.querySelector<HTMLElement>(`[data-field-row="${CSS.escape(key)}"]`)?.focus();
  });

  // After ‹ ›: the new document starts at its first value, scrolled to the top.
  // (The button just pressed may now be disabled, and would drop focus.)
  const movedFrom = React.useRef(index);
  React.useEffect(() => {
    if (movedFrom.current === index) return;
    movedFrom.current = index;
    const body = surfaceEl?.querySelector<HTMLElement>('[data-testid="document-editor-fields-body"]');
    body?.scrollTo?.({ top: 0 });
    body?.querySelector<HTMLElement>('input:not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly])')?.focus();
  }, [index, surfaceEl]);

  // W18 §6 — the Insert button label, live off the uncommitted JSON buffer:
  // an array shows its count before Save is even pressed, and stays current
  // as the user keeps editing (never off a value captured at an earlier
  // commit).
  const livePayload = React.useMemo<InsertPayloadClassification | null>(() => {
    if (mode !== 'insert') return null;
    if (view === 'fields') return { kind: 'single' };
    if (jsonOutcome.kind === 'failed') return null;
    const canonical = jsonOutcome.kind === 'repaired' ? jsonOutcome.text : jsonText;
    try {
      return classifyInsertPayload(ejsonParse(canonical));
    } catch {
      return null;
    }
  }, [mode, view, jsonOutcome, jsonText]);

  const submitLabel =
    mode === 'edit'
      ? busy
        ? 'Saving…'
        : 'Save'
      : livePayload?.kind === 'array'
        ? busy
          ? `Inserting ${livePayload.count} documents…`
          : `Insert ${livePayload.count} documents`
        : busy
          ? 'Inserting…'
          : 'Insert';

  const ctx: RowCtx = {
    connectionId,
    dbName,
    collection,
    original,
    draft,
    changes,
    texts,
    collapsed,
    entriesByPath,
    filterText,
    patchDraft: (updater) => setDraft(updater),
    patchTexts: (updater) => setTexts(updater),
    patchCollapsed: (updater) => setCollapsed(updater),
    toggleCollapsed: (key) =>
      setCollapsed((s) => {
        const next = new Set(s);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    setErr,
    switchToJson,
    focusRowAfterRender: (key) => {
      focusRowKey.current = key;
    },
  };

  return (
    // `closeOnClickOutside={false}` is load-bearing: one stray click on the
    // backdrop must not reach the close path and discard a typed draft.
    // Escape still closes, through `requestClose` and its prompt.
    <Modal
      opened
      onClose={() => void requestClose()}
      title={mode === 'edit' ? 'Edit document' : 'Insert document'}
      centered
      size="auto"
      closeOnClickOutside={false}
      // The 80vh cap sits on the whole dialog, header included, and the body
      // is a flex column so the surface shrinks under it instead of pushing
      // Save past the viewport; the field list is what scrolls.
      styles={{
        content: { display: 'flex', flexDirection: 'column', maxHeight: '80vh', overflow: 'hidden' },
        body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
      }}
    >
      {/* The wrapper carries the key handler so ⌘↵ also works from the footer;
          the footer sits outside the resizable surface so the browser's resize
          grip lands above it, never on Save. */}
      <div onKeyDown={handleKeyDown} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: themeVars.gapSm }}>
        <div
          ref={surfaceRef}
          data-testid="document-editor-surface"
          style={{
            width: size.width,
            height: size.height,
            minWidth: 360,
            minHeight: 0,
            maxWidth: '95vw',
            resize: 'both',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            gap: themeVars.gapSm,
          }}
        >
          <Group justify="space-between" align="center">
            <Group gap={themeVars.gapXs} align="center">
              {mode === 'edit' && index >= 0 && (
                <>
                  <Tooltip label="Previous document" withArrow>
                    <ActionIcon
                      type="button"
                      variant="subtle"
                      color="gray"
                      size="sm"
                      aria-label="Previous document"
                      disabled={index === 0 || busy}
                      onClick={() => void goTo(-1)}
                    >
                      ‹
                    </ActionIcon>
                  </Tooltip>
                  <Text size="xs" c="dimmed" aria-live="polite">{`${index + 1} of ${list.length}`}</Text>
                  <Tooltip label="Next document" withArrow>
                    <ActionIcon
                      type="button"
                      variant="subtle"
                      color="gray"
                      size="sm"
                      aria-label="Next document"
                      disabled={index === list.length - 1 || busy}
                      onClick={() => void goTo(1)}
                    >
                      ›
                    </ActionIcon>
                  </Tooltip>
                </>
              )}
              <Text size="xs" c="dimmed" ff="monospace">{`${dbName}.${collection}`}</Text>
            </Group>
            <SegmentedControl
              size="xs"
              aria-label="View"
              value={view}
              onChange={(next) => (next === 'json' ? switchToJson() : trySwitchToFields())}
              data={[
                { label: 'Fields', value: 'fields' },
                { label: 'JSON', value: 'json' },
              ]}
            />
          </Group>

          {view === 'json' ? (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: themeVars.gapXs }}>
              {/* Absolutely filled, so the editor's own height resolves whatever the
                  flex shrink did to this box; it scrolls inside instead of growing
                  under the footer. */}
              <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                <div style={{ position: 'absolute', inset: 0 }}>
                  <ScriptEditor
                    value={jsonText}
                    onChange={(next) => {
                      setJsonText(next);
                      setErr(null);
                    }}
                    onBlur={() => void commitJson()}
                    height="100%"
                    ariaLabel="Document JSON"
                    testId="document-editor-json"
                  />
                </div>
              </div>
              {jsonLiveError && (
                <Text size="xs" c="red" role="alert" style={{ flex: 'none' }}>
                  {jsonLiveError}
                </Text>
              )}
            </div>
          ) : (
            <div data-testid="document-editor-fields-body" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              {Object.keys(draft).length > FILTER_BOX_THRESHOLD && (
                <TextInput
                  aria-label="Filter fields"
                  placeholder="Filter fields"
                  value={filterText}
                  onChange={(e) => setFilterText(e.currentTarget.value)}
                  size="xs"
                  mb={4}
                />
              )}
              <RowsList ctx={ctx} parentSegments={[]} />
            </div>
          )}

          <DocumentChangeStrip entries={changeEntries} />
          {conflict?.kind === 'changed' && (
            <DocumentConflictPanel
              rows={conflictRows}
              choices={choices}
              onChoose={(path, choice) => setChoices((m) => new Map(m).set(path, choice))}
              onChooseAll={(choice) =>
                setChoices(new Map(conflictRows.filter((r) => r.changedBy === 'both').map((r) => [r.path, choice])))
              }
            />
          )}
          {conflict?.kind === 'deleted' && <DeletedDocumentPanel busy={busy} onInsert={() => void insertAsNew()} onCopy={copyMine} />}
          {err && (
            <div role="alert" style={{ fontSize: themeVars.fsSm, padding: '6px 8px', borderRadius: themeVars.rs, background: themeVars.redSoft, color: themeVars.redText }}>
              {err}
            </div>
          )}
        </div>
        <Group justify="flex-end" gap={themeVars.gapSm} pt={8} style={{ flex: 'none', borderTop: `1px solid ${themeVars.border}` }}>
          <Button size="compact-sm" variant="default" onClick={() => void requestClose()}>
            {conflict?.kind === 'deleted' ? 'Close' : 'Cancel'}
          </Button>
          <SubmitButton
            size="compact-sm"
            submitting={busy}
            disabled={saveBlocked}
            aria-keyshortcuts={isMacRenderer() ? 'Meta+Enter' : 'Control+Enter'}
            // A key cap, not part of the name: the button stays `Save` (W18 §13.6).
            rightSection={
              <Kbd size="xs" aria-hidden="true">
                {formatShortcut('⌘↵', isMacRenderer())}
              </Kbd>
            }
            onClick={() => void handleSave()}
          >
            {submitLabel}
          </SubmitButton>
        </Group>
      </div>
    </Modal>
  );
}
