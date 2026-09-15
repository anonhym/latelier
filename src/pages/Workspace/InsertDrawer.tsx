import React from 'react';
import { Alert, Button, Drawer, Group, Stack, Textarea } from '@mantine/core';
import { api, getErrorMessage } from '../../api/atelier';
import { confirmDestructive } from '../../utils/confirm';
import { useDialogFocusReturn } from '../../hooks/useDialogFocusReturn';
import { ejsonParse, ejsonStringify, isValidEjson } from '../../utils/ejson';
import { classifyInsertPayload } from '../../utils/insertPayload';
import { useShellSyntaxField } from './useShellSyntaxField';

interface InsertDrawerProps {
  collection: string;
  connectionId: string;
  dbName: string;
  onClose: () => void;
  onInserted: () => void;
  /**
   * T2.7 — called instead of `onInserted`/`onClose` when an ordered
   * `insertMany` fails partway through the batch (a duplicate-key error on
   * doc N of an array leaves docs 0..N-1 persisted). Refresh the grid so the
   * partially-inserted rows are visible, but keep the drawer open so the
   * user's unresolved text isn't discarded.
   */
  onPartialInsert?: () => void;
  /**
   * Pre-fill the textarea (T2.6, "Duplicate document") with the source
   * document's EJSON minus `_id` (see `docId.ts`'s `stripIdForDuplicate`),
   * so the user can tweak before inserting a fresh copy. Defaults to the
   * empty-document `'{}'` when omitted.
   */
  initialDocJson?: string;
}

export function InsertDrawer({
  collection,
  connectionId,
  dbName,
  onClose,
  onInserted,
  onPartialInsert,
  initialDocJson,
}: InsertDrawerProps) {
  const [docJson, setDocJson] = React.useState(initialDocJson ?? '{}');
  const [err, setErr] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  // Dismiss paths only — a successful insert keeps `onClose` raw.
  const close = useDialogFocusReturn(onClose);

  // X15 §2 — the dirty guard. Seeded from the *first render's* `docJson`, which
  // is the state initializer's own result, so the two can't drift. Dirty is
  // "differs from initial", never "was touched": "Duplicate document" opens
  // this drawer pre-filled (`initialDocJson`), and a touched-heuristic would
  // prompt on every close of a duplicate the user decided against.
  const initialValue = React.useRef(docJson);

  const requestClose = async () => {
    if (docJson === initialValue.current) return close();
    const discard = await confirmDestructive({
      title: 'Discard changes?',
      body: 'This closes the editor and loses what you typed.',
      confirmLabel: 'Discard',
    });
    if (discard) close();
  };

  // see the note in `EditDrawer.tsx`. The transform runs in front of
  // `isValidEjson` and `classifyInsertPayload`, never inside them, so the
  // array-vs-document rules below are unchanged and still read Canonical
  // EJSON.
  const shell = useShellSyntaxField({ value: docJson, commit: setDocJson });
  const canonical = shell.outcome.kind === 'repaired' ? shell.outcome.text : docJson;
  // `liveRefusal`, not `refusal` — same reasoning as `EditDrawer.tsx`.
  const refusal = shell.liveRefusal;

  const isValid = isValidEjson(canonical);
  const payload = isValid ? classifyInsertPayload(ejsonParse(canonical)) : null;

  /** Repairs the buffer and hands back the text to insert *now*. */
  const commitRepair = (): string => shell.commitNow().text;

  const arrayErrorMessage =
    payload?.kind === 'array-empty'
      ? 'Array must contain at least one document'
      : payload?.kind === 'array-invalid-items'
        ? 'Every array item must be a document'
        : null;

  const canInsert = isValid && payload !== null && payload.kind !== 'array-empty' && payload.kind !== 'array-invalid-items';

  const insertLabel =
    payload?.kind === 'array'
      ? saving
        ? `Inserting ${payload.count} documents…`
        : `Insert ${payload.count} documents`
      : saving
        ? 'Inserting…'
        : 'Insert';

  const handleInsert = async () => {
    // `submitted`, not `docJson`: `setDocJson` has not rendered yet.
    const submitted = commitRepair();
    if (!canInsert || payload === null) {
      setErr('Invalid EJSON');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      // Same rule as `EditDrawer`'s replace path: the wire format is
      // Canonical EJSON, and `submitted` may not be. "Duplicate document"
      // seeds this drawer from `stripIdForDuplicate`, which renders the
      // readable form — insert it unedited and Relaxed spellings
      // reach the boundary. `submitted` already parsed once for `payload`,
      // so this round trip cannot fail on text that got this far.
      const canonicalJson = ejsonStringify(ejsonParse(submitted));
      if (payload.kind === 'array') {
        await api.doc.insertMany({ connectionId, dbName, collection, docsJson: canonicalJson });
      } else {
        await api.doc.insert({ connectionId, dbName, collection, docJson: canonicalJson });
      }
      onInserted();
      onClose();
    } catch (e) {
      const code = (e as { code?: string }).code;
      const details = (e as { details?: unknown }).details;
      const msg = getErrorMessage(e, 'Insert failed');
      const base = code === 'CONFLICT' ? `Conflict: ${msg}` : msg;
      const insertedCount =
        payload.kind === 'array' && details !== null && typeof details === 'object'
          ? (details as { insertedCount?: unknown }).insertedCount
          : undefined;

      if (payload.kind === 'array' && typeof insertedCount === 'number' && insertedCount > 0) {
        setErr(`${base} (${insertedCount} of ${payload.count} documents inserted before the error)`);
        onPartialInsert?.();
      } else {
        setErr(base);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    // X15 §2 — `closeOnClickOutside={false}` is load-bearing, not cosmetic.
    // Mantine defaults it to `true`, so until now one stray backdrop click
    // discarded a fully-typed document. The backdrop is now *inert*: it does
    // not close and it does not prompt, because there is no dismissal left to
    // intercept. Escape still closes, but through `requestClose`, so it prompts
    // when there is something to lose.
    <Drawer
      opened
      onClose={() => void requestClose()}
      position="right"
      size={400}
      title="Insert document"
      padding="md"
      closeOnClickOutside={false}
    >
      <Stack gap="sm" style={{ height: '100%' }}>
        <Textarea
          value={docJson}
          onChange={(e) => {
            setDocJson(e.currentTarget.value);
            setErr(null);
          }}
          onBlur={() => commitRepair()}
          spellCheck={false}
          autosize={false}
          minRows={12}
          styles={{
            input: {
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: 12,
              lineHeight: 1.5,
              resize: 'vertical',
            },
          }}
          // The transform's reason beats "Invalid EJSON" for the same reason
          // it did on the read surfaces (X14 §5): it names the token.
          error={!isValid ? (refusal ?? 'Invalid EJSON') : (arrayErrorMessage ?? undefined)}
        />

        {err && (
          <Alert color="red" variant="light" role="alert">
            {err}
          </Alert>
        )}

        <Group justify="flex-end" gap="xs">
          <Button variant="subtle" size="compact-xs" onClick={() => void requestClose()}>
            Cancel
          </Button>
          <Button
            variant="filled"
            size="compact-xs"
            onClick={() => void handleInsert()}
            disabled={!canInsert || saving}
          >
            {insertLabel}
          </Button>
        </Group>
      </Stack>
    </Drawer>
  );
}
