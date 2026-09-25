import React from 'react';
import { Button, Group, Modal, Switch, Text, Textarea, TextInput } from '@mantine/core';
import { Decimal128, Double, Int32, Long, ObjectId } from 'bson';
import { themeVars } from '../../theme/themeVars';
import { confirmDestructive } from '../../utils/confirm';
import { useDialogFocusReturn } from '../../hooks/useDialogFocusReturn';
import { SubmitButton } from '../../components/SubmitButton';
import { api, getErrorMessage } from '../../api/atelier';
import { ejsonParse, ejsonStringify, ejsonStringifyReadable, isPlainDocument } from '../../utils/ejson';
import { checkFieldType, inferType, type TypeWarning } from './schemaSummary';
import { getStructureEntries } from '../../features/fieldSuggestions/sources/sampleSchemaSource';
import { applyDiff, buildUpdateRequest, diff, isEdited, isEmptyDiff, isUnsafeFieldName } from './documentDiff';
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

type Kind = 'string' | 'int32' | 'double' | 'long' | 'decimal' | 'number' | 'boolean' | 'date' | 'objectId' | 'null' | 'other';

function kindOf(v: unknown): Kind {
  if (v === null) return 'null';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'boolean') return 'boolean';
  // A bare JS number never comes off the wire (it is always a sentinel), but
  // a hand-built document can hold one; it saves as whatever bson infers.
  if (typeof v === 'number') return 'number';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? 'other' : 'date';
  if (v instanceof Int32) return 'int32';
  if (v instanceof Double) return 'double';
  if (v instanceof Long) return 'long';
  if (v instanceof Decimal128) return 'decimal';
  if (v instanceof ObjectId) return 'objectId';
  return 'other';
}

const TYPE_LABEL: Record<Exclude<Kind, 'other'>, string> = {
  string: 'String',
  int32: 'Int32',
  double: 'Double',
  long: 'Int64',
  decimal: 'Decimal128',
  number: 'Number',
  boolean: 'Boolean',
  date: 'Date',
  objectId: 'ObjectId',
  null: 'Null',
};

function typeLabel(kind: Kind, v: unknown): string {
  if (kind !== 'other') return TYPE_LABEL[kind];
  if (Array.isArray(v)) return 'Array';
  if (isPlainDocument(v)) return 'Object';
  const bsonType = (v as { _bsontype?: unknown } | null)?._bsontype;
  return typeof bsonType === 'string' ? bsonType : 'Value';
}

/** ISO-8601 in UTC, without the `.000` a whole second doesn't need. */
function isoOf(d: Date): string {
  return d.toISOString().replace('.000Z', 'Z');
}

function textOf(kind: Kind, v: unknown): string {
  switch (kind) {
    case 'date':
      return isoOf(v as Date);
    case 'int32':
    case 'double':
      return String((v as Int32 | Double).value);
    case 'long':
    case 'decimal':
    case 'objectId':
    case 'number':
      return String(v);
    case 'string':
      return v as string;
    default:
      return ejsonStringifyReadable(v);
  }
}

type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

const INTEGER = /^-?\d+$/;
// Zone required: without one, `Date.parse` reads the text as local time and
// the stored instant silently shifts by the machine's offset.
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const HEX_24 = /^[0-9a-fA-F]{24}$/;

/** Typed text back to a value of the row's own type — never another one. */
function parseAs(kind: Kind, text: string): Parsed {
  const t = text.trim();
  switch (kind) {
    case 'string':
      return { ok: true, value: text };
    case 'int32': {
      const n = Number(t);
      return INTEGER.test(t) && n >= -(2 ** 31) && n < 2 ** 31
        ? { ok: true, value: new Int32(n) }
        : { ok: false, error: 'Enter a whole number between -2147483648 and 2147483647' };
    }
    case 'long': {
      const ok = INTEGER.test(t) && BigInt(t) >= -(2n ** 63n) && BigInt(t) < 2n ** 63n;
      return ok ? { ok: true, value: Long.fromString(t) } : { ok: false, error: 'Enter a whole number that fits in 64 bits' };
    }
    case 'double':
    case 'number': {
      const n = Number(t);
      if (t === '' || Number.isNaN(n)) return { ok: false, error: 'Enter a number' };
      return { ok: true, value: kind === 'double' ? new Double(n) : n };
    }
    case 'decimal':
      try {
        return { ok: true, value: Decimal128.fromString(t) };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'Enter a decimal number' };
      }
    case 'date': {
      // The regex only checks shape; a text like `2026-13-01T00:00Z` passes
      // it but parses to NaN, which would otherwise write an Invalid Date
      // into the draft and strand the row as uneditable.
      const ms = ISO_UTC.test(t) ? Date.parse(t) : Number.NaN;
      return Number.isNaN(ms)
        ? { ok: false, error: 'Enter an ISO-8601 date with a zone, like 2026-09-24T20:31:00Z' }
        : { ok: true, value: new Date(ms) };
    }
    case 'objectId':
      return HEX_24.test(t) ? { ok: true, value: new ObjectId(t) } : { ok: false, error: 'Enter 24 hexadecimal characters' };
    default:
      return { ok: false, error: 'This type is not editable here' };
  }
}

function withField(doc: Doc, field: string, value: unknown): Doc {
  const next = Object.assign(Object.create(null) as Doc, doc);
  Object.defineProperty(next, field, { value, enumerable: true, writable: true, configurable: true });
  return next;
}

export function DocumentEditor({ connectionId, dbName, collection, doc, onClose, onSaved }: DocumentEditorProps) {
  const T = themeVars;

  const [original, setOriginal] = React.useState<Doc>(() => revive(doc));
  const [draft, setDraft] = React.useState<Doc>(() => revive(doc));
  // Text as typed, only for rows the user has touched. A value that doesn't
  // parse stays here, and out of the draft, until it does.
  const [texts, setTexts] = React.useState<ReadonlyMap<string, string>>(() => new Map());
  const [err, setErr] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState<'changed' | 'deleted' | null>(null);
  const [busy, setBusy] = React.useState(false);

  // One diff drives the edited markers, the dirty guard and the save, so the
  // three cannot disagree.
  const changes = React.useMemo(() => diff(original, draft), [original, draft]);
  const rowErrors = React.useMemo(() => {
    const out = new Map<string, string>();
    for (const [field, text] of texts) {
      const parsed = parseAs(kindOf(draft[field]), text);
      if (!parsed.ok) out.set(field, parsed.error);
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
  const warningFor = (field: string, value: unknown): TypeWarning | null => {
    if (entriesByPath.size === 0 || field.includes('.')) return null;
    // `inferType` reads sentinel shapes, the vocabulary the sample was
    // recorded in, so the revived value goes back to one first.
    const actual = inferType(JSON.parse(ejsonStringify(value)) as unknown);
    return actual === 'object' ? null : checkFieldType(entriesByPath, field, actual);
  };

  const editText = (field: string, text: string) => {
    setTexts((m) => new Map(m).set(field, text));
    setErr(null);
    const parsed = parseAs(kindOf(draft[field]), text);
    if (parsed.ok) setDraft((d) => withField(d, field, parsed.value));
  };

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
      setTexts((m) => new Map([...m].filter(([field]) => isEdited(changes, field))));
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

  const fields = Object.keys(draft);

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

        <div role="list" aria-label="Fields" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {fields.map((field) => {
            const value = draft[field];
            // The draft's own type: a row edits in the type it holds, and only
            // a type selector could change that.
            const kind = kindOf(value);
            const editable = field !== '_id' && kind !== 'other' && kind !== 'null' && !isUnsafeFieldName(field);
            const edited = isEdited(changes, field);
            const rowError = rowErrors.get(field);
            const warning = warningFor(field, value);
            const text = texts.get(field) ?? textOf(kind, value);
            return (
              <div
                key={field}
                role="listitem"
                data-field={field}
                data-edited={edited || undefined}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(80px, 180px) 1fr 90px',
                  gap: 8,
                  alignItems: 'start',
                  padding: '4px 6px',
                  borderLeft: `2px solid ${edited ? T.accent : 'transparent'}`,
                }}
              >
                <Text size="sm" ff="monospace" style={{ overflowWrap: 'anywhere', paddingTop: 4 }}>
                  {field}
                  {edited && (
                    <Text span size="xs" c={T.accent} ml={6}>
                      edited
                    </Text>
                  )}
                </Text>
                <div>
                  {!editable ? (
                    <Text size="sm" ff="monospace" c="dimmed" style={{ overflowWrap: 'anywhere', paddingTop: 4 }}>
                      {kind === 'null' ? 'null' : textOf(kind, value)}
                    </Text>
                  ) : kind === 'boolean' ? (
                    <Switch
                      aria-label={field}
                      checked={value === true}
                      onChange={(e) => {
                        const { checked } = e.currentTarget;
                        setErr(null);
                        setDraft((d) => withField(d, field, checked));
                      }}
                      mt={6}
                    />
                  ) : kind === 'string' ? (
                    <Textarea
                      aria-label={field}
                      value={text}
                      onChange={(e) => editText(field, e.currentTarget.value)}
                      // Grows past one line natively (Chromium's `field-sizing`),
                      // without Mantine's JS autosize.
                      rows={1}
                      styles={{ input: { fieldSizing: 'content', maxHeight: 160 } }}
                      size="xs"
                      spellCheck={false}
                    />
                  ) : (
                    <TextInput
                      aria-label={field}
                      value={text}
                      onChange={(e) => editText(field, e.currentTarget.value)}
                      error={rowError}
                      inputMode={kind === 'date' || kind === 'objectId' ? undefined : 'decimal'}
                      size="xs"
                      ff="monospace"
                      spellCheck={false}
                      description={
                        kind === 'date' && value instanceof Date ? `Local: ${value.toLocaleString()}` : undefined
                      }
                      inputWrapperOrder={['label', 'input', 'description', 'error']}
                    />
                  )}
                  {warning && (
                    <Text size="xs" c="dimmed" mt={2} data-testid="document-editor-type-warning">
                      {`Field "${warning.field}" is usually ${warning.expectedType} (${warning.percent}% of sampled documents). This value is ${warning.actualType}.`}
                    </Text>
                  )}
                </div>
                <Text size="xs" c="dimmed" style={{ paddingTop: 6 }}>
                  {typeLabel(kind, value)}
                </Text>
              </div>
            );
          })}
        </div>

        {conflict === 'changed' && (
          <div role="alert" style={{ fontSize: 12, padding: '6px 8px', borderRadius: T.rs, background: T.warnSoft, color: T.warnText }}>
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
          <div role="alert" style={{ fontSize: 12, padding: '6px 8px', borderRadius: T.rs, background: T.redSoft, color: T.redText }}>
            This document was deleted since you opened it. There is nothing left to save to.
          </div>
        )}
        {err && (
          <div role="alert" style={{ fontSize: 12, padding: '6px 8px', borderRadius: T.rs, background: T.redSoft, color: T.redText }}>
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
