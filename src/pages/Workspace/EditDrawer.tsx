import React from 'react';
import { Drawer } from '@mantine/core';
import { themeVars } from '../../theme/themeVars';
import { confirmDestructive } from '../../utils/confirm';
import { useDialogFocusReturn } from '../../hooks/useDialogFocusReturn';
import { submittingProps } from '../../components/SubmitButton';
import { api } from '../../api/atelier';
import { ejsonParse, ejsonStringify, ejsonStringifyReadable, isValidEjson } from '../../utils/ejson';
import { isRecord } from '../../utils/displayValue';
import { useShellSyntaxField } from './useShellSyntaxField';
import { getErrorMessage } from '../../api/atelier';
import { buildIdFilter } from './views/docId';
import { checkFieldType, inferType, type TypeWarning } from './schemaSummary';
import { getStructureEntries } from '../../features/fieldSuggestions/sources/sampleSchemaSource';
import type { SchemaSampleEntry } from '@shared/types';

interface EditDrawerProps {
  connectionId: string;
  dbName: string;
  collection: string;
  doc: unknown;
  onClose: () => void;
  onSaved: () => void;
}

export function EditDrawer({
  connectionId,
  dbName,
  collection,
  doc,
  onClose,
  onSaved,
}: EditDrawerProps) {
  const T = themeVars;

  const originalId = isRecord(doc) ? doc._id : undefined;

  type Mode = 'replace' | 'update';
  const [mode, setMode] = React.useState<Mode>('replace');

  const [docJson, setDocJson] = React.useState(() => {
    try {
      // this buffer is read and edited by a person, so it drops the
      // sentinels that have a lossless plainer form. Safe to edit rather than
      // display-only: `ejsonStringifyReadable` unwraps nothing that would
      // re-parse to different BSON, so the save path below is unchanged.
      return ejsonStringifyReadable(doc, 2);
    } catch {
      return JSON.stringify(doc, null, 2);
    }
  });
  // Update-mode buffer starts empty — never pre-filled with the current
  // document. Pre-filling it would let a user "$set" the whole document,
  // recreating the exact last-write-wins clobber problem this mode exists
  // to avoid.
  const [patchJson, setPatchJson] = React.useState('{}');
  const [err, setErr] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  // X15 §2 — the dirty guard. Seeded from the *first render's* `docJson`, which
  // is the state initializer's own result, so the two can't drift and
  // `ejsonStringifyReadable` runs once rather than every render.
  const initialDocJson = React.useRef(docJson);

  // The shared hook replaced T1's local mount/unmount effect. Both
  // dismiss paths below go through `close`, including the one behind the
  // discard prompt — that prompt is a separate portal, and the hook's "still
  // ours" check is by dialog role precisely so the handoff still restores.
  const close = useDialogFocusReturn(onClose);

  const requestClose = async () => {
    // Spans BOTH buffers, not the visible one. `switchMode` preserves each when
    // toggling, so an active-buffer check loses a typed $set patch the moment
    // the user flips back to Replace before closing. Dirty is "differs from
    // initial", never "was touched" — the drawer opens pre-filled.
    const isDirty = docJson !== initialDocJson.current || patchJson !== '{}';
    if (!isDirty) return close();
    const discard = await confirmDestructive({
      title: 'Discard changes?',
      body: 'This closes the editor and loses what you typed.',
      confirmLabel: 'Discard',
    });
    if (discard) close();
  };

  const buffer = mode === 'replace' ? docJson : patchJson;
  const setBuffer = mode === 'replace' ? setDocJson : setPatchJson;

  // Shell Syntax reaches the write surfaces. ADR 0004 held them strict
  // because a misread value here corrupts a document rather than returning
  // wrong rows, and the transform is unchanged by that argument: it splices
  // source spans and never evaluates, so there is no reading for it to get
  // wrong that it would not get wrong in the Filter Bar.
  //
  // What the asymmetry does buy is the ADR's other rule — *a destructive
  // operation always shows the Canonical EJSON it will actually run*. Blur
  // rewrites the buffer in place, so by the time Save is pressed the text on
  // screen is the text that gets written. Clicking Save blurs the textarea
  // first, so that holds for the mouse path as well as the tab path.
  const shell = useShellSyntaxField({ value: buffer, commit: setBuffer });
  const canonical = shell.outcome.kind === 'repaired' ? shell.outcome.text : buffer;
  const isValid = isValidEjson(canonical);
  // `liveRefusal`, not `refusal`: this drawer's notice tracks the buffer as it
  // is typed, the same asymmetry that has its Save gate read a live `outcome`.
  const refusal = shell.liveRefusal;

  // W17 — the field-type warning. Read-only: nothing below feeds the save
  // path, and nothing here can disable Save.
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

  const structureEntriesByPath = React.useMemo(
    () => new Map(structureEntries.map((e) => [e.path, e])),
    [structureEntries],
  );

  const typeWarnings = React.useMemo<TypeWarning[]>(() => {
    if (mode !== 'update' || !isValid || structureEntriesByPath.size === 0) return [];
    let parsed: unknown;
    try {
      // JSON.parse, NOT ejsonParse. ejsonParse revives sentinels into bson
      // class instances, and `inferType` recognises a type by its sentinel
      // *shape* — a revived ObjectId has no `$oid` key and reads as a plain
      // object, which would warn on a correct {"$oid": "…"} edit. The sample
      // side of the comparison is sentinel-shaped too (MetaService encodes
      // with relaxed: false), so both sides see the same form.
      parsed = JSON.parse(canonical);
    } catch {
      return [];
    }
    if (!isRecord(parsed)) return [];
    const out: TypeWarning[] = [];
    for (const [field, value] of Object.entries(parsed)) {
      // Nested and dotted paths are out of scope this version. Keying the
      // second test on inferType keeps sentinel wrappers in scope — they are
      // scalar BSON values, not sub-documents.
      if (field.includes('.')) continue;
      const actualType = inferType(value);
      if (actualType === 'object') continue;
      const warning = checkFieldType(structureEntriesByPath, field, actualType);
      if (warning) out.push(warning);
    }
    return out;
  }, [mode, isValid, canonical, structureEntriesByPath]);

  /**
   * Repairs the buffer and hands back the text to act on *now*.
   *
   * The state patch is async, so a save in the same tick cannot re-read state
   * — the same reason `repairOnCommit` returns its text on the read surfaces.
   */
  const commitRepair = (): string => shell.commitNow().text;

  const switchMode = (next: Mode) => {
    setMode(next);
    setErr(null);
  };

  const handleSave = async () => {
    if (saving) return;
    // Repair in front of the shape rules, never inside them — the same
    // ordering X14 uses on the read surfaces. `submitted` is what the rest of
    // this function reads, because `setBuffer` has not rendered yet.
    const submitted = commitRepair();
    if (!isValidEjson(submitted)) {
      setErr('Invalid EJSON');
      return;
    }

    setSaving(true);
    setErr(null);

    try {
      // Defensive guard: without an original _id the filter below would
      // otherwise collapse to `{}`, and replaceOne({}, doc) / updateOne({},
      // update) would touch an ARBITRARY document. The shipping find path
      // always projects _id so this is currently unreachable, but a future
      // editable-aggregation surface must not be able to trip it.
      // `buildIdFilter` is the single source of truth shared with inline
      // cell edits (T2.6, docId.ts) so the two write surfaces can't drift.
      const filterJson = buildIdFilter(doc);
      if (filterJson === null) {
        setErr('Cannot edit a document without an _id');
        setSaving(false);
        return;
      }

      if (mode === 'replace') {
        // Re-inject _id if user removed it. The buffer already passed
        // isValidEjson; round-trip via EJSON so BSON-typed _ids (ObjectId,
        // Decimal128, UUID Binary, …) survive.
        let parsed: unknown;
        try {
          parsed = ejsonParse<unknown>(submitted);
        } catch {
          setErr('Invalid EJSON');
          setSaving(false);
          return;
        }
        // EJSON is valid but the top level may be a scalar / array / null
        // (e.g. user typed `42` or `null`). Mongo docs must be objects, so
        // reject early — `_id in parsed` would otherwise TypeError.
        if (!isRecord(parsed)) {
          setErr('Document must be a JSON object');
          setSaving(false);
          return;
        }
        if (!('_id' in parsed)) parsed._id = originalId;

        // Canonicalize unconditionally, not only on the _id-reinjection
        // branch. The buffer was made a *readable* rendering — an unedited
        // save of a date submits `{"$date":"<ISO>"}` and an int32 submits a
        // bare number, both of which are Relaxed EJSON. They revive to the
        // identical BSON (that is the whole guarantee of
        // `ejsonStringifyReadable`), so nothing was ever written wrong. But
        // the wire format is Canonical EJSON, and the helper's own contract
        // says no buffer it renders crosses the boundary. Re-stringifying
        // from `parsed` is what makes that true, and it deletes a branch
        // rather than adding one.
        const submittedJson = ejsonStringify(parsed);

        await api.doc.replace({
          connectionId,
          dbName,
          collection,
          filterJson,
          docJson: submittedJson,
        });
      } else {
        let parsed: unknown;
        try {
          parsed = ejsonParse<unknown>(submitted);
        } catch {
          setErr('Invalid EJSON');
          setSaving(false);
          return;
        }
        if (!isRecord(parsed)) {
          setErr('Update must be a JSON object');
          setSaving(false);
          return;
        }
        if ('_id' in parsed) {
          setErr('_id cannot be modified');
          setSaving(false);
          return;
        }
        if (Object.keys(parsed).length === 0) {
          setErr('Add at least one field to update');
          setSaving(false);
          return;
        }

        const updateJson = ejsonStringify({ $set: parsed });
        await api.doc.updateOne({
          connectionId,
          dbName,
          collection,
          filterJson,
          updateJson,
        });
      }

      onSaved();
      onClose();
    } catch (e) {
      setErr(getErrorMessage(e, 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    // X15 T1 — `closeOnClickOutside={false}` is load-bearing, not cosmetic.
    // Mantine defaults it to `true`, which reproduces exactly the hand-rolled
    // backdrop's `onClick={onClose}` this migration removed: one stray click
    // discarding a fully-typed replacement document. Escape still closes, but
    // through `requestClose`, so it prompts when there is something to lose.
    <Drawer
      opened
      onClose={() => void requestClose()}
      position="right"
      size={400}
      title="Edit document"
      padding="md"
      closeOnClickOutside={false}
      // Mantine's body is a plain padded block, so the `flex: 1` on the
      // textarea below has no flex context to resolve against and the editor
      // stops at its intrinsic height, leaving the lower third of the drawer
      // empty. Making `content` a column and letting `body` take the remaining
      // track restores it.
      //
      // `minHeight: 0` on the body is the load-bearing half: a flex item's
      // default `min-height: auto` refuses to shrink below its content, so
      // without it a long document pushes the body past the drawer instead of
      // scrolling inside it. Deliberately not `calc(100% - 60px)` — the header
      // is `min-height`, not a fixed height, so any constant here is wrong the
      // moment the title wraps.
      styles={{
        content: { display: 'flex', flexDirection: 'column' },
        body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
      }}
    >
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={() => switchMode('replace')}
            aria-pressed={mode === 'replace'}
            style={{
              flex: 1,
              padding: '6px 10px',
              fontSize: 12,
              fontWeight: 600,
              border: `1px solid ${mode === 'replace' ? T.accent : T.border}`,
              borderRadius: T.rs,
              background: mode === 'replace' ? T.accent : 'none',
              color: mode === 'replace' ? T.accentText : T.textMuted,
              cursor: 'pointer',
            }}
          >
            Replace document
          </button>
          <button
            type="button"
            onClick={() => switchMode('update')}
            aria-pressed={mode === 'update'}
            style={{
              flex: 1,
              padding: '6px 10px',
              fontSize: 12,
              fontWeight: 600,
              border: `1px solid ${mode === 'update' ? T.accent : T.border}`,
              borderRadius: T.rs,
              background: mode === 'update' ? T.accent : 'none',
              color: mode === 'update' ? T.accentText : T.textMuted,
              cursor: 'pointer',
            }}
          >
            Update fields ($set)
          </button>
        </div>

        <textarea
          value={buffer}
          onChange={(e) => {
            setBuffer(e.target.value);
            setErr(null);
          }}
          onBlur={() => commitRepair()}
          aria-invalid={!isValid}
          aria-describedby={refusal ? 'edit-drawer-syntax-error' : undefined}
          spellCheck={false}
          // No `rows` — the height comes from `flex: 1` against the body's flex
          // context. A `rows` floor here would re-introduce the bug it
          // was added to hide: it sets an intrinsic height the flex item will
          // not shrink below, so a short window scrolls the whole drawer.
          style={{
            flex: 1,
            fontFamily: 'monospace',
            fontSize: 12,
            padding: '8px 10px',
            border: `1px solid ${!isValid ? T.warn : T.border}`,
            borderRadius: T.rs,
            background: T.surfaceRaised,
            color: T.text,
            resize: 'none',
            outline: 'none',
            lineHeight: 1.5,
          }}
        />

        {typeWarnings.map((w) => (
          <div
            key={w.field}
            data-testid="edit-drawer-type-warning"
            style={{ fontSize: 11, color: T.textMuted, padding: '0 2px', lineHeight: 1.4 }}
          >
            {`Field "${w.field}" is usually ${w.expectedType} (${w.percent}% of sampled documents). This value is ${w.actualType}.`}
          </div>
        ))}

        {refusal && (
          <div
            id="edit-drawer-syntax-error"
            role="alert"
            style={{ fontSize: 11, color: T.warn, padding: '0 2px', lineHeight: 1.4 }}
          >
            {refusal}
          </div>
        )}

        {err && (
          <div
            role="alert"
            style={{
              fontSize: 12,
              color: T.warn,
              padding: '4px 8px',
              background: '#ffebee',
              borderRadius: T.rs,
            }}
          >
            {err}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={() => void requestClose()}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              border: `1px solid ${T.border}`,
              borderRadius: T.rs,
              background: 'none',
              color: T.textMuted,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={!isValid} // #91 — real disabled excludes `saving`, see SubmitButton.tsx
            {...submittingProps(saving)}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 600,
              border: `1px solid ${isValid && !saving ? T.accent : T.border}`,
              borderRadius: T.rs,
              background: isValid && !saving ? T.accent : T.surfaceRaised,
              color: isValid && !saving ? T.accentText : T.textGhost,
              cursor: isValid && !saving ? 'pointer' : 'not-allowed',
            }}
          >
            {saving ? 'Saving…' : mode === 'replace' ? 'Save' : 'Apply update'}
          </button>
        </div>
      </div>
    </Drawer>
  );
}
