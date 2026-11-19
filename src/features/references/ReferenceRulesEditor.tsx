import React from 'react';
import { themeVars } from '../../theme/themeVars';
import { I } from '../../icons';
import { ActionIcon, Autocomplete, Button, Modal, Tooltip } from '@mantine/core';
import { api, getErrorMessage, isIpcError } from '../../api/atelier';
import { confirmDestructive } from '../../utils/confirm';
import { useDialogFocusReturn } from '../../hooks/useDialogFocusReturn';
import { SubmitButton } from '../../components/SubmitButton';
import { FieldAutocompleteInput } from '../fieldSuggestions/FieldAutocompleteInput';
import type { SuggestionContext } from '../fieldSuggestions/types';
import { useNamespaceSuggestions } from './useNamespaceSuggestions';
import { notifyReferenceRulesChanged } from './useReferenceRules';
import { useConnectionFamily } from '../connections/useConnectionFamily';
import { ORIGIN_BADGE } from './originBadge';
import type {
  EffectiveReferenceRule,
  ReferenceAutodetectCandidate,
  ReferenceRuleCreateInput,
  ReferenceRuleUpdateInput,
} from '@shared/types';

interface ReferenceRulesEditorProps {
  connectionId: string;
  dbName: string;
  collection: string;
  /** Optional sample docs (e.g., lastRun) handed to the auto-detector. */
  sampleDocs?: unknown[];
  onClose: () => void;
  /** Called after any mutation so the parent can refresh its own cache. */
  onChanged?: () => void;
}

type FormState = {
  id?: string;
  sourceField: string;
  targetDb: string;
  targetCollection: string;
  targetField: string;
  projectionText: string;
  displayTemplate: string;
  enabled: boolean;
  /** How the rule being edited reached this Connection; absent on a new rule. */
  origin?: EffectiveReferenceRule['origin'];
};

/** Who a save applies to, once the choice is made. */
type SaveScope = 'family' | 'connection';

function emptyForm(dbName: string): FormState {
  return {
    sourceField: '',
    targetDb: dbName,
    targetCollection: '',
    targetField: '_id',
    projectionText: '',
    displayTemplate: '',
    enabled: true,
  };
}

function ruleToForm(r: EffectiveReferenceRule): FormState {
  return {
    origin: r.origin,
    id: r.id,
    sourceField: r.sourceField,
    targetDb: r.targetDb,
    targetCollection: r.targetCollection,
    targetField: r.targetField,
    projectionText: r.projection.join(', '),
    displayTemplate: r.displayTemplate ?? '',
    enabled: r.enabled,
  };
}

/** Reads the rule form's comma-separated field list. */
function parseFieldList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function ReferenceRulesEditor({
  connectionId,
  dbName,
  collection,
  sampleDocs,
  onClose,
  onChanged,
}: ReferenceRulesEditorProps) {
  const T = themeVars;
  const [rules, setRules] = React.useState<EffectiveReferenceRule[]>([]);
  // The Family this Connection belongs to, if any: a new rule is shared with it by default.
  const family = useConnectionFamily(connectionId);
  // Editing a shared rule asks first: change it for the whole family, or override it here.
  const [choosingScope, setChoosingScope] = React.useState(false);
  // A duplicate rule for the same source field, named so the editor can point at it.
  const [conflict, setConflict] = React.useState<{ field: string; scope: SaveScope } | null>(null);
  const [resettingId, setResettingId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<FormState | null>(null);
  // X15 §2 — "dirty" is "differs from what the form opened with", never "was
  // touched". The rule form opens *pre-filled* on all three of its entry paths:
  // `emptyForm` already seeds `targetDb`, `targetField: '_id'` and
  // `enabled: true`, Edit copies a whole rule, and a detected candidate fills
  // four fields. So a literal `sourceField !== ''` style check would report
  // dirty the instant the form opens and prompt on every clean Cancel. Snapshot
  // at open instead — every open path goes through `openForm`.
  const [formInitial, setFormInitial] = React.useState<string | null>(null);
  const openForm = (f: FormState) => {
    setForm(f);
    setFormInitial(JSON.stringify(f));
  };
  // The form's focused Create/Cancel button unmounts on close; hand focus back
  // to the control that opened it so keyboard users keep their place in the dialog.
  const newRuleRef = React.useRef<HTMLButtonElement>(null);
  const closeForm = () => {
    setForm(null);
    setChoosingScope(false);
    setConflict(null);
    setFormInitial(null);
    newRuleRef.current?.focus();
  };
  // Compared whole rather than field by field, so the guard covers every buffer
  // the dialog owns — including the `enabled` checkbox, which defaults to
  // `true` and would make a bare-truthy `form.enabled ||` term read dirty on a
  // clean open and clean once the user unticks it (exactly backwards).
  // `JSON.stringify` is sound here because both sides descend from the same
  // object literal — `RuleForm`'s `onChange` spreads `{ ...form }` — so key
  // order is preserved.
  const isDirty = form !== null && JSON.stringify(form) !== formInitial;
  const [saving, setSaving] = React.useState(false);
  const [candidates, setCandidates] = React.useState<ReferenceAutodetectCandidate[] | null>(null);
  const [detecting, setDetecting] = React.useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  // Dismiss paths only. This dialog has no success close path — saving a
  // rule clears the form and keeps the editor open — so ✕ and Escape are all
  // there is to wrap.
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

  const loadRules = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // `effective` makes every row an `EffectiveReferenceRule`; the bridge types it as the base rule.
      const rows = (await api.refs.list({
        connectionId,
        dbName,
        collection,
        effective: true,
      })) as EffectiveReferenceRule[];
      setRules(rows);
    } catch (err) {
      setError(isIpcError(err) ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [connectionId, dbName, collection]);

  React.useEffect(() => {
    queueMicrotask(() => {
      void loadRules();
    });
  }, [loadRules]);

  const refresh = async () => {
    await loadRules();
    // Every host of this editor has readers of the same rules mounted elsewhere (the open tab's chips); a host's own `onChanged` is not what keeps them current.
    notifyReferenceRulesChanged();
    onChanged?.();
  };

  const handleSave = async (scope?: SaveScope) => {
    if (!form || saving) return;
    if (!form.sourceField || !form.targetCollection) {
      setError('Source field and target collection are required');
      return;
    }
    // A shared rule is edited for everyone or overridden here: ask which.
    if (form.id && form.origin === 'shared' && scope === undefined) {
      setChoosingScope(true);
      return;
    }
    setSaving(true);
    setError(null);
    setConflict(null);
    try {
      const projection = parseFieldList(form.projectionText);
      if (form.id) {
        const patch: ReferenceRuleUpdateInput = {
          targetDb: form.targetDb,
          targetCollection: form.targetCollection,
          targetField: form.targetField,
          projection,
          displayTemplate: form.displayTemplate,
          enabled: form.enabled,
        };
        if (form.origin === 'shared' && scope === 'connection') {
          await api.refs.override({ connectionId, sharedRuleId: form.id, patch });
        } else {
          await api.refs.update({ id: form.id, patch });
        }
      } else {
        // Shared by default on a Connection in a Family; "This connection only" keeps it here.
        const owner = family && scope !== 'connection' ? { familyId: family.id } : { connectionId };
        const input: ReferenceRuleCreateInput = {
          owner,
          sourceDb: dbName,
          sourceCollection: collection,
          sourceField: form.sourceField,
          targetDb: form.targetDb,
          targetCollection: form.targetCollection,
          targetField: form.targetField,
          projection,
          displayTemplate: form.displayTemplate || undefined,
          enabled: form.enabled,
        };
        await api.refs.create(input);
      }
      closeForm();
      await refresh();
    } catch (err) {
      if (!form.id && isIpcError(err) && err.code === 'CONFLICT') {
        setConflict({ field: form.sourceField, scope: family && scope !== 'connection' ? 'family' : 'connection' });
      } else {
        setError(isIpcError(err) ? err.message : getErrorMessage(err, 'Failed to save'));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async (id: string) => {
    if (resettingId) return;
    setResettingId(id);
    try {
      await api.refs.resetToShared({ id });
      await refresh();
    } catch (err) {
      setError(isIpcError(err) ? err.message : getErrorMessage(err, 'Failed to reset'));
    } finally {
      setResettingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (deletingId) return;
    setDeletingId(id);
    try {
      await api.refs.delete({ id });
      setConfirmDeleteId(null);
      await refresh();
    } catch (err) {
      setError(isIpcError(err) ? err.message : getErrorMessage(err, 'Failed to delete'));
    } finally {
      setDeletingId(null);
    }
  };

  const handleDetect = async () => {
    if (detecting) return;
    setDetecting(true);
    setError(null);
    try {
      const rows = await api.refs.autodetect({
        connectionId,
        dbName,
        collection,
        sampleDocs,
      });
      setCandidates(rows);
    } catch (err) {
      setError(isIpcError(err) ? err.message : getErrorMessage(err, 'Failed to detect'));
    } finally {
      setDetecting(false);
    }
  };

  // Applying a candidate *opens* the form pre-filled, so it snapshots like any
  // other open path: choosing a candidate and closing straight away is clean.
  const applyCandidate = (c: ReferenceAutodetectCandidate) => {
    openForm({
      sourceField: c.sourceField,
      targetDb: c.targetDb,
      targetCollection: c.targetCollection,
      targetField: c.targetField,
      projectionText: '',
      displayTemplate: '',
      enabled: true,
    });
  };

  return (
    // X15 T8 — `closeOnClickOutside={false}` is load-bearing. Mantine defaults
    // it to `true`, which would reproduce the hand-rolled backdrop's
    // `onClick={onClose}` this migration removed: one stray click discarding a
    // half-filled rule. The backdrop is now inert — it neither closes nor
    // prompts. Escape still closes, but through `requestClose`, so it prompts
    // when there is something to lose.
    //
    // `title` is the bare string rather than a node carrying the
    // `db.collection` subtitle: Mantine wires `aria-labelledby` to the title
    // element, so folding the subtitle in there would make the accessible name
    // "Reference rules shop.orders". The subtitle moved into the body instead.
    <Modal
      opened
      onClose={() => void requestClose()}
      title="Reference rules"
      size={620}
      centered
      closeOnClickOutside={false}
    >
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
        <div style={{ fontSize: T.fsXs, color: T.textMuted, marginBottom: 10 }}>
          {dbName}.{collection}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {error && (
            <div
              role="alert"
              style={{
                color: T.warn,
                fontSize: T.fsSm,
                padding: '8px 10px',
                border: `1px solid ${T.warn}`,
                borderRadius: T.rs,
                marginBottom: 12,
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: T.gapSm, marginBottom: 12 }}>
            <Button
              ref={newRuleRef}
              data-autofocus
              size="compact-xs"
              variant="filled"
              leftSection={I.plus}
              onClick={() => openForm(emptyForm(dbName))}
            >
              New rule
            </Button>
            <SubmitButton size="compact-xs" variant="subtle" onClick={handleDetect} submitting={detecting}>
              {detecting ? 'Detecting…' : 'Detect from sample'}
            </SubmitButton>
          </div>

          {candidates && candidates.length > 0 && (
            <div
              style={{
                marginBottom: 12,
                padding: '10px 12px',
                border: `1px solid ${T.border}`,
                borderRadius: T.rs,
                background: T.surfaceRaised,
              }}
            >
              <div
                style={{
                  fontSize: T.fsXs,
                  color: T.textMuted,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  marginBottom: 8,
                }}
              >
                Detected candidates
              </div>
              {candidates.map((c) => (
                <div
                  key={c.sourceField}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: T.gapSm,
                    padding: '4px 0',
                    fontSize: T.fsSm,
                  }}
                >
                  <span style={{ fontFamily: 'monospace', color: T.text }}>
                    {c.sourceField}
                  </span>
                  <span style={{ color: T.textGhost }}>→</span>
                  <span style={{ fontFamily: 'monospace', color: T.text }}>
                    {c.targetCollection}.{c.targetField}
                  </span>
                  <span style={{ flex: 1 }} />
                  {c.alreadyConfigured ? (
                    <span style={{ color: T.textMuted, fontSize: T.fsXs }}>
                      already configured
                    </span>
                  ) : (
                    <Button size="compact-xs" variant="subtle" onClick={() => applyCandidate(c)}>
                      Use
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          {candidates && candidates.length === 0 && (
            <div style={{ marginBottom: 12, color: T.textMuted, fontSize: T.fsSm }}>
              No *_id / *Id fields with matching collections found.
            </div>
          )}

          {loading ? (
            <div style={{ color: T.textMuted, fontSize: T.fsSm }}>Loading…</div>
          ) : rules.length === 0 ? (
            <div
              style={{
                color: T.textMuted,
                fontSize: T.fsSm,
                fontStyle: 'italic',
                padding: '12px 0',
              }}
            >
              No rules yet. Click "New rule" or "Detect from sample" to add one.
            </div>
          ) : (
            <div style={{ border: `1px solid ${T.border}`, borderRadius: T.rs }}>
              {rules.map((r) => (
                <div
                  key={r.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: T.gapSm,
                    padding: '8px 12px',
                    borderBottom: `1px solid ${T.border}`,
                    fontSize: T.fsSm,
                  }}
                >
                  <span style={{ fontFamily: 'monospace', color: T.text, minWidth: 120 }}>
                    {r.sourceField}
                  </span>
                  <span style={{ color: T.textGhost }}>→</span>
                  <span style={{ fontFamily: 'monospace', color: T.text, flex: 1 }}>
                    {r.targetCollection}.{r.targetField}
                  </span>
                  {!r.enabled && (
                    <span style={{ fontSize: T.fsXs, color: T.textGhost }}>disabled</span>
                  )}
                  <span
                    title={ORIGIN_BADGE[r.origin].hint}
                    style={{
                      fontSize: T.fsXs,
                      color: r.origin === 'local' ? T.textMuted : T.accent,
                      border: `1px solid ${T.border}`,
                      borderRadius: T.rs,
                      padding: '0 6px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {ORIGIN_BADGE[r.origin].label}
                  </span>
                  {confirmDeleteId === r.id ? (
                    <>
                      <span style={{ fontSize: T.fsXs, color: T.red }}>
                        {r.origin === 'shared' ? 'Delete for the whole family?' : 'Delete?'}
                      </span>
                      <SubmitButton
                        onClick={() => void handleDelete(r.id)}
                        aria-label="Confirm delete"
                        submitting={deletingId === r.id}
                        color="red"
                        size="compact-xs"
                      >
                        {deletingId === r.id ? 'Deleting…' : 'Delete'}
                      </SubmitButton>
                      <Button
                        onClick={() => setConfirmDeleteId(null)}
                        aria-label="Cancel delete"
                        disabled={deletingId === r.id}
                        variant="default"
                        size="compact-xs"
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <Tooltip label="Edit rule" withArrow openDelay={400}>
                        <ActionIcon
                          onClick={() => openForm(ruleToForm(r))}
                          aria-label="Edit rule"
                          variant="default"
                          c={T.textMuted}
                          size="sm"
                        >
                          {I.edit}
                        </ActionIcon>
                      </Tooltip>
                      {r.origin === 'override' ? (
                        // Deleting an Override and resetting it are the same act; only the second says so.
                        <SubmitButton
                          onClick={() => void handleReset(r.id)}
                          aria-label={`Reset ${r.sourceField} to shared`}
                          submitting={resettingId === r.id}
                          size="compact-xs"
                          variant="default"
                        >
                          Reset to shared
                        </SubmitButton>
                      ) : (
                        <Tooltip label="Delete rule" withArrow openDelay={400}>
                          <ActionIcon
                            onClick={() => setConfirmDeleteId(r.id)}
                            aria-label="Delete rule"
                            variant="default"
                            c={T.red}
                            size="sm"
                          >
                            {I.trash}
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {form && (
            <RuleForm
              form={form}
              onChange={setForm}
              onSave={(scope) => void handleSave(scope)}
              onCancel={closeForm}
              saving={saving}
              familyName={family?.name ?? null}
              choosingScope={choosingScope}
              onDismissChoice={() => setChoosingScope(false)}
              conflict={conflict}
              onShowExisting={(field) => {
                const existing = rules.find((r) => r.sourceField === field);
                if (existing) {
                  setConflict(null);
                  openForm(ruleToForm(existing));
                }
              }}
              hasExisting={(field) => rules.some((r) => r.sourceField === field)}
              connectionId={connectionId}
              sourceDb={dbName}
              sourceCollection={collection}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}

interface RuleFormProps {
  form: FormState;
  onChange: (f: FormState) => void;
  /** `scope` is set by the family buttons; a plain Save passes none. */
  onSave: (scope?: SaveScope) => void;
  onCancel: () => void;
  saving: boolean;
  /** The Family a new rule is shared with by default; `null` when there is none. */
  familyName: string | null;
  /** The edit prompt for a shared rule is open. */
  choosingScope: boolean;
  onDismissChoice: () => void;
  conflict: { field: string; scope: SaveScope } | null;
  onShowExisting: (field: string) => void;
  hasExisting: (field: string) => boolean;
  connectionId: string;
  sourceDb: string;
  sourceCollection: string;
}

function RuleForm({
  form,
  onChange,
  onSave,
  onCancel,
  saving,
  familyName,
  choosingScope,
  onDismissChoice,
  conflict,
  onShowExisting,
  hasExisting,
  connectionId,
  sourceDb,
  sourceCollection,
}: RuleFormProps) {
  const T = themeVars;
  const labelStyle: React.CSSProperties = {
    fontSize: T.fsXs,
    color: T.textMuted,
    display: 'flex',
    flexDirection: 'column',
    gap: T.gapXs,
  };
  const inputStyle: React.CSSProperties = {
    padding: '6px 10px',
    border: `1px solid ${T.border}`,
    borderRadius: T.rs,
    background: T.surfaceRaised,
    color: T.text,
    fontSize: T.fsSm,
    fontFamily: 'monospace',
  };
  // A span, not a <label>: Mantine also points the options list at a label, so a label would name two elements.
  const labelTextStyle: React.CSSProperties = { fontSize: T.fsXs, color: T.textMuted };
  const hintStyle: React.CSSProperties = { fontSize: T.fsXs, color: T.warn };
  const editing = !!form.id;
  const namespaces = useNamespaceSuggestions(connectionId, form.targetDb);

  // Source-collection context: drives autocomplete on the "Source field" input.
  const sourceCtx = React.useMemo<SuggestionContext>(
    () => ({ connectionId, dbName: sourceDb, collection: sourceCollection }),
    [connectionId, sourceDb, sourceCollection],
  );
  // Target-collection context: drives autocomplete on Target field, Projection,
  // and Display template. Only meaningful once the user has filled in both
  // target db + target collection.
  const targetCtx = React.useMemo<SuggestionContext | null>(
    () =>
      form.targetDb && form.targetCollection
        ? {
            connectionId,
            dbName: form.targetDb,
            collection: form.targetCollection,
          }
        : null,
    [connectionId, form.targetDb, form.targetCollection],
  );

  return (
    <div
      style={{
        marginTop: 14,
        padding: '14px 16px',
        background: T.surfaceRaised,
        border: `1px solid ${T.border}`,
        borderRadius: T.rs,
      }}
    >
      <div style={{ fontSize: T.fsSm, fontWeight: 600, color: T.text, marginBottom: 10 }}>
        {editing ? 'Edit rule' : 'New rule'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: themeVars.gapSm }}>
        <label style={labelStyle}>
          Source field
          <FieldAutocompleteInput
            value={form.sourceField}
            onChange={(v) => onChange({ ...form, sourceField: v })}
            context={sourceCtx}
            disabled={editing}
            placeholder="contact_id"
            ariaLabel="Source field"
            style={{ ...inputStyle, opacity: editing ? 0.6 : 1 }}
          />
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: T.gapXs }}>
          <span style={labelTextStyle}>Target database</span>
          <Autocomplete
            aria-label="Target database"
            value={form.targetDb}
            onChange={(v) => onChange({ ...form, targetDb: v })}
            data={namespaces.databases}
            limit={50}
            styles={{ input: inputStyle }}
          />
          {namespaces.databasesFailed && <span style={hintStyle}>Could not list databases; type a name.</span>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: T.gapXs }}>
          <span style={labelTextStyle}>Target collection</span>
          <Autocomplete
            aria-label="Target collection"
            value={form.targetCollection}
            onChange={(v) => onChange({ ...form, targetCollection: v })}
            data={namespaces.collections}
            limit={50}
            placeholder="contacts"
            styles={{ input: inputStyle }}
          />
          {namespaces.collectionsFailed && <span style={hintStyle}>Could not list collections; type a name.</span>}
        </div>
        <label style={labelStyle}>
          Target field
          <FieldAutocompleteInput
            value={form.targetField}
            onChange={(v) => onChange({ ...form, targetField: v })}
            context={targetCtx}
            placeholder="_id"
            ariaLabel="Target field"
            style={inputStyle}
          />
        </label>
      </div>
      <label style={{ ...labelStyle, marginTop: 10 }}>
        Projection (comma-separated, empty = full doc)
        <FieldAutocompleteInput
          value={form.projectionText}
          onChange={(v) => onChange({ ...form, projectionText: v })}
          context={targetCtx}
          mode="csv"
          placeholder="name, email, phone"
          ariaLabel="Projection fields"
          style={inputStyle}
        />
      </label>
      <label style={{ ...labelStyle, marginTop: 10 }}>
        Display template (e.g. {'{name} ({email})'})
        <FieldAutocompleteInput
          value={form.displayTemplate}
          onChange={(v) => onChange({ ...form, displayTemplate: v })}
          context={targetCtx}
          mode="brace"
          placeholder="{name}"
          ariaLabel="Display template"
          style={inputStyle}
        />
      </label>
      <label
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: themeVars.gapXs,
          marginTop: 12,
          fontSize: T.fsSm,
          color: T.textMuted,
        }}
      >
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => onChange({ ...form, enabled: e.target.checked })}
        />
        Enabled
      </label>
      {!editing && familyName && (
        <div style={{ fontSize: T.fsXs, color: T.textMuted, marginTop: 12 }}>
          Shared with every connection in the {familyName} family. &quot;This connection only&quot; keeps it here.
        </div>
      )}
      {conflict && (
        <div role="alert" style={{ fontSize: T.fsSm, color: T.warn, marginTop: 12 }}>
          {conflict.scope === 'family' ? 'This family' : 'This connection'} already has a rule for{' '}
          <code>{conflict.field}</code>.{' '}
          {hasExisting(conflict.field) && (
            <Button size="compact-xs" variant="subtle" onClick={() => onShowExisting(conflict.field)}>
              Show it
            </Button>
          )}
        </div>
      )}
      {choosingScope ? (
        <div
          role="group"
          aria-label="Apply this change to"
          style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: T.gapSm, marginTop: 14, flexWrap: 'wrap' }}
        >
          <span style={{ fontSize: T.fsXs, color: T.textMuted, flex: 1 }}>
            This rule is shared with the family.
          </span>
          <Button size="compact-xs" variant="subtle" onClick={onDismissChoice} disabled={saving}>
            Back
          </Button>
          <SubmitButton size="compact-xs" variant="default" onClick={() => onSave('connection')} submitting={saving}>
            Override on this connection
          </SubmitButton>
          <SubmitButton size="compact-xs" variant="filled" onClick={() => onSave('family')} submitting={saving}>
            Change for the whole family
          </SubmitButton>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: T.gapSm, marginTop: 14 }}>
          <Button size="compact-xs" variant="subtle" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          {!editing && familyName && (
            <SubmitButton size="compact-xs" variant="default" onClick={() => onSave('connection')} submitting={saving}>
              This connection only
            </SubmitButton>
          )}
          <SubmitButton size="compact-xs" variant="filled" onClick={() => onSave()} submitting={saving}>
            {saving ? 'Saving…' : editing ? 'Save' : 'Create'}
          </SubmitButton>
        </div>
      )}
    </div>
  );
}
