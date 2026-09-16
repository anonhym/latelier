import React, { memo } from 'react';
import { Badge, Button, Group, Menu, Tooltip, VisuallyHidden } from '@mantine/core';
import { themeVars } from '../../theme/themeVars';
import { I } from '../../icons';
import { isEjsonDocument } from '../../utils/ejson';
import { useShellSyntaxField } from './useShellSyntaxField';
import {
  compileFindOptions,
  filterProblem,
  findProblem,
  limitWarning,
  projectionProblem,
  sortProblem,
} from './builder';
import type { SuggestionContext } from '../../features/fieldSuggestions/types';
import { FieldAutocompleteInput } from '../../features/fieldSuggestions/FieldAutocompleteInput';
import { useTextareaAutocomplete } from '../../features/fieldSuggestions/useTextareaAutocomplete';
import { useCollectionWorkspace } from './context';
import { api } from '../../api/atelier';
import { ExplainDrawer } from './Aggregation/ExplainDrawer';
import { QueryExpandModal } from './QueryExpandModal';
import type { ExplainVerbosity } from '@shared/types';

interface QueryBarProps {
  suggestionContext: SuggestionContext | null;
}

import { formatProjection, isRawProjection, parseProjection } from './projection';
import type { ProjectionFailure } from './projection';

// Deliberately two messages, not one: a typo and an exclusion need different
// things from the user.
//
// W15 §2.1 — the `unmodelable` wording has now been through four states.
// It once named raw MQL, a surface that did not exist; an earlier revision
// cut the advice back to the bare limitation rather than prescribe a
// workaround it couldn't deliver. The current one delivers it: an exclusion
// or `$slice` written as an EJSON document commits to
// `builder.projectionRaw` and runs verbatim, so this message is only reached
// by text that isn't a document.
//
// X14 §5 — "quote the keys, e.g. { "_id": 0 }" named an edit that fixed
// nothing still able to reach here. Since T3 the transform repairs unquoted
// keys, so what lands in this branch is either text the transform *refused*
// (unbalanced braces, a regex literal, arithmetic) — which now shows the
// transform's own reason instead of this string, see `commitProjection` — or
// text that parses as JSON and still is not an EJSON document. This states
// that bar rather than prescribing an edit for a class that no longer exists.
const PROJECTION_ERRORS: Record<ProjectionFailure, string> = {
  malformed: "Can't parse this projection. Expected { field: 1 } or a comma-separated field list.",
  unmodelable:
    'Exclusions and $slice run as a raw projection, but only as an EJSON document — this text is not one.',
};

// W15 §4.4 — one copy, referenced by both the Tooltip (mouse, and now
// keyboard focus) and the visually-hidden element `skip` is described by. Two
// copies of a sentence like this drift the first time someone edits one.
const SKIP_EXPLANATION = 'Skip is driven by the page selector below the results';

/**
 * Inline `role="alert"` strip — the same treatment the filter tree gives an
 * unprintable row (`BuilderPane.tsx:446`). A full-width strip rather than a
 * cell sibling: every one of these messages is longer than the 1fr track.
 */
function Notice({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <div
      id={id}
      role="alert"
      style={{
        padding: '3px 12px 4px',
        fontSize: 10,
        lineHeight: 1.3,
        color: themeVars.warn,
        background: themeVars.surface,
        borderTop: `1px solid ${themeVars.border}`,
      }}
    >
      {children}
    </div>
  );
}

function QueryBarInner({
  suggestionContext,
}: QueryBarProps) {
  const T = themeVars;
  const { state, actions, meta } = useCollectionWorkspace();
  const isLoading = meta.isLoading;
  const onPatch = actions.patch;
  const onRun = actions.run;
  const onSave = actions.openSave;
  // the Recent list lives in the builder pane, which is unmounted
  // while collapsed. Switching its tab without making it visible is a click
  // that appears to do nothing.
  const onHistory = React.useCallback(() => {
    actions.expandBuilder?.();
    actions.patch({ activeBuilderTab: 'Recent' });
  }, [actions]);
  const queryRaw = state.queryRaw;

  // W13 — the sync pill / "Re-sync builder" / "Accept builder" machinery is
  // gone: the drawer is a view of `queryRaw`, not a competing compiled
  // filter to reconcile against, so the bar only needs to know whether the
  // current text is runnable.
  // A filter must be a *document*, not merely parseable EJSON — `[1,2]` and
  // `null` parse, and main refuses them. One rule with
  // `currentFilterJson` and `findProblem`.
  const isValid = React.useMemo(() => isEjsonDocument(queryRaw), [queryRaw]);

  // W15 §3.1 — sort used to reach `QueryService.find` unvalidated and
  // come back as a `VALIDATION` pill after a round trip, one row below a
  // filter gated client-side. `sortProblem` is shared with `useQueryRunner`'s
  // guard so the button and the runner can't drift onto two rules.
  const sortError = React.useMemo(() => sortProblem(state.builder.sort), [state.builder.sort]);
  const limitError = React.useMemo(
    () => limitWarning(state.builder.limit),
    [state.builder.limit],
  );
  // W15 §2.1 — the committed raw projection's own gate, shared with
  // `useQueryRunner`. Distinct from `projMessage`, which is about the
  // draft the user is still editing; this one is about state that would
  // otherwise run.
  const projRawError = React.useMemo(
    () => projectionProblem(state.builder),
    [state.builder],
  );

  const findOptions = React.useMemo(() => compileFindOptions(state.builder), [state.builder]);
  // W13 §7 — Run's enabled rule collapses to `isEjsonDocument(queryRaw)`. The
  // fail-open hazard can't recur through this button: `queryRaw` is the single
  // source of truth for the filter, and any op the old builder couldn't
  // compile (`$elemMatch`, `$text`, ...) is now a raw node the filter-tree
  // printer encodes losslessly — there's no more "compiles to a mangled
  // clause" state to guard against.
  // §3.1 folds the sort in: an unparseable sort is refused here rather than
  // by the main process. `limitError` deliberately does *not* gate — a
  // coerced limit still runs, it just has to say what it runs as (§4.1).
  //
  // The three-way conjunction collapses into `findProblem`, which is the
  // same three gates in the same order and so the same boolean — this swap is
  // deliberately an equivalent mutation, and no test can tell it from the
  // conjunction it replaced. It earns its place structurally, not
  // behaviourally: Copy code needs the *reason* rather than the verdict, and
  // a second place computing "is this query runnable" is exactly what §3.1
  // exists to prevent, so the button and the copy path read one function.
  // `sortError` / `projRawError` stay — they are the inline per-field
  // messages, which is a different question from whether Run is enabled.
  const canRun = !isLoading && findProblem(state) === null;
  // Explain calls `api.query.explain` directly — it does NOT go through
  // `useQueryRunner.run`, but W13 collapses its rule to the same one:
  // `queryRaw` is the only filter source now, so Explain needs nothing
  // stricter than Run.
  const canExplain = canRun;

  const [expandOpen, setExpandOpen] = React.useState(false);
  const [explainOpen, setExplainOpen] = React.useState(false);
  const [explainVerbosity, setExplainVerbosity] =
    React.useState<ExplainVerbosity>('queryPlanner');

  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const autocomplete = useTextareaAutocomplete({
    textareaRef,
    suggestionContext,
    stageOp: '$match',
    onReplace: (next) => onPatch({ queryRaw: next }),
  });

  // X14 §2 — Shell Syntax becomes Canonical EJSON on blur, in the box the
  // user typed it in. Not per keystroke: a per-keystroke rewrite fights the
  // user mid-word. The seam patches only for a real repair, so text that
  // already parses strictly is byte-identical afterwards — spacing and key
  // order untouched — and a failed transform leaves the text as typed with
  // the Run gate still closed.
  //
  // Safe to compose with the autocomplete's own blur: the suggestion popover
  // preventDefaults its `onMouseDown` (`SuggestionPopover.tsx:152`), so
  // picking a suggestion never blurs the textarea in the first place.
  //
  // X14 §5 — `thenCheck: filterProblem` is the document rule, applied after the
  // transform's own refusal and never collapsed into the same sentence — the
  // hook's own ordering rule. The message is held in state and set at the
  // conversion point, not derived per keystroke: `Notice` is a `role="alert"`,
  // and a derived one would announce a half-typed `{age:` on every character.
  const filterField = useShellSyntaxField({
    value: queryRaw,
    commit: (next) => onPatch({ queryRaw: next }),
    thenCheck: filterProblem,
  });

  const handleBlur = () => {
    autocomplete.onBlur();
    filterField.onBlur();
  };

  // X14 — Explain reads through the repair, like every other surface.
  //
  // These two live below `repairQueryRaw` rather than beside `canExplain`
  // because they call it, and `runQueryExplain`'s dependency array is
  // evaluated during render — naming it earlier is a temporal-dead-zone
  // throw, not a lint nit.
  //
  // **The repair cannot fire here today, and that is the point.** `canExplain`
  // is `canRun`, which refuses anything `isEjsonDocument` refuses, and the
  // transform returns `unchanged` for everything `JSON.parse` already accepts.
  // So the two sets do not overlap: by the time Explain is reachable, the text
  // is strict and the repair is a no-op. What this buys is that Explain no
  // longer *depends* on that being true — the aggregation side repairs on its
  // Run and Explain paths, and the one read surface that did not was
  // the odd one out waiting for the gate to change under it.
  const onExplain = (verbosity: ExplainVerbosity) => {
    const { text, outcome } = filterField.commitNow();
    if (outcome.kind === 'failed') return;
    if (findProblem({ ...state, queryRaw: text }) !== null || isLoading) return;
    setExplainVerbosity(verbosity);
    setExplainOpen(true);
  };

  const runQueryExplain = React.useCallback(
    (verbosity: ExplainVerbosity) => {
      // `filterField` closes over the current `queryRaw` rather than trusting
      // the gate to still hold — the rule (never widen a refused filter to
      // `{}`) applies even to a read-only path like Explain. The repair runs
      // in front of that check, never inside it, the same order every other
      // surface uses.
      const { text } = filterField.commitNow();
      if (!isEjsonDocument(text)) return Promise.reject(new Error('No runnable filter'));
      return api.query.explain({
        connectionId: meta.connectionId,
        dbName: meta.dbName,
        collection: meta.collection,
        filter: text,
        sort: findOptions.sort,
        projection: findOptions.projection,
        verbosity,
      });
    },
    [
      meta.connectionId,
      meta.dbName,
      meta.collection,
      findOptions.sort,
      findOptions.projection,
      filterField,
    ],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      // Repair before the gate, not after it. `canRun` reads the *current*
      // text, so without this ⌘↵ on `{age: {$gt: 60}}` would silently do
      // nothing on the very syntax X14 exists to accept — the textarea still
      // has focus, so no blur has repaired it yet. The patch lands async, so
      // the repaired text also rides along as a `run` override.
      const { text, outcome } = filterField.commitNow();
      if (outcome.kind === 'failed') return;
      if (findProblem({ ...state, queryRaw: text }) === null && !isLoading) {
        onRun({ queryRaw: text });
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onPatch({ queryRaw: e.target.value });
    // Stale complaint while the user is already fixing it; the next blur or
    // ⌘↵ re-asks. This is also X14 §5's "the message clears when the input
    // becomes runnable again".
    filterField.onChange(e.target.value);
    autocomplete.probe();
  };

  // Projection input uses a local draft so the user can type freely; we
  // only commit (and reformat) on blur. When the builder changes externally
  // (e.g. project chip toggle), `projDraft === null` lets the formatted
  // representation flow through.
  const projDisplay = React.useMemo(
    () => state.builder.projectionRaw?.trim() || formatProjection(state.builder.projection),
    [state.builder.projectionRaw, state.builder.projection],
  );
  const [projDraft, setProjDraft] = React.useState<string | null>(null);
  const projValue = projDraft ?? projDisplay;
  // W14 §3 — the old body ran `setProjDraft(null)` unconditionally, so
  // a refused parse threw the user's typing away and fell back to the last
  // committed value with no message. `parseProjection` returns the *reason*
  // precisely so the draft survives and the fix is nameable.
  //
  // W15 §2.1/§2.2 — three outcomes now, not two. A projection the
  // inclusion model can't express is no longer a dead end: if it parses as an
  // EJSON document it commits to `projectionRaw` and runs verbatim, which is
  // what finally makes `{"_id": 0}` reachable. The two fields are mutually
  // exclusive by construction — whichever route commits clears the other, so
  // the compiler never has to arbitrate between a stale pair.
  //
  // X14 §3 — the transform runs *first*, and the two rules above then
  // judge the repaired text. `{_id: 0}` was a dead end before this: the
  // inclusion model refuses it, and `isRawProjection` refused it too because
  // an unquoted key is not JSON. Repaired to `{"_id": 0}` it takes the raw
  // route and runs. `repairNow` writes the repair back into the draft (below,
  // by hand — it "commits nothing" itself), so a repair that then fails a
  // shape rule is still visible in the box.
  //
  // No `then` here, for the same reason as sort: `parseProjection`'s message
  // isn't a second rule applied *after* the transform's refusal, it can
  // *outrank* it. `{a: }` is `malformed` — a typo, not a raw-MQL problem — and
  // names its own fix even though the transform also refuses it; only the
  // *other* failing branch (`unmodelable`) prefers the transform's reason,
  // when there is one. That is the opposite priority from the filter's, so
  // it stays this field's own memo rather than the hook's ordering rule.
  const projField = useShellSyntaxField({ value: projDraft ?? '' });
  // The text last *classified* — set only at commit, cleared on change — not
  // `projDraft` itself. `projMessage` derived straight from the live draft
  // would reclassify on every keystroke and announce a half-typed `{name:`
  // through the `role="alert"` Notice; freezing the memo's input (rather
  // than holding the message as its own state) still keeps this a read of
  // the hook's `refusal`, not a second one of its own.
  const [projClassified, setProjClassified] = React.useState<string | null>(null);
  const projMessage = React.useMemo(() => {
    if (projClassified === null) return null;
    const result = parseProjection(projClassified);
    if (result.ok || (result.reason === 'unmodelable' && isRawProjection(projClassified))) return null;
    if (result.reason === 'unmodelable') return projField.refusal ?? PROJECTION_ERRORS.unmodelable;
    return PROJECTION_ERRORS.malformed;
  }, [projClassified, projField.refusal]);
  const commitProjection = () => {
    if (projDraft === null) return;
    const { text, outcome } = projField.repairNow();
    if (outcome.kind === 'repaired') setProjDraft(text);
    const result = parseProjection(text);
    if (result.ok) {
      onPatch({
        builder: { ...state.builder, projection: result.fields, projectionRaw: undefined },
      });
    } else if (result.reason === 'unmodelable' && isRawProjection(text)) {
      onPatch({
        builder: { ...state.builder, projection: [], projectionRaw: text.trim() },
      });
    } else {
      setProjClassified(text); // keep the draft — `projMessage` now says why
      return;
    }
    setProjClassified(null);
    setProjDraft(null);
  };

  // X14 §3 — the sort field's half, same glue and same conversion
  // point as the filter bar. The transform runs first and `sortProblem` then
  // judges the repaired text, which is the whole of the ordering rule:
  // `{name: 1}` becomes `{"name": 1}` and passes, while `[1, 2]` is already
  // valid JSON, so the transform returns `unchanged` and the shape refusal
  // still fires with its own message rather than the parse one.
  //
  // Blank needs no special case: the transform reports empty input as
  // `failed`, the hook then commits nothing, and `sortProblem`'s own blank
  // check ahead of it still reads "no sort".
  //
  // X14 §5 — no `then` here: the shape check (`sortError`, below) is a
  // separate memo and the two are OR'd in JSX rather than combined into one
  // hook-owned refusal — `sortProblem`'s "must be a document" and the
  // transform's own reason name different fixes.
  const sortField = useShellSyntaxField({
    value: state.builder.sort,
    commit: (next) => onPatch({ builder: { ...state.builder, sort: next } }),
  });
  const handleSortChange = (v: string) => {
    onPatch({ builder: { ...state.builder, sort: v } });
    sortField.onChange(v);
  };
  const handleSortBlur = () => {
    sortField.onBlur();
  };
  const handleLimitChange = (v: string) => {
    onPatch({ builder: { ...state.builder, limit: v } });
  };

  const skipValue = state.page * state.pageSize;
  const runError = state.lastRun?.error;

  // Advanced rows (projection/sort/skip/limit) are hidden by default and
  // expand from the QUERY row's chevron. The row opens automatically when the
  // builder already has any advanced value set, so users editing an existing
  // saved query don't get a "where did my sort go?" moment.
  // A count rather than a bare boolean — W14 §2 renders "n set" on the
  // collapsed trigger.
  const advancedCount =
    (state.builder.projection.length > 0 || state.builder.projectionRaw?.trim() ? 1 : 0) +
    (state.builder.sort.trim() !== '' ? 1 : 0) +
    (state.builder.limit.trim() !== '' ? 1 : 0);
  const hasAdvanced = advancedCount > 0;

  // W14 §1 — `useState(hasAdvanced)` alone froze the row at whatever
  // the first tab looked like: QueryBar has no `key` at its mount site and
  // never remounts. Resync during render (React's "adjust state when a prop
  // changes"), deliberately asymmetric:
  //   - tab switch (`tabId` changes)  → re-derive in both directions;
  //   - same tab, hasAdvanced false→true (a Saved/Recent load, a quick-sort
  //     from the table header) → open;
  //   - same tab, true→false → leave it alone.
  // The last rule is the point: a symmetric resync would yank the row shut
  // under a user who just deleted the last character of `sort`, and a bare
  // `useEffect(() => setAdvancedOpen(hasAdvanced))` would fight every toggle.
  // No `key` is used, so nothing here remounts QueryBar or drops `projDraft`.
  const [advancedOpen, setAdvancedOpen] = React.useState(hasAdvanced);
  const [advancedSync, setAdvancedSync] = React.useState({
    tabId: meta.tabId,
    hasAdvanced,
  });
  if (advancedSync.tabId !== meta.tabId) {
    setAdvancedSync({ tabId: meta.tabId, hasAdvanced });
    setAdvancedOpen(hasAdvanced);
    // `projDraft` is QueryBar-local and QueryBar never remounts, so a
    // retained bad draft would otherwise show tab A's unsaved text over tab
    // B's query. Only unparseable drafts can reach here (a valid one commits
    // on blur), so nothing savable is lost. Rides the tabId sentinel above
    // rather than adding a second copy of it.
    setProjDraft(null);
    setProjClassified(null);
    // X14 §5 — same reasoning for the other held messages: they are
    // QueryBar-local and QueryBar never remounts, so tab A's complaint would
    // otherwise sit under tab B's query. `onChange`'s argument is unused by
    // the hook — this leans on it purely for the clear.
    filterField.onChange('');
    sortField.onChange('');
    projField.onChange('');
  } else if (advancedSync.hasAdvanced !== hasAdvanced) {
    setAdvancedSync({ tabId: meta.tabId, hasAdvanced });
    if (hasAdvanced) setAdvancedOpen(true);
  }
  const toggleAdvanced = () => setAdvancedOpen((o) => !o);

  // Shared cell styles for the 4-column grid below the toolbar. The label
  // cells are a slightly raised background to read as "row headers" the way
  // the screenshot mockup does it.
  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '120px 1fr 64px 152px',
    borderTop: `1px solid ${T.border}`,
  };
  const labelCellStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    padding: '0 12px',
    background: T.surfaceRaised,
    borderRight: `1px solid ${T.border}`,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: T.textMuted,
  };
  const valueCellStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    padding: '0 10px',
    background: T.surface,
    borderRight: `1px solid ${T.border}`,
    minHeight: 30,
  };
  const valueCellLast: React.CSSProperties = {
    ...valueCellStyle,
    borderRight: 'none',
  };
  const cellInputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 11,
    padding: '4px 0',
    border: 'none',
    background: 'transparent',
    color: T.text,
    outline: 'none',
  };

  return (
    <div
      style={{
        borderBottom: `1px solid ${T.border}`,
        background: T.surface,
        flexShrink: 0,
      }}
    >
      {/* Top toolbar — Run (split) · Save · History. W15 §7.1 deletes
          "Set default": it wrote `query.default.<conn>.<db>.<coll>` and
          nothing anywhere read it back. Saved queries already own "reuse this
          query on this collection". */}
      <Group gap={8} wrap="nowrap" style={{ padding: '8px 12px' }}>
        <Button.Group>
          <Tooltip
            label={
              !isValid
                ? 'Invalid MQL'
                : sortError
                  ? 'Invalid sort'
                  : projRawError
                    ? 'Invalid projection'
                    : 'Run (Cmd+Enter)'
            }
            withArrow
          >
            <Button
              variant="filled"
              size="compact-xs"
              onClick={() => canRun && onRun()}
              disabled={!canRun}
              data-testid="query-run-btn"
              leftSection={I.play}
              styles={{ root: { fontWeight: 700 } }}
            >
              Run
            </Button>
          </Tooltip>
          <Menu position="bottom-end" shadow="md" width={190}>
            <Menu.Target>
              <Tooltip label="Run options" withArrow>
                <Button
                  variant="filled"
                  size="compact-xs"
                  disabled={!canRun}
                  aria-label="Run options"
                  data-testid="query-run-options-btn"
                  px={6}
                >
                  {I.chevD}
                </Button>
              </Tooltip>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={I.play} onClick={() => canRun && onRun()}>
                Run
              </Menu.Item>
              <Menu.Divider />
              <Menu.Label>Explain</Menu.Label>
              <Menu.Item
                leftSection={I.eye}
                disabled={!canExplain}
                onClick={() => onExplain('queryPlanner')}
              >
                queryPlanner
              </Menu.Item>
              <Menu.Item
                leftSection={I.eye}
                disabled={!canExplain}
                onClick={() => onExplain('executionStats')}
              >
                executionStats
              </Menu.Item>
              <Menu.Item
                leftSection={I.eye}
                disabled={!canExplain}
                onClick={() => onExplain('allPlansExecution')}
              >
                allPlansExecution
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Button.Group>

        <span
          aria-hidden="true"
          style={{
            width: 1,
            alignSelf: 'stretch',
            background: T.border,
            margin: '0 2px',
          }}
        />

        <Button variant="default" size="compact-xs" leftSection={I.save} onClick={onSave}>
          Save
        </Button>
        <Button variant="default" size="compact-xs" leftSection={I.clock} onClick={onHistory}>
          History
        </Button>
      </Group>

      {/* QUERY row — collapsible header + editable filter textarea. W13
          deletes the sync pill / "Re-sync builder" / "Accept builder" /
          "Builder disabled" column that used to sit to the right: the Filter
          drawer is a view of this same text now, not a competing compiled
          filter to reconcile against, so there's nothing left to show here. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '120px 1fr',
          borderTop: `1px solid ${T.border}`,
        }}
      >
        <Tooltip
          label={advancedOpen ? 'Hide advanced options' : 'Show advanced options'}
          withArrow
        >
          <div
            role="button"
            tabIndex={0}
            // W15 §5 — a styled `<div role="button">` inherits no
            // focus ring of its own, and `:focus-visible` can't be expressed
            // in the inline styles everything else here uses. The rule lives
            // in `src/index.css`; the e2e keyboard-focuses this element and
            // reads the computed outline back, which is what closes the item
            // W14 §2 left open ("verified, not assumed").
            className="focus-ring"
            onClick={toggleAdvanced}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleAdvanced();
              }
            }}
            aria-expanded={advancedOpen}
            aria-controls="query-bar-advanced"
            style={{
              ...labelCellStyle,
              cursor: 'pointer',
              // The 120px track fits chevron + QUERY with ~35px to spare;
              // trim the right padding only while the badge is showing, so
              // it never sits beside the expanded label cells below.
              paddingRight: !advancedOpen && hasAdvanced ? 6 : undefined,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: 'inline-flex',
                marginRight: 6,
                color: T.textGhost,
                transform: advancedOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                transition: 'transform 120ms ease',
              }}
            >
              {I.chevD}
            </span>
            <span style={{ color: T.accent }}>query</span>
            {/* W14 §2 — collapsed, the row gave no non-hover sign that
                projection / sort / limit were set. A count rather than the dot
                43ee030 shipped and 7a21468 reverted: it survives monochrome
                and states the fact. Decoration only — a Badge is a plain div,
                so it isn't focusable and its clicks bubble to the trigger. */}
            {!advancedOpen && hasAdvanced && (
              <Badge
                size="xs"
                variant="light"
                color={T.accent}
                style={{ marginLeft: 'auto', flexShrink: 0 }}
              >
                {advancedCount} set
              </Badge>
            )}
          </div>
        </Tooltip>
        <div style={{ ...valueCellStyle, padding: '0 4px' }}>
          <textarea
            ref={textareaRef}
            value={queryRaw}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onKeyUp={autocomplete.probe}
            onClick={autocomplete.probe}
            onFocus={autocomplete.probe}
            onBlur={handleBlur}
            spellCheck={false}
            data-testid="query-bar-input"
            // X14 §5 — the textarea had neither, so the one control that
            // most often refuses input was the only one whose complaint never
            // reached a screen reader. Same wiring as the projection and sort
            // inputs below (W15 §5).
            aria-invalid={filterField.refusal !== null}
            aria-describedby={filterField.refusal ? 'query-bar-filter-error' : undefined}
            placeholder="{}"
            style={{
              flex: 1,
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 12,
              padding: '6px 8px',
              border: 'none',
              borderBottom: `1px solid ${
                !isValid && queryRaw !== '{}' ? T.warn : 'transparent'
              }`,
              background: 'transparent',
              color: T.text,
              resize: 'vertical',
              minHeight: 28,
              maxHeight: 240,
              outline: 'none',
              lineHeight: 1.5,
            }}
            rows={1}
          />
          <Tooltip label="Expand" withArrow>
            <Button
              variant="subtle"
              size="compact-xs"
              px={4}
              onClick={() => setExpandOpen(true)}
              aria-label="Expand query filter"
              data-testid="query-bar-expand-btn"
              style={{ flexShrink: 0, alignSelf: 'flex-start', marginTop: 4 }}
            >
              {I.expand}
            </Button>
          </Tooltip>
          {autocomplete.popover}
        </div>
      </div>

      {filterField.refusal && <Notice id="query-bar-filter-error">{filterField.refusal}</Notice>}

      {advancedOpen && (
      <div id="query-bar-advanced">
      {/* PROJECTION + SORT row */}
      <div style={gridStyle}>
        {/* W15 §5 — these label cells were the only thing naming the
            inputs, and only visually. Giving them `id`s and pointing
            `aria-labelledby` at them names each input off the exact text on
            screen; an `aria-label` duplicate would be a second copy to keep
            in sync. */}
        <div id="query-bar-projection-label" style={labelCellStyle}>projection</div>
        <div style={valueCellStyle}>
          {/* W15 §2.3/§3.4 — projection and sort share one
              autocomplete-backed control, fed by the same sources the
              drawer's cond rows use. 'token' mode completes the field word
              around the caret, so a name can be picked from inside
              `{ … : 1 }` without the punctuation joining the search. */}
          <FieldAutocompleteInput
            value={projValue}
            onChange={(next) => {
              setProjDraft(next);
              // Stale complaint while the user is already fixing it.
              setProjClassified(null);
              projField.onChange(next);
            }}
            context={suggestionContext}
            mode="token"
            onBlur={commitProjection}
            onKeyDown={(e) => {
              // `defaultPrevented` means the popover just took this Enter to
              // accept a suggestion; committing on top of it would close the
              // input mid-completion.
              if (e.key === 'Enter' && !e.defaultPrevented) {
                e.preventDefault();
                commitProjection();
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            placeholder="{ field: 1 }"
            dataTestid="query-bar-projection"
            ariaLabelledBy="query-bar-projection-label"
            ariaInvalid={projMessage !== null || projRawError !== null}
            ariaDescribedBy={
              projMessage
                ? 'query-bar-projection-error'
                : projRawError
                  ? 'query-bar-projection-raw-error'
                  : undefined
            }
            style={{
              ...cellInputStyle,
              borderBottom: `1px solid ${projMessage || projRawError ? T.warn : 'transparent'}`,
            }}
          />
        </div>
        <div id="query-bar-sort-label" style={labelCellStyle}>sort</div>
        <div style={valueCellLast}>
          <FieldAutocompleteInput
            value={state.builder.sort}
            onChange={handleSortChange}
            context={suggestionContext}
            mode="token"
            onBlur={handleSortBlur}
            placeholder='{"_id":-1}'
            dataTestid="query-bar-sort"
            ariaLabelledBy="query-bar-sort-label"
            ariaInvalid={(sortField.refusal ?? sortError) !== null}
            ariaDescribedBy={(sortField.refusal ?? sortError) ? 'query-bar-sort-error' : undefined}
            style={{
              ...cellInputStyle,
              borderBottom: `1px solid ${sortError ? T.warn : 'transparent'}`,
            }}
          />
        </div>
      </div>

      {projMessage && <Notice id="query-bar-projection-error">{projMessage}</Notice>}
      {projRawError && <Notice id="query-bar-projection-raw-error">{projRawError}</Notice>}
      {(sortField.refusal ?? sortError) && (
        <Notice id="query-bar-sort-error">{sortField.refusal ?? sortError}</Notice>
      )}

      {/* SKIP + LIMIT row */}
      <div style={gridStyle}>
        <div id="query-bar-skip-label" style={labelCellStyle}>skip</div>
        <div style={valueCellStyle}>
          {/* W15 §4.4 — was a Tooltip on a non-focusable `<span>`, so
              the one sentence explaining why this cell ignores typing reached
              a hovering mouse and nobody else. Three changes, all needed:
              a read-only `<input>` (native, focusable, nameable — a `<span>`
              has no role that takes an accessible name), `events.focus` so
              the Tooltip fires for a keyboard user (Mantine's default is
              hover-only), and `aria-describedby` → a visually-hidden copy so
              a screen reader gets the reason without a Tooltip at all. */}
          <Tooltip
            label={SKIP_EXPLANATION}
            withArrow
            events={{ hover: true, focus: true, touch: false }}
          >
            <input
              type="text"
              readOnly
              value={skipValue}
              aria-labelledby="query-bar-skip-label"
              aria-describedby="query-bar-skip-help"
              data-testid="query-bar-skip"
              style={{
                ...cellInputStyle,
                color: T.textMuted,
                cursor: 'default',
              }}
            />
          </Tooltip>
          <VisuallyHidden id="query-bar-skip-help">{SKIP_EXPLANATION}</VisuallyHidden>
        </div>
        <div id="query-bar-limit-label" style={labelCellStyle}>limit</div>
        <div style={valueCellLast}>
          <input
            type="number"
            min={1}
            value={state.builder.limit}
            onChange={(e) => handleLimitChange(e.target.value)}
            placeholder="—"
            data-testid="query-bar-limit"
            aria-labelledby="query-bar-limit-label"
            aria-invalid={limitError !== null}
            aria-describedby={limitError ? 'query-bar-limit-error' : undefined}
            style={{
              ...cellInputStyle,
              borderBottom: `1px solid ${limitError ? T.warn : 'transparent'}`,
            }}
          />
        </div>
      </div>

      {limitError && <Notice id="query-bar-limit-error">{limitError}</Notice>}
      </div>
      )}

      {runError && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 12px 6px',
            fontSize: 11,
            color: T.textMuted,
            borderTop: `1px solid ${T.border}`,
          }}
        >
          <span
            role="alert"
            style={{
              color: T.redText,
              padding: '1px 7px',
              borderRadius: T.rx,
              background: T.redSoft,
              border: `1px solid ${T.redBorder}`,
            }}
          >
            {runError.code}: {runError.message}
          </span>
        </div>
      )}

      {expandOpen && (
        <QueryExpandModal
          queryRaw={queryRaw}
          onApply={(next) => {
            onPatch({ queryRaw: next });
            filterField.onChange(next);
          }}
          onClose={() => setExpandOpen(false)}
        />
      )}

      {explainOpen && (
        <ExplainDrawer
          onClose={() => setExplainOpen(false)}
          initialVerbosity={explainVerbosity}
          runExplain={runQueryExplain}
        />
      )}
    </div>
  );
}

export const QueryBar = memo(QueryBarInner);
