import React, { memo } from 'react';
import { ActionIcon, Button, Menu, Popover, Tooltip, VisuallyHidden } from '@mantine/core';
import { themeVars } from '../../theme/themeVars';
import { I } from '../../icons';
import { useShellSyntaxField } from './useShellSyntaxField';
import {
  DRAGGED_FIELD_MIME,
  findProblem,
  limitWarning,
  MAX_TIME_MS_CAP,
  READ_PREFERENCE_MODES,
  resultQueryKey,
  type DraggedField,
  type FindOptionKey,
} from './builder';
import {
  optionPills,
  PILL_LOOK,
  runLabel,
  runProblem,
  runProblemKey,
  runWarning,
  splitPills,
  stripText,
  type OptionKey,
  type OptionPill,
  type RunProblem,
} from './optionPills';
import type { SuggestionContext } from '../../features/fieldSuggestions/types';
import { FieldAutocompleteInput } from '../../features/fieldSuggestions/FieldAutocompleteInput';
import { useTextareaAutocomplete } from '../../features/fieldSuggestions/useTextareaAutocomplete';
import { useCollectionWorkspace } from './context';
import {
  consumeSavedRename,
  consumeTabRequest,
  peekSavedRename,
  subscribeTabRequests,
  tabRequested,
} from './tabRequest';
import { useLatest } from '../../commands/useLatest';
import { formatShortcut } from '../../commands/shortcutLabel';
import { CODE_LANGS, type CodeLang } from '../../utils/driverCode';
import { copyQueryAsCode } from './copyQueryCode';
import { isMacRenderer } from '../../utils/platform';
import { liveValidity } from '../../utils/shellSyntax';
import { useElementWidth } from '../../hooks/useElementWidth';
import { QueryExpandModal } from './QueryExpandModal';
import { LIMIT_EXPLANATION } from './queryCaps';
import { FieldsControl } from './FieldsControl';
import { SavedTab } from './views/SavedTab';
import { RecentTab } from './views/RecentTab';
import { hydrateFindPayload, type LegacySavedFindPayload } from './legacyBuilder';
import type {
  BuilderState,
  CollectionTabState,
  ExplainVerbosity,
  SavedPayload,
  SavedQuerySummary,
} from '@shared/types';
import { FeatureHint } from '../../hints/FeatureHint';
import { useFeatureHint } from '../../hints/useFeatureHint';

interface QueryBarProps {
  suggestionContext: SuggestionContext | null;
  /**
   * Receives the Documents view's ⌘/Ctrl+Enter action. The key is
   * bound once, on `PanelBody`'s panel group, so it reaches every focus in
   * the view (a result row after a drag into the drawer, sort, limit);
   * what it does lives here, beside the drafts it has to flush first.
   */
  runShortcutRef?: React.Ref<() => void>;
  /** Bumped after a save, so an open Saved list re-fetches. */
  savedRefreshKey?: number;
  /** Called after a Saved or History load replaced the query wholesale. */
  onLoaded?: () => void;
  /** Opens a saved aggregation or script as its own tab. */
  onOpenInTab?: (saved: SavedQuerySummary) => void;
  /** Called once the Saved list has renamed one of its entries. */
  onSavedRenamed?: (saved: SavedQuerySummary, name: string) => void;
  /** Whether the Query Builder is open; with `onToggleBuilder`, draws the row's Builder button. */
  builderOpen?: boolean;
  onToggleBuilder?: () => void;
}

// W15 §4.4 — one copy, shown beside the read-only input and read to a
// screen reader. Two copies of a sentence like this drift the first time
// someone edits one.
const SKIP_EXPLANATION = 'Skip is driven by the page selector below the results';

// W07 §3's rule, said beside Run before it applies.
const PAGE_RESET_HINT = 'Will jump to page 1 on run';

// X14 §11 — beside text the transform will rewrite, where a refusal would sit.
const SHELL_SYNTAX_NOTE = 'mongosh syntax — rewritten as EJSON when you run';

/** The element id of each clause's notice, which its input is described by. */
const NOTICE_IDS: Record<RunProblem['clause'], string> = {
  filter: 'query-bar-filter-error',
  sort: 'query-bar-sort-error',
  project: 'query-bar-projection-error',
  limit: 'query-bar-limit-error',
  skip: 'query-bar-skip-error',
  collation: 'query-bar-collation-error',
  hint: 'query-bar-hint-error',
  maxTimeMS: 'query-bar-maxtime-error',
  readPreference: 'query-bar-readpref-error',
};

/** The part of each option editor's ids (`query-bar-<part>-label`), as the grid always named them. */
const EDITOR_IDS: Record<Exclude<OptionKey, 'project'>, string> = {
  sort: 'sort',
  limit: 'limit',
  skip: 'skip',
  collation: 'collation',
  hint: 'hint',
  maxTimeMS: 'maxtime',
  readPreference: 'readpref',
};

/** The Run menu's explain items: the verbosity names read as jargon (W05 §9.5). */
const EXPLAIN_ITEMS: ReadonlyArray<{ verbosity: ExplainVerbosity; label: string }> = [
  { verbosity: 'queryPlanner', label: 'Explain plan' },
  { verbosity: 'executionStats', label: 'Explain with execution stats' },
  { verbosity: 'allPlansExecution', label: 'Explain all plans' },
];

// A stable ref callback: an option's editor takes the focus when its popover
// mounts it. On the editor's wrapper, since the autocomplete input keeps its
// own ref object.
const focusEditorOnMount = (el: HTMLElement | null) => el?.querySelector<HTMLElement>('input, select')?.focus();

/** A modal opened from inside a popover (a delete confirmation) is not a click outside it. */
function modalIsOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

/**
 * One option pill and the popover holding that option's editor (W05 §9.2).
 * Focus is handled here rather than by Mantine: the editor takes it on open,
 * and Mantine's own return target is captured too late to be the pill then.
 */
function OptionPopover({
  pill,
  opened,
  onOpen,
  onClose,
  onRun,
  buttonRef,
  children,
}: {
  pill: OptionPill;
  opened: boolean;
  onOpen: () => void;
  /** `refocus` when the keyboard closed it, so the focus has somewhere to go. */
  onClose: (refocus: boolean) => void;
  onRun: () => void;
  buttonRef: (el: HTMLButtonElement | null) => void;
  children: React.ReactNode;
}) {
  const T = themeVars;
  return (
    <Popover
      opened={opened}
      onChange={(next) => (next ? onOpen() : onClose(false))}
      position="bottom-start"
      shadow="md"
      width={320}
      withinPortal
      // Layered by hand below: an open suggestion list takes Escape first.
      closeOnEscape={false}
      returnFocus={false}
    >
      <Popover.Target>
        <Button
          ref={buttonRef}
          {...PILL_LOOK[pill.status]}
          size="compact-xs"
          h={24}
          data-testid={`option-pill-${pill.key}`}
          data-status={pill.status}
          // A controlled Popover's target does not toggle by itself.
          onClick={() => (opened ? onClose(false) : onOpen())}
          style={{ flexShrink: 0 }}
        >
          {pill.label}
        </Button>
      </Popover.Target>
      <Popover.Dropdown
        p="xs"
        onKeyDown={(e) => {
          // `defaultPrevented`: an open suggestion list already took the key.
          if (e.defaultPrevented) return;
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose(true);
          } else if (e.key === 'Enter') {
            // The panel-level ⌘↵ skips anything inside a dialog, and this is one.
            e.preventDefault();
            e.stopPropagation();
            onClose(true);
            if (e.metaKey || e.ctrlKey) onRun();
          }
        }}
      >
        <div
          id={`query-bar-${EDITOR_IDS[pill.key as keyof typeof EDITOR_IDS]}-label`}
          style={{ fontSize: T.fsXs, fontWeight: 600, color: T.textMuted, marginBottom: 4 }}
        >
          {pill.name}
        </div>
        <div ref={focusEditorOnMount}>{children}</div>
      </Popover.Dropdown>
    </Popover>
  );
}

function QueryBarInner({
  suggestionContext,
  runShortcutRef,
  savedRefreshKey,
  onLoaded,
  onOpenInTab,
  onSavedRenamed,
  builderOpen = false,
  onToggleBuilder,
}: QueryBarProps) {
  const T = themeVars;
  const { state, actions, meta } = useCollectionWorkspace();
  const isLoading = meta.isLoading;
  const onPatch = actions.patch;
  const onRun = actions.run;
  const onCancel = actions.cancel;
  const onSave = actions.openSave;
  const queryRaw = state.queryRaw;
  const builder = state.builder;
  const expanded = state.optionsExpanded === true;

  // X14 §11 — every check that runs while the user types judges the text as
  // the Shell Syntax transform would leave it: `{status: 'shipped'}` runs on
  // ⌘↵, so nothing here may call it invalid. `runProblem` is the Run gate, the
  // Run label and the strip's sentence, so the three cannot disagree.
  // `findProblem` stays the strict rule for the paths with no button.
  const problem = React.useMemo(() => runProblem({ queryRaw, builder }), [queryRaw, builder]);
  const liveFilter = React.useMemo(() => liveValidity(queryRaw), [queryRaw]);
  const pills = React.useMemo(
    () => optionPills({ builder, page: state.page, pageSize: state.pageSize }),
    [builder, state.page, state.pageSize],
  );
  const pillOf = (key: OptionKey) => pills.find((p) => p.key === key)!;
  const limitError = React.useMemo(() => limitWarning(builder.limit), [builder.limit]);

  const builderShortcut = formatShortcut('⌘⇧B', isMacRenderer());
  const canRun = !isLoading && problem === null;
  // W07 §3: the runner's own rule for leaving this page, said ahead of the Run.
  const willResetPage =
    state.page > 0 &&
    findProblem(state) === null &&
    state.lastRunQueryKey !== undefined &&
    resultQueryKey(state) !== state.lastRunQueryKey;

  const [expandOpen, setExpandOpen] = React.useState(false);

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
  // preventDefaults its `onMouseDown` (`SuggestionPopover.tsx`), so picking a
  // suggestion never blurs the textarea in the first place.
  const filterField = useShellSyntaxField({
    value: queryRaw,
    commit: (next) => onPatch({ queryRaw: next }),
  });
  // X14 §3 — the sort field's half, same glue and same conversion point.
  const sortField = useShellSyntaxField({
    value: builder.sort,
    commit: (next) => onPatch({ builder: { ...builder, sort: next } }),
  });

  // W05 §9.3 — the strip under the row. A notice is raised at a commit point
  // (a blur, a closed popover, a Run attempt), never derived per keystroke:
  // it is a `role="alert"`, and a derived one would announce a half-typed
  // `{age:` on every character and move the rows with it. It is kept with the
  // query it judged, so any later edit, from anywhere, retires it.
  const [raised, setRaised] = React.useState<{
    notice: RunProblem;
    blocking: boolean;
    key: string;
    seq: number;
  } | null>(null);
  const raise = (s: Pick<CollectionTabState, 'queryRaw' | 'builder'>, announce: boolean) => {
    const blocking = runProblem(s);
    const notice = blocking ?? runWarning(s);
    setRaised((prev) => {
      if (notice === null) return null;
      const key = runProblemKey(s);
      const same = prev?.key === key && prev.notice.message === notice.message;
      // `seq` remounts the alert, so a repeated refused Run is announced
      // again; a blur that changes nothing is not.
      const seq = same && !announce ? prev.seq : (prev?.seq ?? 0) + 1;
      return { notice, blocking: blocking !== null, key, seq };
    });
  };
  // A tab arriving in front is a commit point too: nothing is being typed, and
  // a restored query that cannot run has to say why, since Run is disabled.
  const [judgedTab, setJudgedTab] = React.useState<string | null>(null);
  if (judgedTab !== meta.tabId) {
    setJudgedTab(meta.tabId);
    raise({ queryRaw, builder }, false);
  }
  const shown = raised?.key === runProblemKey({ queryRaw, builder }) ? raised : null;
  // A run the runner refused (Saved or History "Run", the palette) keeps its
  // rows, so the pane has no room to say why. Only until the text can run.
  const refusedRun =
    state.lastRun?.error && state.lastRun.documents.length > 0 && findProblem(state) !== null
      ? state.lastRun.error.message
      : null;
  const mirrorRef = React.useRef<HTMLDivElement>(null);
  const errorRange = shown?.notice.clause === 'filter' ? (shown.notice.range ?? null) : null;
  const noticeId = (clause: RunProblem['clause']) => (shown?.notice.clause === clause ? NOTICE_IDS[clause] : undefined);

  /** Repairs the filter and the sort, and hands back the query to act on this tick: a patch lands async. */
  const settle = (): Pick<CollectionTabState, 'queryRaw' | 'builder'> => {
    const filter = filterField.commitNow();
    const sort = sortField.repairNow();
    const next = sort.text === builder.sort ? builder : { ...builder, sort: sort.text };
    if (next !== builder) onPatch({ builder: next });
    return { queryRaw: filter.text, builder: next };
  };

  const handleBlur = () => {
    autocomplete.onBlur();
    raise({ queryRaw: filterField.commitNow().text, builder }, false);
  };
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onPatch({ queryRaw: e.target.value });
    autocomplete.probe();
  };

  const handleSortChange = (v: string) => {
    onPatch({ builder: { ...builder, sort: v } });
  };
  const handleSortBlur = () => {
    const { text } = sortField.commitNow();
    raise({ queryRaw, builder: text === builder.sort ? builder : { ...builder, sort: text } }, false);
  };
  /** The other option inputs commit as they are typed; leaving one is still a commit point. */
  const handleOptionBlur = () => raise({ queryRaw, builder }, false);

  // A field dropped on the sort (ADR 0007 item 4) always sorts it ascending
  // and replaces any sort there: ascending is the first step of the header's
  // cycle, and a drop that flipped or cleared would let re-dropping the same
  // field silently remove the sort.
  const [sortDropActive, setSortDropActive] = React.useState(false);
  const acceptsField = (e: React.DragEvent) => e.dataTransfer.types.includes(DRAGGED_FIELD_MIME);
  const handleSortDragOver = (e: React.DragEvent) => {
    if (!acceptsField(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!sortDropActive) setSortDropActive(true);
  };
  const handleSortDrop = (e: React.DragEvent) => {
    if (!acceptsField(e)) return;
    e.preventDefault();
    setSortDropActive(false);
    // `null` and bare scalars parse too; the field check below refuses them.
    let dragged: DraggedField | null;
    try {
      dragged = JSON.parse(e.dataTransfer.getData(DRAGGED_FIELD_MIME)) as DraggedField;
    } catch {
      return;
    }
    if (typeof dragged?.field !== 'string' || !dragged.field) return;
    handleSortChange(JSON.stringify({ [dragged.field]: 1 }));
  };
  const sortDropProps = {
    'data-testid': 'query-bar-sort-drop',
    onDragOver: handleSortDragOver,
    onDragLeave: () => setSortDropActive(false),
    onDrop: handleSortDrop,
  };
  const sortDropStyle: React.CSSProperties | null = sortDropActive
    ? { background: T.accentSoft, outline: `1.5px dashed ${T.accent}` }
    : null;

  const handleLimitChange = (v: string) => {
    onPatch({ builder: { ...builder, limit: v } });
  };
  const handleOptionChange = (key: FindOptionKey, v: string) => {
    onPatch({ builder: { ...builder, [key]: v } as BuilderState });
  };

  // Run, from the button, its menu and the Documents view's ⌘/Ctrl+Enter. No
  // blur has run when a key is pressed, so every draft is repaired before the
  // gate, never after it: gating the raw text would refuse `{age: {$gt: 60}}`
  // or a `{name: 1}` sort. Patches land async, so the repaired values also
  // ride along as the `run` override. A refused press raises the strip.
  //
  // The projection is not settled here: its draft lives in the Project pill,
  // whose dropdown is a dialog the panel-level ⌘↵ skips, so that control runs
  // its own ⌘↵ with the draft settled.
  const runNow = () => {
    if (isLoading) return;
    const next = settle();
    raise(next, true);
    if (runProblem(next) === null) onRun(next);
  };
  React.useImperativeHandle(runShortcutRef, () => runNow);

  // X14 — Explain reads through the repair, like every other surface.
  const onExplain = (verbosity: ExplainVerbosity) => {
    if (isLoading) return;
    const next = settle();
    raise(next, true);
    if (runProblem(next) !== null) return;
    // The Inspector's Plan tab (W05 §9.7), which reads the query just settled.
    actions.openPlan?.({ verbosity });
  };

  // W05 §9.5 — Copy query as…, through the same repair: the filter as typed
  // (`{status: 'shipped'}`) copies as the query that runs.
  const onCopyAs = (lang: CodeLang) => {
    const next = settle();
    raise(next, true);
    if (runProblem(next) !== null) return;
    copyQueryAsCode(lang, { ...state, ...next }, meta.collection);
  };

  // The palette's Explain query on this tab: this menu's first item, once.
  const explainRequested = React.useSyncExternalStore(subscribeTabRequests, () =>
    tabRequested('explain', meta.tabId),
  );
  const onExplainRef = useLatest(onExplain);
  React.useEffect(() => {
    if (!explainRequested) return;
    consumeTabRequest('explain', meta.tabId);
    onExplainRef.current('queryPlanner');
  }, [explainRequested, meta.tabId, onExplainRef]);

  // Which option's editor is open, with the tab it was opened on: the bar
  // never remounts, so tab A's open popover must not reappear over tab B.
  const [openOption, setOpenOption] = React.useState<{ tabId: string; key: OptionKey } | null>(null);
  const openKey = openOption?.tabId === meta.tabId ? openOption.key : null;
  const pillRefs = React.useRef(new Map<OptionKey, HTMLButtonElement | null>());
  const openPill = (key: OptionKey) => setOpenOption({ tabId: meta.tabId, key });
  const closePill = (key: OptionKey, refocus: boolean) => {
    setOpenOption(null);
    // Closing is a commit point, and the editor's own blur may never fire:
    // the dropdown unmounts under it.
    if (key === 'sort') handleSortBlur();
    else handleOptionBlur();
    const pill = pillRefs.current.get(key);
    if (refocus) pill?.focus();
    // A click that closed it on something focusable keeps the focus there;
    // one on a blank area would drop it to <body>.
    else {
      window.setTimeout(() => {
        if (document.activeElement === document.body) pill?.focus();
      }, 0);
    }
  };

  const { row: rowPills, more: morePills } = splitPills(pills, openKey);

  // Saved and History: the row's two popovers are their only home (W05 §9.6).
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [savedOpen, setSavedOpen] = React.useState(false);
  // The palette's Rename… (X07 §13.12) lands in the Saved list's own input.
  const renameRequest = React.useSyncExternalStore(subscribeTabRequests, () => peekSavedRename(meta.tabId));
  if (renameRequest !== null && !savedOpen) setSavedOpen(true);
  const closeSaved = () => {
    // A rename that was asked for and not started must not reopen the list.
    consumeSavedRename(meta.tabId);
    setSavedOpen(false);
  };
  const loadFind = (payload: SavedPayload) => {
    if (payload.kind !== 'find') return;
    const patch = hydrateFindPayload(payload as unknown as LegacySavedFindPayload, builder);
    // The draft belongs to the filter being replaced: drop it with it.
    onPatch({ ...patch, filterDraft: undefined });
    onRun(patch);
    onLoaded?.();
  };

  const findOptionsHint = useFeatureHint('find.options', !!builder.collation?.trim() || !!builder.hint?.trim());

  const skipValue = state.page * state.pageSize;

  // Shared cell styles for the grid under the row ("Keep options expanded").
  // The label cells are a slightly raised background to read as row headers.
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
    fontSize: T.fsXs,
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
  /** An option input: borderless in a grid cell, boxed in a pill's popover. */
  const inputStyle = (inPill: boolean, invalid: boolean): React.CSSProperties => ({
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: T.fsXs,
    background: 'transparent',
    color: T.text,
    outline: 'none',
    ...(inPill
      ? {
          width: '100%',
          boxSizing: 'border-box',
          padding: '4px 6px',
          border: `1px solid ${invalid ? T.warn : T.border}`,
          borderRadius: T.rs,
        }
      : {
          flex: 1,
          minWidth: 0,
          padding: '4px 0',
          border: 'none',
          borderBottom: `1px solid ${invalid ? T.warn : 'transparent'}`,
        }),
  });
  const helpStyle: React.CSSProperties = { marginTop: 4, fontSize: T.fsXs, color: T.textMuted };

  // The option editors. One copy each, drawn in a pill's popover or in a grid
  // cell: the same input, the same Shell Syntax handling, the same validation
  // (W05 §9.2). Each is named by the visible label its host renders, under the
  // same id (W15 §5).
  const sortEditor = (inPill: boolean) => (
    <FieldAutocompleteInput
      value={builder.sort}
      onChange={handleSortChange}
      context={suggestionContext}
      mode="token"
      onBlur={handleSortBlur}
      placeholder='{"_id":-1}'
      dataTestid="query-bar-sort"
      ariaLabelledBy="query-bar-sort-label"
      ariaInvalid={pillOf('sort').status === 'invalid'}
      ariaDescribedBy={noticeId('sort')}
      style={inputStyle(inPill, pillOf('sort').status === 'invalid')}
    />
  );
  const skipEditor = (inPill: boolean) => {
    // W15 §4.4 — a read-only `<input>`, not a `<span>`: native, focusable
    // and nameable, so the one sentence explaining why this ignores typing
    // reaches a keyboard and a screen reader too.
    const input = (
      <input
        type="text"
        readOnly
        value={skipValue}
        aria-labelledby="query-bar-skip-label"
        aria-describedby="query-bar-skip-help"
        data-testid="query-bar-skip"
        style={{ ...inputStyle(inPill, false), color: T.textMuted, cursor: 'default' }}
      />
    );
    return inPill ? (
      <>
        {input}
        <div id="query-bar-skip-help" style={helpStyle}>{SKIP_EXPLANATION}</div>
      </>
    ) : (
      <>
        <Tooltip label={SKIP_EXPLANATION} withArrow events={{ hover: true, focus: true, touch: false }}>
          {input}
        </Tooltip>
        <VisuallyHidden id="query-bar-skip-help">{SKIP_EXPLANATION}</VisuallyHidden>
      </>
    );
  };
  const limitEditor = (inPill: boolean) => {
    const input = (
      <input
        type="number"
        min={1}
        value={builder.limit}
        onChange={(e) => handleLimitChange(e.target.value)}
        onBlur={handleOptionBlur}
        placeholder="—"
        data-testid="query-bar-limit"
        aria-labelledby="query-bar-limit-label"
        aria-invalid={limitError !== null}
        aria-describedby={[noticeId('limit'), 'query-bar-limit-help'].filter(Boolean).join(' ')}
        style={inputStyle(inPill, limitError !== null)}
      />
    );
    return inPill ? (
      <>
        {input}
        <div id="query-bar-limit-help" style={helpStyle}>{LIMIT_EXPLANATION}</div>
      </>
    ) : (
      <>
        <Tooltip label={LIMIT_EXPLANATION} withArrow events={{ hover: true, focus: true, touch: false }}>
          {input}
        </Tooltip>
        <VisuallyHidden id="query-bar-limit-help">{LIMIT_EXPLANATION}</VisuallyHidden>
      </>
    );
  };
  const textOptionEditor = (
    key: 'collation' | 'hint' | 'maxTimeMS',
    placeholder: string,
    inPill: boolean,
  ) => {
    const invalid = pillOf(key).status === 'invalid';
    return (
      <input
        type={key === 'maxTimeMS' ? 'number' : 'text'}
        min={key === 'maxTimeMS' ? 1 : undefined}
        value={builder[key] ?? ''}
        onChange={(e) => handleOptionChange(key, e.target.value)}
        onBlur={handleOptionBlur}
        placeholder={placeholder}
        spellCheck={false}
        data-testid={`query-bar-${EDITOR_IDS[key]}`}
        aria-labelledby={`query-bar-${EDITOR_IDS[key]}-label`}
        aria-invalid={invalid}
        aria-describedby={noticeId(key)}
        style={inputStyle(inPill, invalid)}
      />
    );
  };
  const readPrefEditor = (inPill: boolean) => {
    const invalid = pillOf('readPreference').status === 'invalid';
    return (
      <select
        value={builder.readPreference ?? ''}
        onChange={(e) => handleOptionChange('readPreference', e.target.value)}
        onBlur={handleOptionBlur}
        data-testid="query-bar-readpref"
        aria-labelledby="query-bar-readpref-label"
        aria-invalid={invalid}
        aria-describedby={noticeId('readPreference')}
        // Opaque, like the app's other native selects: Chromium paints the
        // option list from the select's own background.
        style={{ ...inputStyle(inPill, invalid), background: T.surface, cursor: 'pointer' }}
      >
        <option value="">connection default</option>
        {READ_PREFERENCE_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {mode}
          </option>
        ))}
        {/* A restored value the list does not have stays visible, so the
            problem it raises names what is selected. */}
        {invalid && <option value={builder.readPreference}>{builder.readPreference}</option>}
      </select>
    );
  };
  const editorOf = (key: Exclude<OptionKey, 'project'>, inPill: boolean): React.ReactNode => {
    switch (key) {
      case 'sort':
        return sortEditor(inPill);
      case 'limit':
        return limitEditor(inPill);
      case 'skip':
        return skipEditor(inPill);
      case 'collation':
        return textOptionEditor('collation', '{"locale":"en","strength":2}', inPill);
      case 'hint':
        return textOptionEditor('hint', '_id_ or {"a":1}', inPill);
      case 'maxTimeMS':
        return textOptionEditor('maxTimeMS', `max ${MAX_TIME_MS_CAP}`, inPill);
      case 'readPreference':
        return readPrefEditor(inPill);
    }
  };

  // Below this the labelled Builder, History and Save leave the filter too little room.
  const [rootRef, rootWidth] = useElementWidth<HTMLDivElement>();
  const compact = rootWidth !== null && rootWidth < 640;
  // The page-reset sentence is ~170px of the actions' width, which the
  // filter pays for: it turns into an icon sooner than the buttons do.
  const hintCompact = rootWidth !== null && rootWidth < 800;
  // Every group in the row is one line of the row's own 44px, so the row
  // keeps its height while the filter grows and wraps cleanly when narrow.
  const groupStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', minHeight: 44 };

  return (
    <div
      ref={rootRef}
      style={{
        borderBottom: `1px solid ${T.border}`,
        background: T.surface,
        flexShrink: 0,
      }}
    >
      {/* The Filter Bar row (W05 §9.1): the filter, the query's options as
          pills, then Builder, History, Save and Run. */}
      <div
        data-testid="filter-bar-row"
        style={{
          position: 'relative',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          columnGap: T.gapSm,
          padding: '0 8px 0 12px',
        }}
      >
        <label
          id="query-bar-filter-label"
          htmlFor="query-bar-filter"
          style={{ ...groupStyle, fontSize: T.fsXs, fontWeight: 600, color: T.textMuted, flexShrink: 0 }}
        >
          Filter
        </label>
        <div style={{ ...groupStyle, alignItems: 'flex-start', flex: '1 1 220px', minWidth: 160, padding: '8px 0', boxSizing: 'border-box' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex' }}>
          <textarea
            id="query-bar-filter"
            ref={textareaRef}
            value={queryRaw}
            onChange={handleChange}
            onKeyUp={autocomplete.probe}
            onClick={autocomplete.probe}
            onFocus={autocomplete.probe}
            onBlur={handleBlur}
            onScroll={(e) => {
              if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop;
            }}
            spellCheck={false}
            data-testid="query-bar-input"
            aria-invalid={shown?.notice.clause === 'filter'}
            aria-describedby={noticeId('filter')}
            placeholder={`{ field: value } — press ${formatShortcut('⌘↵', isMacRenderer())} to run`}
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: T.fsSm,
              padding: '3px 8px',
              border: 'none',
              borderBottom: `1px solid ${problem?.clause === 'filter' && queryRaw !== '{}' ? T.warn : 'transparent'}`,
              background: 'transparent',
              color: T.text,
              resize: 'vertical',
              minHeight: 28,
              maxHeight: 240,
              boxSizing: 'border-box',
              outline: 'none',
              lineHeight: 1.5,
            }}
            rows={1}
          />
          {errorRange ? (
            // Same box and type as the textarea with transparent text, so the
            // marked span sits exactly under the offending characters.
            // ponytail: a visible textarea scrollbar narrows its text, which can wrap the mirror differently.
            <div
              ref={mirrorRef}
              aria-hidden="true"
              data-testid="query-bar-error-range"
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                overflow: 'hidden',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'break-word',
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: T.fsSm,
                padding: '3px 8px',
                borderBottom: '1px solid transparent',
                boxSizing: 'border-box',
                lineHeight: 1.5,
                color: 'transparent',
              }}
            >
              {queryRaw.slice(0, errorRange.start)}
              <mark
                style={{
                  background: 'transparent',
                  color: 'transparent',
                  textDecoration: `underline wavy ${T.redText}`,
                  textUnderlineOffset: 3,
                }}
              >
                {queryRaw.slice(errorRange.start, errorRange.end)}
              </mark>
              {queryRaw.slice(errorRange.end)}
            </div>
          ) : null}
          </div>
          <Tooltip label="Expand" withArrow>
            <Button
              variant="subtle"
              size="compact-xs"
              px={4}
              onClick={() => setExpandOpen(true)}
              aria-label="Expand query filter"
              data-testid="query-bar-expand-btn"
              style={{ flexShrink: 0, marginTop: 3 }}
            >
              {I.expand}
            </Button>
          </Tooltip>
          {autocomplete.popover}
        </div>

        {/* Option pills (W05 §9.2). With "Keep options expanded" on, the
            options are the grid below and only Project, which the grid never
            held, stays a pill. */}
        <div
          data-testid="query-bar-options"
          data-hint-anchor={expanded ? undefined : 'find.options'}
          style={{ ...groupStyle, flexWrap: 'wrap', gap: T.gapXs, minWidth: 0 }}
        >
          {rowPills.map((pill) => {
            if (pill.key === 'project') return <FieldsControl key="project" />;
            if (expanded) return null;
            const key = pill.key;
            const popover = (
              <OptionPopover
                key={key}
                pill={pill}
                opened={openKey === key}
                onOpen={() => openPill(key)}
                onClose={(refocus) => closePill(key, refocus)}
                onRun={runNow}
                buttonRef={(el) => {
                  pillRefs.current.set(key, el);
                }}
              >
                {editorOf(key, true)}
              </OptionPopover>
            );
            // The Sort pill takes a dropped field, as the grid's sort cell does.
            return key === 'sort' ? (
              <span key={key} {...sortDropProps} style={{ display: 'inline-flex', borderRadius: T.rs, ...sortDropStyle }}>
                {popover}
              </span>
            ) : (
              popover
            );
          })}
          <Menu position="bottom-end" shadow="md" width={210}>
            <Menu.Target>
              <Button
                variant="subtle"
                color="gray"
                size="compact-xs"
                h={24}
                leftSection={I.more}
                data-testid="query-bar-more"
                style={{ flexShrink: 0 }}
              >
                More
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {!expanded &&
                morePills.map((pill) => (
                  <Menu.Item key={pill.key} onClick={() => openPill(pill.key)}>
                    {pill.name}
                  </Menu.Item>
                ))}
              {!expanded && morePills.length > 0 && <Menu.Divider />}
              <Menu.CheckboxItem
                checked={expanded}
                onChange={(next) => onPatch({ optionsExpanded: next })}
                closeMenuOnClick
              >
                Keep options expanded
              </Menu.CheckboxItem>
            </Menu.Dropdown>
          </Menu>
        </div>

        {/* Builder · History · Save · Run (split). This is the one Save button
            in the Documents view, so `saved.create`'s hint anchor lives here. */}
        <div
          data-testid="query-bar-actions"
          style={{ ...groupStyle, gap: T.gapSm, marginLeft: 'auto', flexShrink: 0 }}
        >
          {/* Narrow, the sentence would take the filter's room: an icon keeps it
              as a tooltip and, for a screen reader, as text. */}
          {willResetPage &&
            (hintCompact ? (
              <Tooltip label={PAGE_RESET_HINT} withArrow>
                <span data-testid="page-reset-hint" style={{ display: 'inline-flex', color: T.textMuted }}>
                  <span aria-hidden="true" style={{ display: 'inline-flex' }}>
                    {I.chevLL}
                  </span>
                  <VisuallyHidden>{PAGE_RESET_HINT}</VisuallyHidden>
                </span>
              </Tooltip>
            ) : (
              <span
                data-testid="page-reset-hint"
                style={{ fontSize: T.fsXs, color: T.textMuted, whiteSpace: 'nowrap' }}
              >
                {PAGE_RESET_HINT}
              </span>
            ))}
          {onToggleBuilder &&
            (compact ? (
              <Tooltip label={`Builder (${builderShortcut})`} withArrow>
                <ActionIcon
                  variant={builderOpen ? 'light' : 'default'}
                  size={22}
                  onClick={onToggleBuilder}
                  aria-label="Builder"
                  aria-pressed={builderOpen}
                  data-builder-toggle
                >
                  {I.filter}
                </ActionIcon>
              </Tooltip>
            ) : (
              <Tooltip label={`Builder (${builderShortcut})`} withArrow>
                <Button
                  variant={builderOpen ? 'light' : 'default'}
                  size="compact-xs"
                  leftSection={I.filter}
                  onClick={onToggleBuilder}
                  aria-pressed={builderOpen}
                  data-builder-toggle
                >
                  Builder
                </Button>
              </Tooltip>
            ))}
          <Popover
            opened={historyOpen}
            onChange={(next) => (next || !modalIsOpen()) && setHistoryOpen(next)}
            position="bottom-end"
            shadow="md"
            width={360}
            withinPortal
            closeOnEscape={false}
            returnFocus
          >
            <Tooltip label="History" withArrow disabled={!compact}>
              <Popover.Target>
                {compact ? (
                  <ActionIcon variant="default" size={22} onClick={() => setHistoryOpen((o) => !o)} aria-label="History">
                    {I.clock}
                  </ActionIcon>
                ) : (
                  <Button
                    variant="default"
                    size="compact-xs"
                    leftSection={I.clock}
                    rightSection={I.chevD}
                    onClick={() => setHistoryOpen((o) => !o)}
                  >
                    History
                  </Button>
                )}
              </Popover.Target>
            </Tooltip>
            <Popover.Dropdown
              p={0}
              onKeyDown={(e) => {
                if (e.key !== 'Escape' || e.defaultPrevented) return;
                e.stopPropagation();
                setHistoryOpen(false);
              }}
            >
              <RecentTab
                connectionId={meta.connectionId}
                dbName={meta.dbName}
                collection={meta.collection}
                onRunHere={(recent) => {
                  setHistoryOpen(false);
                  loadFind(recent.payload);
                }}
              />
            </Popover.Dropdown>
          </Popover>
          {/* `☆`: saving the current query, and the list of saved ones (W09 §12). */}
          <Popover
            opened={savedOpen}
            onChange={(next) => (next ? setSavedOpen(true) : !modalIsOpen() && closeSaved())}
            position="bottom-end"
            shadow="md"
            width={360}
            withinPortal
            closeOnEscape={false}
            returnFocus
          >
            <Button.Group>
              {compact ? (
                <Tooltip label="Save" withArrow>
                  <ActionIcon
                    data-hint-anchor="saved.create"
                    variant="default"
                    size={22}
                    onClick={onSave}
                    aria-label="Save"
                  >
                    {I.save}
                  </ActionIcon>
                </Tooltip>
              ) : (
                <Button
                  data-hint-anchor="saved.create"
                  variant="default"
                  size="compact-xs"
                  leftSection={I.save}
                  onClick={onSave}
                >
                  Save
                </Button>
              )}
              <Tooltip label="Saved queries" withArrow>
                <Popover.Target>
                  <Button
                    variant="default"
                    size="compact-xs"
                    px={4}
                    onClick={() => (savedOpen ? closeSaved() : setSavedOpen(true))}
                    aria-label="Saved queries"
                    data-testid="query-bar-saved-btn"
                  >
                    {I.chevD}
                  </Button>
                </Popover.Target>
              </Tooltip>
            </Button.Group>
            <Popover.Dropdown
              p={0}
              onKeyDown={(e) => {
                if (e.key !== 'Escape' || e.defaultPrevented) return;
                e.stopPropagation();
                closeSaved();
              }}
            >
              <SavedTab
                connectionId={meta.connectionId}
                dbName={meta.dbName}
                collection={meta.collection}
                refreshKey={savedRefreshKey}
                onRunHere={(saved) => {
                  closeSaved();
                  loadFind(saved.payload);
                }}
                onOpenInTab={(saved) => {
                  closeSaved();
                  onOpenInTab?.(saved);
                }}
                tabId={meta.tabId}
                onRenamed={onSavedRenamed}
              />
            </Popover.Dropdown>
          </Popover>
          <span
            aria-hidden="true"
            style={{ width: 1, height: 20, background: T.border, margin: '0 2px' }}
          />
          {/* Run is the row's, and the view's, only filled button. */}
          <Button.Group>
            {isLoading ? (
              <Tooltip label="Cancel" withArrow>
                <Button
                  variant="outline"
                  color="red"
                  size="compact-xs"
                  onClick={onCancel}
                  data-testid="query-cancel-btn"
                >
                  Cancel
                </Button>
              </Tooltip>
            ) : (
              <Tooltip label={problem ? stripText(problem) : 'Run (Cmd+Enter)'} withArrow>
                <Button
                  variant="filled"
                  size="compact-xs"
                  onClick={runNow}
                  disabled={!canRun}
                  data-testid="query-run-btn"
                  data-hint-anchor="run.execute"
                  leftSection={I.play}
                  rightSection={
                    problem === null ? (
                      <span aria-hidden="true" style={{ opacity: 0.75, fontWeight: 400 }}>
                        {formatShortcut('⌘↵', isMacRenderer())}
                      </span>
                    ) : undefined
                  }
                >
                  {runLabel(problem)}
                </Button>
              </Tooltip>
            )}
            <Menu position="bottom-end" shadow="md" width={230}>
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
                <Menu.Item leftSection={I.play} onClick={runNow}>
                  Run
                </Menu.Item>
                <Menu.Divider />
                <Menu.Label>Explain</Menu.Label>
                {EXPLAIN_ITEMS.map(({ verbosity, label }) => (
                  <Menu.Item
                    key={verbosity}
                    leftSection={I.eye}
                    disabled={!canRun}
                    onClick={() => onExplain(verbosity)}
                  >
                    {label}
                  </Menu.Item>
                ))}
                <Menu.Divider />
                <Menu.Label>Copy query as…</Menu.Label>
                {CODE_LANGS.map(({ lang, label }) => (
                  <Menu.Item key={lang} leftSection={I.copy} disabled={!canRun} onClick={() => onCopyAs(lang)}>
                    {label}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          </Button.Group>
        </div>

        {/* W05 §9.5 — two pixels of motion under the row while a find is in
            flight. Laid over the row's edge, so starting one moves nothing. */}
        {isLoading && (
          <div
            role="progressbar"
            aria-label="Query running"
            data-testid="query-running-bar"
            className="query-running-bar"
          />
        )}
      </div>

      {/* The strip (W05 §9.3): why the query cannot run, or what it runs as,
          whole and wrapped. Its neighbours wait their turn: one at a time. */}
      {shown ? (
        <div
          key={`${NOTICE_IDS[shown.notice.clause]}-${shown.seq}`}
          id={NOTICE_IDS[shown.notice.clause]}
          role="alert"
          data-testid="query-bar-strip"
          data-tone={shown.blocking ? 'error' : 'warn'}
          style={{
            padding: '4px 12px',
            borderTop: `1px solid ${shown.blocking ? T.redBorder : T.warnBorder}`,
            background: shown.blocking ? T.redSoft : T.warnSoft,
            color: shown.blocking ? T.redText : T.warnText,
            fontSize: T.fsXs,
            lineHeight: 1.5,
            overflowWrap: 'anywhere',
          }}
        >
          <span aria-hidden="true">⚠ </span>
          {stripText(shown.notice)}
        </div>
      ) : refusedRun ? (
        <div
          id="query-bar-run-refused"
          role="alert"
          data-testid="query-bar-strip"
          data-tone="error"
          style={{
            padding: '4px 12px',
            borderTop: `1px solid ${T.redBorder}`,
            background: T.redSoft,
            color: T.redText,
            fontSize: T.fsXs,
            lineHeight: 1.5,
            overflowWrap: 'anywhere',
          }}
        >
          <span aria-hidden="true">⚠ </span>
          {refusedRun}
        </div>
      ) : (
        liveFilter.repaired &&
        liveFilter.runnable && (
          // Not an alert: nothing is wrong, and it shows while the user types.
          <div
            data-testid="query-bar-syntax-note"
            style={{
              padding: '4px 12px',
              borderTop: `1px solid ${T.border}`,
              color: T.textMuted,
              fontSize: T.fsXs,
              lineHeight: 1.5,
            }}
          >
            {SHELL_SYNTAX_NOTE}
          </div>
        )
      )}

      {expanded && (
        <div id="query-bar-advanced" data-hint-anchor="find.options">
          {/* SORT row — the full width, since a multi-field sort is the longest
              value here. Projection is not in the grid: it is the Project pill. */}
          <div style={{ ...gridStyle, gridTemplateColumns: '120px 1fr' }}>
            {/* W15 §5 — the label cells name the inputs: `aria-labelledby`
                points at the exact text on screen, so the two cannot drift. */}
            <div id="query-bar-sort-label" style={labelCellStyle}>sort</div>
            <div {...sortDropProps} style={{ ...valueCellLast, ...sortDropStyle }}>
              {sortEditor(false)}
            </div>
          </div>

          {/* SKIP + LIMIT row */}
          <div style={gridStyle}>
            <div id="query-bar-skip-label" style={labelCellStyle}>skip</div>
            <div style={valueCellStyle}>{skipEditor(false)}</div>
            <div id="query-bar-limit-label" style={labelCellStyle}>limit</div>
            <div style={valueCellLast}>{limitEditor(false)}</div>
          </div>

          {/* OPTIONS rows (W14 §9): what the find carries besides its clauses. */}
          <div style={{ ...gridStyle, gridTemplateColumns: '120px 1fr 120px 1fr' }}>
            <div id="query-bar-collation-label" style={labelCellStyle}>collation</div>
            <div style={valueCellStyle}>{editorOf('collation', false)}</div>
            <div id="query-bar-hint-label" style={labelCellStyle}>hint</div>
            <div style={valueCellLast}>{editorOf('hint', false)}</div>
          </div>
          <div style={{ ...gridStyle, gridTemplateColumns: '120px 1fr 120px 1fr' }}>
            <div id="query-bar-maxtime-label" style={labelCellStyle}>maxTimeMS</div>
            <div style={valueCellStyle}>{editorOf('maxTimeMS', false)}</div>
            <div id="query-bar-readpref-label" style={labelCellStyle}>read pref</div>
            <div style={valueCellLast}>{editorOf('readPreference', false)}</div>
          </div>
        </div>
      )}

      {expandOpen && (
        <QueryExpandModal
          queryRaw={queryRaw}
          onApply={(next) => onPatch({ queryRaw: next })}
          onClose={() => setExpandOpen(false)}
        />
      )}

      <FeatureHint
        id="find.options"
        visible={findOptionsHint.visible}
        onDismiss={findOptionsHint.dismiss}
      />
    </div>
  );
}

export const QueryBar = memo(QueryBarInner);
