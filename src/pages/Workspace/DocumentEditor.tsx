import React from 'react';
import { Button, Group, Modal, NativeSelect, Switch, Text, Textarea, TextInput } from '@mantine/core';
import { themeVars } from '../../theme/themeVars';
import { confirmDestructive } from '../../utils/confirm';
import { useDialogFocusReturn } from '../../hooks/useDialogFocusReturn';
import { SubmitButton } from '../../components/SubmitButton';
import { api, getErrorMessage } from '../../api/atelier';
import { ejsonParse, ejsonStringify, isPlainDocument } from '../../utils/ejson';
import { checkFieldType, inferType, type TypeWarning } from './schemaSummary';
import { getStructureEntries } from '../../features/fieldSuggestions/sources/sampleSchemaSource';
import { FieldAutocompleteInput } from '../../features/fieldSuggestions/FieldAutocompleteInput';
import type { SuggestionContext } from '../../features/fieldSuggestions/types';
import {
  applyDiff,
  buildUpdateRequest,
  deleteAtSegments,
  diff,
  getAtSegments,
  isEdited,
  isEmptyDiff,
  isUnsafeFieldName,
  setAtSegments,
  type DocDiff,
} from './documentDiff';
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
import type { SchemaSampleEntry } from '@shared/types';

type Doc = Record<string, unknown>;

interface DocumentEditorProps {
  connectionId: string;
  dbName: string;
  collection: string;
  /** A result row: canonical EJSON sentinels, as `find` hands them over. */
  doc: unknown;
  onClose: () => void;
  /** `auditId` is the Reversible entry id of the update, for undo. */
  onSaved: (auditId?: string) => void;
}

const SIZE_PREF_KEY = 'ui.workspace.documentEditorSize';
const DEFAULT_WIDTH = 720;

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

/** One field row's identity, and the map key `texts`/`collapsed` are keyed by. */
const keyOf = (segments: readonly string[]): string => JSON.stringify(segments);

function decodeKey(key: string): string[] | null {
  try {
    const segments = JSON.parse(key) as unknown;
    return Array.isArray(segments) && segments.every((s) => typeof s === 'string') ? (segments as string[]) : null;
  } catch {
    return null;
  }
}

function isUnderSegments(key: string, prefix: readonly string[]): boolean {
  const segments = decodeKey(key);
  if (!segments || segments.length < prefix.length) return false;
  return prefix.every((p, i) => segments[i] === p);
}

/** Drops any entry addressing `segments` or anything nested under it. */
function purgeUnder(m: ReadonlyMap<string, string>, segments: readonly string[]): Map<string, string> {
  const next = new Map(m);
  for (const key of next.keys()) if (isUnderSegments(key, segments)) next.delete(key);
  return next;
}

/**
 * The dotted path to check with `isEdited` (and the W17 warning) for a row at
 * `segments`. A field name with a `.` or a leading `$` can't be its own
 * update path — `diff` (§5a) falls back to resending the nearest ancestor
 * whose own path is safe, so that's what has to be checked here too. A
 * top-level unsafe name has no such ancestor; the row is locked read-only in
 * that case (see `locked` below), so its address is never actually used to
 * decide anything save-relevant.
 */
function editAddress(segments: readonly string[]): string {
  const cut = segments.findIndex((s) => isUnsafeFieldName(s));
  const safe = cut === -1 ? segments : segments.slice(0, cut);
  return (safe.length > 0 ? safe : segments).join('.');
}

interface RowCtx {
  connectionId: string;
  dbName: string;
  collection: string;
  draft: Doc;
  changes: DocDiff;
  texts: ReadonlyMap<string, string>;
  collapsed: ReadonlySet<string>;
  entriesByPath: Map<string, SchemaSampleEntry>;
  patchDraft: (updater: (d: Doc) => Doc) => void;
  patchTexts: (updater: (m: ReadonlyMap<string, string>) => ReadonlyMap<string, string>) => void;
  toggleCollapsed: (key: string) => void;
  setErr: (e: string | null) => void;
}

function warningFor(entriesByPath: Map<string, SchemaSampleEntry>, field: string, value: unknown): TypeWarning | null {
  if (entriesByPath.size === 0 || field.includes('.')) return null;
  // `inferType` reads sentinel shapes, the vocabulary the sample was
  // recorded in, so the revived value goes back to one first.
  const actual = inferType(JSON.parse(ejsonStringify(value)) as unknown);
  return actual === 'object' ? null : checkFieldType(entriesByPath, field, actual);
}

function FieldRow({ ctx, segments, depth }: { ctx: RowCtx; segments: string[]; depth: number }) {
  const T = themeVars;
  const found = getAtSegments(ctx.draft, segments);
  if (!found) return null; // removed by a sibling edit in the same render pass
  const value = found.value;
  const kind = kindOf(value);
  const name = segments[segments.length - 1]!;
  const isRoot = segments.length === 1;
  const locked = isRoot && (name === '_id' || isUnsafeFieldName(name));
  const dotted = segments.join('.');
  const key = keyOf(segments);
  const edited = isEdited(ctx.changes, editAddress(segments));
  const warning = isRoot ? warningFor(ctx.entriesByPath, name, value) : null;

  const hasTypeSelector = !locked && kind !== 'other';
  const hasValueControl = hasTypeSelector && kind !== 'null' && kind !== 'object';
  const removable = !locked;
  const isCollapsed = ctx.collapsed.has(key);

  const text = ctx.texts.get(key) ?? (kind === 'array' ? textOf(kind, value) : hasValueControl ? textOf(kind, value) : '');
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

  const onRemove = () => {
    ctx.patchDraft((d) => deleteAtSegments(d, segments));
    ctx.patchTexts((m) => purgeUnder(m, segments));
    ctx.setErr(null);
  };

  return (
    <div
      role="listitem"
      data-field={dotted}
      data-edited={edited || undefined}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '4px 6px',
        marginLeft: depth * 16,
        borderLeft: `2px solid ${edited ? T.accent : 'transparent'}`,
      }}
    >
      <div style={{ width: 180, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, paddingTop: 4 }}>
        {kind === 'object' && (
          <button
            type="button"
            aria-expanded={!isCollapsed}
            aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${dotted}`}
            onClick={() => ctx.toggleCollapsed(key)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 11, lineHeight: 1 }}
          >
            {isCollapsed ? '▸' : '▾'}
          </button>
        )}
        <Text size="sm" ff="monospace" style={{ overflowWrap: 'anywhere' }}>
          {name}
          {edited && (
            <Text span size="xs" c={T.accent} ml={6}>
              edited
            </Text>
          )}
        </Text>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {!hasValueControl ? (
          kind === 'object' ? null : (
            <Text size="sm" ff="monospace" c="dimmed" style={{ overflowWrap: 'anywhere', paddingTop: 4 }}>
              {kind === 'null' ? 'null' : textOf(kind, value)}
            </Text>
          )
        ) : kind === 'boolean' ? (
          <Switch
            aria-label={dotted}
            checked={value === true}
            onChange={(e) => {
              const { checked } = e.currentTarget;
              ctx.setErr(null);
              ctx.patchDraft((d) => setAtSegments(d, segments, checked));
            }}
            mt={6}
          />
        ) : kind === 'string' || kind === 'array' ? (
          <Textarea
            aria-label={dotted}
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
        {warning && (
          <Text size="xs" c="dimmed" mt={2} data-testid="document-editor-type-warning">
            {`Field "${warning.field}" is usually ${warning.expectedType} (${warning.percent}% of sampled documents). This value is ${warning.actualType}.`}
          </Text>
        )}
      </div>
      <div style={{ width: 110, flexShrink: 0, paddingTop: 2 }}>
        {hasTypeSelector ? (
          <NativeSelect
            aria-label={`${dotted} type`}
            value={kind === 'number' ? 'double' : kind}
            data={SELECTABLE_KINDS.map((k) => ({ value: k, label: TYPE_LABEL[k] }))}
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
            onClick={onRemove}
            px={4}
          >
            &times;
          </Button>
        )}
      </div>
      {kind === 'object' && !isCollapsed && (
        <div style={{ width: '100%' }}>
          <RowsList ctx={ctx} parentSegments={segments} depth={depth + 1} />
        </div>
      )}
    </div>
  );
}

function AddFieldRow({
  ctx,
  parentSegments,
  existing,
  depth,
}: {
  ctx: RowCtx;
  parentSegments: readonly string[];
  existing: readonly string[];
  depth: number;
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
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', marginLeft: (depth + 1) * 16 }}
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
          style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, padding: '4px 6px' }}
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

function RowsList({ ctx, parentSegments, depth }: { ctx: RowCtx; parentSegments: readonly string[]; depth: number }) {
  const found = parentSegments.length === 0 ? { value: ctx.draft as unknown } : getAtSegments(ctx.draft, parentSegments);
  const obj = found && isPlainDocument(found.value) ? (found.value as Doc) : {};
  const keys = Object.keys(obj);
  return (
    <div
      role="list"
      aria-label={parentSegments.length === 0 ? 'Fields' : `Fields of ${parentSegments.join('.')}`}
      style={{ minHeight: 0 }}
    >
      {keys.map((k) => (
        <FieldRow key={k} ctx={ctx} segments={[...parentSegments, k]} depth={depth} />
      ))}
      <AddFieldRow ctx={ctx} parentSegments={parentSegments} existing={keys} depth={depth} />
    </div>
  );
}

export function DocumentEditor({ connectionId, dbName, collection, doc, onClose, onSaved }: DocumentEditorProps) {
  const [original, setOriginal] = React.useState<Doc>(() => revive(doc));
  const [draft, setDraft] = React.useState<Doc>(() => revive(doc));
  // Text as typed, only for rows the user has touched, keyed by
  // `keyOf(segments)`. A value that doesn't parse stays here, and out of the
  // draft, until it does.
  const [texts, setTexts] = React.useState<ReadonlyMap<string, string>>(() => new Map());
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() => new Set());
  const [err, setErr] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState<'changed' | 'deleted' | null>(null);
  const [busy, setBusy] = React.useState(false);

  // One diff drives the edited markers, the dirty guard and the save, so the
  // three cannot disagree.
  const changes = React.useMemo(() => diff(original, draft), [original, draft]);
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
  const isDirty = !isEmptyDiff(changes) || rowErrors.size > 0;

  const close = useDialogFocusReturn(onClose);

  const requestClose = async () => {
    if (!isDirty) return close();
    const discard = await confirmDestructive({
      title: 'Discard changes?',
      body: 'This closes the editor and loses what you typed.',
      confirmLabel: 'Discard',
    });
    if (discard) close();
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

  const send = async (guarded: boolean) => {
    // Same guard as the Save button's `disabled`: ⌘↵ calls send() directly,
    // bypassing the button, so a deleted document must be checked here too.
    if (busy || rowErrors.size > 0 || conflict === 'deleted') return;
    let request;
    try {
      request = buildUpdateRequest(original, draft);
    } catch (e) {
      setErr(getErrorMessage(e, 'Cannot save this document'));
      return;
    }
    if (request === null) {
      close();
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await api.doc.updateOne({
        connectionId,
        dbName,
        collection,
        filterJson: guarded ? request.filterJson : request.idFilterJson,
        updateJson: request.updateJson,
      });
      // Unguarded, the filter is `_id` alone: nothing matching means the
      // document is gone, not that someone changed it.
      if (res.matchedCount === 0) setConflict(guarded ? 'changed' : 'deleted');
      else {
        onSaved(res.auditId);
        // Through the focus-returning wrapper, so a save hands focus back
        // to whatever opened the editor, like Cancel does.
        close();
      }
    } catch (e) {
      setErr(getErrorMessage(e, 'Save failed'));
    } finally {
      setBusy(false);
    }
  };

  const reload = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api.query.findOne({
        connectionId,
        dbName,
        collection,
        filter: ejsonStringify({ _id: original._id }),
      });
      if (res.document === null) {
        setConflict('deleted');
        return;
      }
      const fresh = revive(res.document);
      // The user's edits win over the server's on a path both changed; that
      // path stays in the diff, so the next Save guards it again.
      setOriginal(fresh);
      setDraft(applyDiff(fresh, changes));
      setTexts((m) => {
        const next = new Map<string, string>();
        for (const [key, text] of m) {
          const segments = decodeKey(key);
          if (segments && isEdited(changes, editAddress(segments))) next.set(key, text);
        }
        return next;
      });
      setConflict(null);
    } catch (e) {
      setErr(getErrorMessage(e, 'Reload failed'));
    } finally {
      setBusy(false);
    }
  };

  // ⌘↵ only: ⌘S is deliberately not a save key. PanelBody's own ⌘↵ (Run)
  // already skips events from inside a dialog.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
    e.preventDefault();
    void send(true);
  };

  const [size, setSize] = React.useState<EditorSize>({ width: DEFAULT_WIDTH });
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
        if (live && isEditorSize(v)) setSize(v);
      })
      // An unreadable pref leaves the default size, which is all it can mean.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  // The browser writes an inline width/height only when the user drags the
  // resize handle, so an inline size that differs from the rendered one is a
  // resize to remember — content growing inside an auto height is not.
  const observer = React.useRef<ResizeObserver | null>(null);
  const surfaceRef = React.useCallback((el: HTMLDivElement | null) => {
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
        void api.prefs.set(SIZE_PREF_KEY, { width, height }).catch(() => undefined);
      }, 300);
    });
    observer.current.observe(el);
  }, []);

  const ctx: RowCtx = {
    connectionId,
    dbName,
    collection,
    draft,
    changes,
    texts,
    collapsed,
    entriesByPath,
    patchDraft: (updater) => setDraft(updater),
    patchTexts: (updater) => setTexts(updater),
    toggleCollapsed: (key) =>
      setCollapsed((s) => {
        const next = new Set(s);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    setErr,
  };

  return (
    // `closeOnClickOutside={false}` is load-bearing: one stray click on the
    // backdrop must not reach the close path and discard a typed draft.
    // Escape still closes, through `requestClose` and its prompt.
    <Modal
      opened
      onClose={() => void requestClose()}
      title="Edit document"
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
      <div
        ref={surfaceRef}
        data-testid="document-editor-surface"
        onKeyDown={handleKeyDown}
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
          gap: 8,
        }}
      >
        <Text size="xs" c="dimmed" ff="monospace">{`${dbName}.${collection}`}</Text>

        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <RowsList ctx={ctx} parentSegments={[]} depth={0} />
        </div>

        {conflict === 'changed' && (
          <div role="alert" style={{ fontSize: 12, padding: '6px 8px', borderRadius: themeVars.rs, background: themeVars.warnSoft, color: themeVars.warnText }}>
            This document changed since you opened it. Reload puts your edits on top of the current version;
            Overwrite saves them over it.
            <Group gap={6} mt={6}>
              <Button size="compact-xs" variant="default" onClick={() => void reload()}>
                Reload
              </Button>
              <Button size="compact-xs" variant="default" color="red" onClick={() => void send(false)}>
                Overwrite
              </Button>
            </Group>
          </div>
        )}
        {conflict === 'deleted' && (
          <div role="alert" style={{ fontSize: 12, padding: '6px 8px', borderRadius: themeVars.rs, background: themeVars.redSoft, color: themeVars.redText }}>
            This document was deleted since you opened it. There is nothing left to save to.
          </div>
        )}
        {err && (
          <div role="alert" style={{ fontSize: 12, padding: '6px 8px', borderRadius: themeVars.rs, background: themeVars.redSoft, color: themeVars.redText }}>
            {err}
          </div>
        )}

        <Group justify="flex-end" gap={8}>
          <Button size="compact-sm" variant="default" onClick={() => void requestClose()}>
            Cancel
          </Button>
          <SubmitButton
            size="compact-sm"
            submitting={busy}
            disabled={rowErrors.size > 0 || conflict === 'deleted'}
            onClick={() => void send(true)}
          >
            {busy ? 'Saving…' : 'Save'}
          </SubmitButton>
        </Group>
      </div>
    </Modal>
  );
}
