import React from 'react';
import { useCollectionWorkspace } from './context';
import { useShellSyntaxField } from './useShellSyntaxField';
import { projectionPatch } from './projectionWriter';
import { formatProjection, isRawProjection, parseProjection, type ProjectionFailure } from './projection';
import type { CollectionTabState } from '@shared/types';

// Deliberately two messages, not one: a typo and an exclusion need different
// things from the user. `unmodelable` is only reached by text that is not an
// EJSON document — an exclusion or `$slice` that is one commits to
// `builder.projectionRaw` and runs verbatim (W15 §2.1). Text the Shell
// Syntax transform refused shows the transform's own reason instead (X14 §5).
const PROJECTION_ERRORS: Record<ProjectionFailure, string> = {
  malformed: "Can't parse this projection. Expected { field: 1 } or a comma-separated field list.",
  unmodelable:
    'Exclusions and $slice run as a raw projection, but only as an EJSON document — this text is not one.',
};

/**
 * The projection's draft lifecycle. Lives on the always-mounted control, not
 * in the dropdown: the dropdown unmounts on close, and a refused draft has to
 * survive a close and reopen (W14 §3) rather than vanish with it.
 *
 * `builder.projection` (the modelled inclusion list) and
 * `builder.projectionRaw` (W15 §9(b), sent verbatim) are mutually exclusive
 * by construction — whichever route commits clears the other.
 */
export function useProjectionDraft() {
  const { state, actions, meta } = useCollectionWorkspace();
  const display = state.builder.projectionRaw?.trim() || formatProjection(state.builder.projection);
  const [draft, setDraft] = React.useState<string | null>(null);
  // X14 §3 — the Shell Syntax transform runs first, and the two rules
  // below judge the repaired text: `{_id: 0}` repairs to `{"_id": 0}` and
  // takes the raw route. No `thenCheck`: `malformed` names its own fix even
  // when the transform also refuses the text, so it outranks the transform.
  const field = useShellSyntaxField({ value: draft ?? '' });
  // The text last *classified* — set only at commit, cleared on change. A
  // message derived from the live draft would re-announce a half-typed
  // `{name:` through the `role="alert"` on every keystroke.
  const [classified, setClassified] = React.useState<string | null>(null);
  const message = React.useMemo(() => {
    if (classified === null) return null;
    const result = parseProjection(classified);
    if (result.ok || (result.reason === 'unmodelable' && isRawProjection(classified))) return null;
    if (result.reason === 'unmodelable') return field.refusal ?? PROJECTION_ERRORS.unmodelable;
    return PROJECTION_ERRORS.malformed;
  }, [classified, field.refusal]);

  // The control is not keyed per tab, so tab A's refused draft would
  // otherwise sit over tab B's projection.
  const [draftTab, setDraftTab] = React.useState(meta.tabId);
  if (draftTab !== meta.tabId) {
    setDraftTab(meta.tabId);
    setDraft(null);
    setClassified(null);
    field.onChange('');
  }

  /** Settles the draft; returns the builder it committed, or null when refused. */
  const commit = (): CollectionTabState['builder'] | null => {
    const base = state.builder;
    if (draft === null) return base;
    const { text, outcome } = field.repairNow();
    if (outcome.kind === 'repaired') setDraft(text);
    const result = parseProjection(text);
    let next: CollectionTabState['builder'];
    if (result.ok) {
      next = { ...base, projection: result.fields, projectionRaw: undefined };
    } else if (result.reason === 'unmodelable' && isRawProjection(text)) {
      next = { ...base, projection: [], projectionRaw: text.trim() };
    } else {
      setClassified(text); // keep the draft — `message` now says why
      return null;
    }
    setClassified(null);
    setDraft(null);
    actions.patchWith((prev) => projectionPatch(prev, next));
    return next;
  };

  const onChange = (next: string) => {
    setDraft(next);
    // Stale complaint while the user is already fixing it.
    setClassified(null);
    field.onChange(next);
  };

  return { value: draft ?? display, message, commit, onChange };
}

export type ProjectionDraft = ReturnType<typeof useProjectionDraft>;
