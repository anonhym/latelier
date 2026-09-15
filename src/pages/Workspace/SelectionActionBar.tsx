import React from 'react';
import { ActionIcon, Button, Group } from '@mantine/core';
import { themeVars } from '../../theme/themeVars';
import { copyToClipboard } from '../../utils/clipboard';
import { I } from '../../icons';
import { useCollectionWorkspace } from './context';
import { EMPTY_DOCUMENTS, useResultSelection } from './resultSelection';
import {
  buildDeleteSelectedFilterJson,
  selectedDocs,
  serializeSelectedForClipboard,
} from './selection';

interface SelectionActionBarProps {
  /** Fires with the selected documents (ascending index order) when the
   *  user confirms intent to delete. The caller derives the `{_id:{$in:
   *  [...]}}` filter and drives the shared DeleteConfirm count+token flow —
   *  this component only decides *whether* Delete is actionable. */
  onDeleteSelected: (docs: unknown[]) => void;
}

/**
 * Contextual bulk-action strip (T0.4 — quick win for a previously
 * dead-ended selection). Renders only when at least one row is selected in
 * the active result view and the workspace isn't read-only. `ResultViewer`
 * composes this as the `SelectionBar` slot; `ScriptTab`'s read-only
 * snapshot composition never renders it at all (AC7), and `meta.isReadOnly`
 * is checked here too so a future composition mistake can't surface
 * destructive actions there.
 */
export function SelectionActionBar({ onDeleteSelected }: SelectionActionBarProps) {
  const T = themeVars;
  const { state, meta } = useCollectionWorkspace();
  const documents = state.lastRun?.documents ?? EMPTY_DOCUMENTS;
  const selection = useResultSelection(documents);
  const [copied, setCopied] = React.useState(false);

  if (meta.isReadOnly || selection.indices.size === 0) return null;

  const docs = selectedDocs(documents, selection.indices);
  // Null when none of the selected docs carry an `_id` (e.g. an `{_id: 0}`
  // projection) — Delete MUST stay disabled in that case rather than ever
  // falling back to an unfiltered delete-everything call.
  const deleteFilterJson = buildDeleteSelectedFilterJson(docs);

  const handleCopy = () => {
    const text = serializeSelectedForClipboard(docs);
    // The button's own "Copied" label is the success feedback, so it waits
    // for the write to resolve. A failure toasts and leaves the label
    // alone.
    void copyToClipboard(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };

  const handleDelete = () => {
    if (!deleteFilterJson) return;
    onDeleteSelected(docs);
  };

  return (
    <Group
      gap={10}
      wrap="nowrap"
      style={{
        padding: '4px 14px',
        borderBottom: `1px solid ${T.border}`,
        background: T.accentSoft,
        flexShrink: 0,
        fontSize: 11,
      }}
    >
      <span data-testid="selection-bar-count" style={{ color: T.text, fontWeight: 600 }}>
        {selection.indices.size} selected
      </span>
      <span style={{ flex: 1 }} />
      <Button
        data-testid="selection-bar-copy"
        size="compact-xs"
        variant="subtle"
        leftSection={copied ? I.check : I.copy}
        onClick={handleCopy}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
      <Button
        data-testid="selection-bar-delete"
        size="compact-xs"
        variant="subtle"
        color="red"
        leftSection={I.trash}
        onClick={handleDelete}
        disabled={!deleteFilterJson}
        title={deleteFilterJson ? undefined : 'Selected documents have no _id to delete by'}
      >
        Delete
      </Button>
      <ActionIcon
        data-testid="selection-bar-clear"
        variant="subtle"
        color="gray"
        size="sm"
        aria-label="Clear selection"
        onClick={() => selection.clear()}
      >
        {I.close}
      </ActionIcon>
    </Group>
  );
}
