import React from 'react';
import { themeVars } from '../../../theme/themeVars';
import { submittingProps } from '../../../components/SubmitButton';
import { I } from '../../../icons';
import { Button, Group, Menu, Modal, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { api, getErrorMessage, isIpcError } from '../../../api/atelier';
import { logFailure } from '../../../utils/rendererLog';
import { notify } from '../../../theme/notifications';
import type {
  AggregationLastRun,
  AggregationTabState,
  ExplainVerbosity,
  ResultViewMode,
  Stage,
  StageOp,
} from '@shared/types';
import { repairOnCommit } from '../../../utils/shellSyntax';
import {
  addStage,
  duplicateStage,
  moveStage,
  removeStage as removeStageOp,
  restoreStage,
  setBody as setBodyOp,
  setOp as setOpOp,
  pipelineSigs,
  toggleEnabled as toggleEnabledOp,
  validatePipeline,
  isWriteStage,
  runBlockedReason,
} from './pipeline';
import { StageAccordion } from './StageAccordion';
import { OutputPanel, type PreviewStage } from './OutputPanel';
import { ONE_PANEL_BELOW_PX } from '../sidePanels';
import { resizeKeyStep } from '../resizeKeyStep';
import { formatShortcut } from '../../../commands/shortcutLabel';
import { isMacRenderer } from '../../../utils/platform';
import { useRegisterCommands } from '../../../commands/useRegisterCommands';
import { useLatest } from '../../../commands/useLatest';
import { useDialogFocusReturn } from '../../../hooks/useDialogFocusReturn';
import type { SuggestionContext } from '../../../features/fieldSuggestions/types';
import { invalidateSampleSchemaCache } from '../../../features/fieldSuggestions/sources/sampleSchemaSource';
import { invalidateSchemaEnumCache } from '../../../features/fieldSuggestions/sources/schemaEnumSource';
import { invalidateRecentValuesCache } from '../../../features/fieldSuggestions/sources/recentValuesSource';
import { fieldValueEntriesFromStages } from '../../../features/fieldSuggestions/fieldValueEntries';
import { ExplainDrawer } from './ExplainDrawer';
import { SaveAsCollectionModal } from './SaveAsCollectionModal';
import { notifyCollectionChanged } from '../../../state/collectionChanges';
import { SaveAsViewModal } from './SaveAsViewModal';
import { saveResultMessage } from './saveResultMessage';
import { SavePipelineModal } from './SavePipelineModal';
import { pipelineJsonForCopy } from '../builderToPipeline';
import { aggregateCode, CODE_LANGS, type CodeLang } from '../../../utils/driverCode';
import { copyToClipboard } from '../../../utils/clipboard';
import { consumeTabRequest, subscribeTabRequests, tabRequested } from '../tabRequest';

/** The stages column beside the preview (A01 §9.1): its width at 1440 and its limits. */
const STAGES_DEFAULT_PX = 480;
const STAGES_MIN_PX = 320;

function stagesMaxPx(): number {
  return Math.max(STAGES_MIN_PX, Math.floor(window.innerWidth * 0.6));
}

/** One stage's sample and count, with the `pipelineSigs` signature it was taken under. */
interface StagePreviewResult {
  sample?: unknown[];
  count?: number;
  sig?: string;
}

interface Props {
  connectionId: string;
  dbName: string;
  collection: string;
  state: AggregationTabState;
  darkMode: boolean;
  sourceCount: number | null;
  onPatch: (patch: Partial<AggregationTabState>) => void;
  /** The workspace tab it is on, for a Run asked of it from outside (the palette's saved pipeline Run). */
  tabId?: string;
}

export function AggregationTab({
  connectionId,
  dbName,
  collection,
  state,
  darkMode,
  sourceCount,
  onPatch,
  tabId,
}: Props) {
  const T = themeVars;
  const stages = state.stages;

  const [running, setRunning] = React.useState(false);
  const [explainOpen, setExplainOpen] = React.useState(false);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [saveAsCollectionOpen, setSaveAsCollectionOpen] = React.useState(false);
  // The repaired stages the view is saved from, or null while the dialog is closed.
  const [saveAsViewStages, setSaveAsViewStages] = React.useState<Stage[] | null>(null);
  const [writeWarning, setWriteWarning] = React.useState<{
    op: string;
    target?: string;
  } | null>(null);
  const runTokenRef = React.useRef<string | null>(null);
  // A confirmed write run can't be dropped on Cancel: main asks the server to
  // kill a write that was already sent, and the run settles as stopped, as
  // completed (the kill was refused or came too late) or as the write's own
  // error. `runIsWriteRef` marks the run in flight as one; `stopping` (state
  // for the button, ref for the settling run's closure) is the
  // Cancel-was-pressed state while it settles.
  const runIsWriteRef = React.useRef(false);
  const stoppingRef = React.useRef(false);
  const [stopping, setStopping] = React.useState(false);
  // Per-stage preview race guard (N0.4): a dedicated monotonic token per
  // stageId, separate from the main Run path's runTokenRef/running above —
  // reusing those would let the two paths clobber each other.
  const previewTokenRef = React.useRef(new Map<number, number>());
  const [previewLoading, setPreviewLoading] = React.useState<Set<number>>(
    () => new Set(),
  );
  // "Run up to this stage" results. They are not a run, so they never become
  // `lastRun` (whose rows are the Output row's); a full run replaces them, as
  // it re-samples every stage. Local, so they go when the tab does.
  const [previews, setPreviews] = React.useState<Record<number, StagePreviewResult>>({});
  // One AggregationTab serves every collection tab, and `onPatch` writes to
  // whichever tab is active when it is called: a result that lands after a tab
  // change belongs to another tab, so it is dropped rather than written here.
  // `previewGenRef` also moves when a full run lands, so an older preview
  // cannot replace the run's fresher sample.
  const tabKey = [tabId ?? '', connectionId, dbName, collection].join('\u0000');
  const tabKeyRef = useLatest(tabKey);
  const previewGenRef = React.useRef(0);
  const [previewsFor, setPreviewsFor] = React.useState(tabKey);
  if (previewsFor !== tabKey) {
    setPreviewsFor(tabKey);
    setPreviews({});
    setPreviewLoading(new Set());
  }
  const lastRunRef = useLatest(state.lastRun);

  // What each card shows: its own preview, else the full run's sample, each
  // with the signature it was taken under, so an edit upstream marks it stale.
  const sigs = React.useMemo(() => pipelineSigs(stages), [stages]);
  const stageResults = React.useMemo(() => {
    const out: Record<number, StagePreviewResult> = {};
    const run = state.lastRun;
    for (const s of stages) {
      const preview = previews[s.id];
      if (preview) out[s.id] = preview;
      else if (run && (run.stageSamples[s.id] !== undefined || run.stageCounts[s.id] !== undefined)) {
        out[s.id] = { sample: run.stageSamples[s.id], count: run.stageCounts[s.id], sig: run.stageSigs?.[s.id] };
      }
    }
    return out;
  }, [stages, previews, state.lastRun]);
  const staleStageIds = React.useMemo(() => {
    const set = new Set<number>();
    for (const s of stages) {
      const r = stageResults[s.id];
      if (r && r.sig !== sigs.byStage[s.id]) set.add(s.id);
    }
    return set;
  }, [stages, stageResults, sigs]);
  const stageCounts = React.useMemo(() => {
    const out: Record<number, number> = {};
    for (const [id, r] of Object.entries(stageResults)) if (r.count !== undefined) out[Number(id)] = r.count;
    return out;
  }, [stageResults]);

  const validation = React.useMemo(() => validatePipeline(stages), [stages]);
  const blockedReason = runBlockedReason(stages, validation);

  // Below the one-panel width the preview always stacks; above it, the preview
  // header's toggle chooses. Neither the choice nor the column width is tab
  // state, so both reset when the tab remounts.
  const narrow = useMediaQuery(`(max-width: ${ONE_PANEL_BELOW_PX - 0.02}px)`, false, {
    getInitialValueInEffect: false,
  });
  const [stackChoice, setStackChoice] = React.useState(false);
  const stacked = narrow || stackChoice;
  const [stagesWidth, setStagesWidth] = React.useState(STAGES_DEFAULT_PX);
  // A drag's window listeners, removed by mouseup or, mid-drag, by unmount.
  const dividerDragStopRef = React.useRef<(() => void) | null>(null);
  React.useEffect(() => () => dividerDragStopRef.current?.(), []);

  const markDirty = React.useCallback(() => {
    if (!state.dirty) onPatch({ dirty: true });
  }, [state.dirty, onPatch]);

  // docs/adr/0013 — removing a stage is local editor state, not a
  // server-side delete: no confirm, just an Undo toast. Refs so the toast's
  // action (clicked seconds later) reads the pipeline as it is then, not as
  // it was at delete time.
  const stagesRef = useLatest(stages);
  const onPatchRef = useLatest(onPatch);
  const markDirtyRef = useLatest(markDirty);
  // The one outstanding undo toast for this tab, single-level: a second
  // delete reuses the id so it replaces the first toast's Undo target
  // instead of stacking a second one.
  const undoToastIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    return () => {
      if (undoToastIdRef.current) notifications.hide(undoToastIdRef.current);
    };
  }, []);

  // ── Pipeline ops ─────────────────────────────────────────────────────

  const onAddStage = (op: StageOp | string, afterIndex?: number) => {
    const next = addStage({ stages, activeStageId: state.activeStageId }, op, afterIndex);
    onPatch({ stages: next.stages, activeStageId: next.activeStageId });
    markDirty();
  };

  const onRemoveStage = (id: number) => {
    const index = stages.findIndex((s) => s.id === id);
    const removedStage = stages[index];
    const next = removeStageOp({ stages, activeStageId: state.activeStageId }, id);
    onPatch({ stages: next.stages, activeStageId: next.activeStageId });
    markDirty();
    if (!removedStage) return;
    undoToastIdRef.current = notify.info(`Removed stage ${index + 1} (${removedStage.op})`, {
      id: undoToastIdRef.current ?? undefined,
      action: {
        label: 'Undo',
        onClick: () => {
          const restored = restoreStage(
            { stages: stagesRef.current, activeStageId: null },
            removedStage,
            index,
          );
          onPatchRef.current({ stages: restored.stages, activeStageId: restored.activeStageId });
          markDirtyRef.current();
          undoToastIdRef.current = null;
        },
      },
    });
  };

  const onDuplicateStage = (id: number) => {
    const next = duplicateStage({ stages, activeStageId: state.activeStageId }, id);
    onPatch({ stages: next.stages, activeStageId: next.activeStageId });
    markDirty();
  };

  const onMoveUp = (index: number) => {
    if (index === 0) return;
    const next = moveStage({ stages, activeStageId: state.activeStageId }, index, index - 1);
    onPatch({ stages: next.stages });
    markDirty();
  };

  const onMoveDown = (index: number) => {
    if (index === stages.length - 1) return;
    const next = moveStage({ stages, activeStageId: state.activeStageId }, index, index + 1);
    onPatch({ stages: next.stages });
    markDirty();
  };

  const onReorderStage = (from: number, to: number) => {
    const next = moveStage({ stages, activeStageId: state.activeStageId }, from, to);
    onPatch({ stages: next.stages });
    markDirty();
  };

  const onSetBody = (id: number, body: string) => {
    const next = setBodyOp({ stages, activeStageId: state.activeStageId }, id, body);
    onPatch({ stages: next.stages });
    markDirty();
  };

  const onToggleEnabled = (id: number) => {
    const next = toggleEnabledOp({ stages, activeStageId: state.activeStageId }, id);
    onPatch({ stages: next.stages });
    markDirty();
  };

  const onChangeOp = (id: number, op: StageOp | string) => {
    const next = setOpOp({ stages, activeStageId: state.activeStageId }, id, op);
    onPatch({ stages: next.stages });
    markDirty();
  };

  // The selected card is what the preview shows; null is the Output row.
  const onSelectStage = (id: number) => {
    onPatch({ activeStageId: state.activeStageId === id ? null : id });
  };
  const onSelect = (id: number | null) => {
    if (id !== state.activeStageId) onPatch({ activeStageId: id });
  };

  // ── Runner ───────────────────────────────────────────────────────────

  /**
   * X14 §4 — the layer for the paths with no field to blur, the same role
   * `useQueryRunner.run` plays for the Filter Bar (T2). The stage editor
   * repairs on blur, but a stage the user never clicked into has never
   * blurred: `addStage` writes a Shell Syntax template straight into state,
   * and `validatePipeline` now passes it, so Run and Explain light up on a
   * body the main process's `ejsonParse` would refuse. Adding three stages and
   * pressing Run touches no editor at all.
   *
   * Accumulated into one patch rather than one per stage: `patchCollectionState`
   * is not a functional updater, so a second call in the same tick would
   * clobber the first. The returned array is what the caller must run — a
   * patch is async, so re-reading `stages` here would still see the old text.
   */
  const repairStageBodies = React.useCallback((): Stage[] => {
    let next = stages;
    stages.forEach((s, i) => {
      repairOnCommit(s.body, (repaired) => {
        if (next === stages) next = [...stages];
        next[i] = { ...s, body: repaired };
      });
    });
    if (next !== stages) onPatch({ stages: next });
    return next;
  }, [stages, onPatch]);

  const executeRun = React.useCallback(
    async (allowWrite: boolean) => {
      if (!validation.ok) return;
      const runStages = repairStageBodies();
      const runSigs = pipelineSigs(runStages);
      const startedFor = tabKey;
      const token = crypto.randomUUID();
      runTokenRef.current = token;
      runIsWriteRef.current = allowWrite;
      stoppingRef.current = false;
      setStopping(false);
      setRunning(true);
      try {
        const result = await api.agg.run({
          connectionId: connectionId,
          dbName: dbName,
          collection: collection,
          stages: runStages,
          cancelToken: token,
          allowWrite,
        });
        if (runTokenRef.current !== token) return;
        if (tabKeyRef.current === startedFor) {
          const lastRun: AggregationLastRun = {
            rows: result.rows,
            durationMs: result.durationMs,
            ranAt: new Date().toISOString(),
            stageCounts: result.stageCounts,
            stageSamples: result.stageSamples,
            hasMore: result.hasMore,
            stageSigs: runSigs.byStage,
            pipelineSig: runSigs.pipeline,
          };
          onPatch({ lastRun });
          previewGenRef.current += 1;
          setPreviews({});
        }
        // Fire-and-forget, as after a find: the values the leading `$match`
        // stages carried feed the value-suggestion popover. Never blocks or
        // fails the run; main re-filters by op and secret field path.
        const entries = fieldValueEntriesFromStages(runStages);
        if (entries.length > 0) {
          api.recent
            .recordFieldValues({ connectionId, dbName, collection, entries })
            .then(() => invalidateRecentValuesCache(connectionId, dbName, collection))
            .catch((err: unknown) => logFailure('recording field values', err));
        }
        if (stoppingRef.current) {
          notify.info("The write couldn't be stopped, so it ran to completion.");
        }
      } catch (e) {
        if (runTokenRef.current !== token) return;
        if (stoppingRef.current && isIpcError(e) && e.message === 'cancelled') {
          // Killed on the server. Without these details the cancel reached main
          // before the write was sent: nothing ran, and the tab stops quietly,
          // as it does for a cancelled read-only run.
          const stopped = (e.details ?? {}) as { writeStageOp?: string; partialWrite?: boolean };
          if (stopped.partialWrite) {
            notify.warning(
              `Write stopped. ${stopped.writeStageOp} may already have written some documents, and they stay in the target.`,
            );
          } else if (stopped.writeStageOp) {
            notify.info(`Write stopped. The ${stopped.writeStageOp} target was left unchanged.`);
          }
          return;
        }
        if (tabKeyRef.current !== startedFor) return;
        if (isIpcError(e)) {
          const details = (e.details ?? {}) as {
            kind?: string;
            writeStageOp?: string;
            targetCollection?: string;
          };
          if (e.code === 'VALIDATION' && details.kind === 'writeStage') {
            setWriteWarning({
              op: details.writeStageOp ?? '$out',
              target: details.targetCollection,
            });
            return;
          }
        }
        // The failure is this pipeline's; the counts and samples kept beside
        // it are the previous run's, under that run's signatures. Read at
        // settle time, not from the closure: a preview or a run may have
        // landed while this one was in flight.
        const prev = lastRunRef.current;
        onPatch({
          lastRun: {
            rows: prev?.rows ?? [],
            durationMs: 0,
            ranAt: new Date().toISOString(),
            stageCounts: prev?.stageCounts ?? {},
            stageSamples: prev?.stageSamples ?? {},
            stageSigs: prev?.stageSigs,
            pipelineSig: runSigs.pipeline,
            error: isIpcError(e)
              ? { code: e.code, message: e.message, details: e.details }
              : { code: 'INTERNAL', message: String(e) },
          },
        });
      } finally {
        // A confirmed run is one with a `$out`/`$merge` stage, whose target
        // main parses out of the stage body, so the renderer can't name the
        // collection it wrote: drop the connection's samples, even when the
        // run threw part-way through a `$merge`.
        if (allowWrite) {
          invalidateSampleSchemaCache(connectionId);
          // A `$out` / `$merge` can create or replace its target collection.
          invalidateSchemaEnumCache(connectionId);
        }
        if (runTokenRef.current === token) {
          runTokenRef.current = null;
          stoppingRef.current = false;
          setStopping(false);
          setRunning(false);
        }
      }
    },
    [connectionId, dbName, collection, repairStageBodies, validation.ok, onPatch, tabKey, tabKeyRef, lastRunRef],
  );

  // Every way of asking for a run that cannot start — the fake-disabled
  // button, ⌘↵, the palette — hears why, once, in the same words as the tooltip.
  const sayBlocked = (reason: string) => notify.info(reason, { id: 'agg-run-blocked' });

  const onRun = () => {
    if (running) return;
    if (blockedReason) {
      sayBlocked(blockedReason);
      return;
    }
    void executeRun(false);
  };

  const onCancelRun = () => {
    const token = runTokenRef.current;
    if (!token || stoppingRef.current) return;
    void api.agg.cancel({ token }).catch((err) => {
      logFailure('aggregation cancel', err);
      notify.error(getErrorMessage(err, 'The run could not be cancelled.'), { title: 'Cancel failed' });
    });
    if (runIsWriteRef.current) {
      // Keep the token: the run settles as stopped, completed or failed, and
      // executeRun reports which.
      stoppingRef.current = true;
      setStopping(true);
      notify.info('Asking the server to stop the write stage.', {
        title: 'Stopping…',
      });
      return;
    }
    runTokenRef.current = null;
    setRunning(false);
  };

  const onRunToStage = async (stageId: number) => {
    const runStages = repairStageBodies();
    const idx = runStages.findIndex((s) => s.id === stageId);
    if (idx === -1) return;
    const upto = runStages.slice(0, idx + 1).filter((s) => s.enabled);
    if (upto.length === 0) return;
    const sig = pipelineSigs(runStages).byStage[stageId];
    const startedFor = tabKey;
    const gen = previewGenRef.current;
    const token = (previewTokenRef.current.get(stageId) ?? 0) + 1;
    previewTokenRef.current.set(stageId, token);
    // Still the newest call for this stage, on this tab.
    const latest = () => previewTokenRef.current.get(stageId) === token && tabKeyRef.current === startedFor;
    setPreviewLoading((prev) => {
      const next = new Set(prev);
      next.add(stageId);
      return next;
    });
    try {
      const preview = await api.agg.previewUpToStage({
        connectionId: connectionId,
        dbName: dbName,
        collection: collection,
        stages: upto,
        limit: 5,
      });
      // Superseded by a newer call for this stage, by a full run that landed
      // first, or by a tab change: drop it rather than clobber the newer result.
      if (!latest() || previewGenRef.current !== gen) return;
      setPreviews((prev) => ({ ...prev, [stageId]: { sample: preview.sample, count: preview.count, sig } }));
    } catch (e) {
      // Same guard: a superseded failed preview must not toast over a
      // newer success (or a newer failure already surfaced).
      if (!latest() || previewGenRef.current !== gen) return;
      const msg = isIpcError(e) ? e.message : String(e);
      notify.error(msg, { title: 'Preview failed' });
    } finally {
      if (latest()) {
        setPreviewLoading((prev) => {
          const next = new Set(prev);
          next.delete(stageId);
          return next;
        });
      }
    }
  };

  // ── Save / Save as ────────────────────────────────────────────────

  // X14 §4 — the last paths that read `stages` without a blur first.
  // The toolbar buttons blur the editor on mousedown, but the command palette's
  // "Save pipeline" does not, so a saved pipeline could keep Shell Syntax the
  // main process would refuse on the next run. The two modals read `stages`
  // from state, and the patch has landed by the time the user acts in them.
  const onSave = async () => {
    // The Save button is inert while a run is in flight or nothing changed; the
    // palette command reaches this same function, so the rule lives here
    // rather than on the button alone.
    if (running || !state.dirty) return;
    const saveStages = repairStageBodies();
    if (!state.savedId) {
      setSaveOpen(true);
      return;
    }
    try {
      await api.saved.update({
        id: state.savedId,
        patch: {
          payload: { kind: 'aggregation', stages: saveStages },
        },
      });
      onPatch({ dirty: false });
      notify.success(`Saved pipeline “${state.name ?? 'Unnamed'}”`);
    } catch (e) {
      notify.error(getErrorMessage(e, String(e)), { title: 'Save failed' });
    }
  };

  const onSaveAs = () => {
    repairStageBodies();
    setSaveOpen(true);
  };

  // ── Explain ──────────────────────────────────────────────────────

  const onExplain = () => {
    if (running) return;
    if (blockedReason) {
      sayBlocked(blockedReason);
      return;
    }
    setExplainOpen(true);
  };

  const runExplain = React.useCallback(
    (verbosity: ExplainVerbosity, cancelToken: string) =>
      api.agg.explain({
        connectionId,
        dbName,
        collection,
        stages: repairStageBodies(),
        verbosity,
        cancelToken,
      }),
    [connectionId, dbName, collection, repairStageBodies],
  );
  const onCancelExplainToken = React.useCallback((cancelToken: string) => {
    void api.agg.cancel({ token: cancelToken }).catch((err) => logFailure('explain cancel', err));
  }, []);

  // ── Copy ─────────────────────────────────────────────────────────

  // Repairs a copy of the bodies, not the tab's: copying changes nothing.
  // `lang` null copies the bare EJSON array.
  const onCopy = (lang: CodeLang | null) => {
    const result = pipelineJsonForCopy(stages);
    if (!result.ok) {
      notify.error(`Nothing copied — ${result.problem}`);
      return;
    }
    const text = lang ? aggregateCode(lang, { collection, pipelineJson: result.json }) : result.json;
    void copyToClipboard(text, lang ? 'Command copied to the clipboard' : 'Pipeline copied to the clipboard');
  };

  // ── Save as collection ───────────────────────────────────────────

  const onSaveAsCollection = () => {
    // this one writes documents, so an unrepaired body is a failed
    // $out/$merge rather than a cosmetic leak.
    repairStageBodies();
    setSaveAsCollectionOpen(true);
  };

  // The repaired array, not `stages`: the repair patch has not round-tripped yet.
  const onSaveAsView = () => setSaveAsViewStages(repairStageBodies());

  // ── Palette commands + keyboard handlers ───────────────────────
  // The latest-ref pattern keeps the keyboard handler (registered once via
  // useEffect with [] dep array) reading current callback identities. Without
  // it the handler captures stale closures, or — if we widened the dep array
  // — the listener would re-register on every parent render.
  const onRunRef = useLatest(onRun);
  const onCancelRunRef = useLatest(onCancelRun);
  const onSaveRef = useLatest(onSave);
  const onExplainRef = useLatest(onExplain);
  const runningRef = useLatest(running);
  const onRunToStageRef = useLatest(onRunToStage);
  const activeStageIdRef = useLatest(state.activeStageId);
  const previewLoadingRef = useLatest(previewLoading);

  // The palette's Run on a saved pipeline: the Run button's own handler, once.
  const runRequested = React.useSyncExternalStore(
    subscribeTabRequests,
    () => tabId !== undefined && tabRequested('runPipeline', tabId),
  );
  React.useEffect(() => {
    if (!runRequested || tabId === undefined) return;
    consumeTabRequest('runPipeline', tabId);
    onRunRef.current();
  }, [runRequested, tabId, onRunRef]);

  useRegisterCommands(
    [
      {
        id: 'agg.run',
        title: 'Run pipeline',
        group: 'aggregation',
        shortcut: '⌘↵',
        keywords: ['execute', 'aggregate'],
        perform: () => onRunRef.current(),
      },
      {
        id: 'agg.explain',
        title: 'Explain pipeline',
        group: 'aggregation',
        keywords: ['plan', 'analyze'],
        perform: () => onExplainRef.current(),
      },
      {
        id: 'agg.save',
        title: 'Save pipeline',
        group: 'aggregation',
        keywords: ['persist', 'bookmark'],
        perform: () => { void onSaveRef.current(); },
      },
    ],
    [],
  );

  // ── Keyboard shortcuts ──────────────────────────────────────────
  // Register once; the handler reads current callbacks/state via refs so
  // we don't have to choose between re-registering on every render and
  // capturing stale closures. (Same pattern the palette commands above
  // use — single source of truth via useLatest.)
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === 'Enter' && e.shiftKey) {
        // ⇧⌘↵ runs up to the selected stage wherever focus is in the view.
        // The stage editor claims the key itself (and prevents its default),
        // so a press there is already handled.
        const id = activeStageIdRef.current;
        if (e.defaultPrevented || id === null || previewLoadingRef.current.has(id)) return;
        e.preventDefault();
        void onRunToStageRef.current(id);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (runningRef.current) onCancelRunRef.current();
        else onRunRef.current();
      } else if (e.key.toLowerCase() === 'e') {
        e.preventDefault();
        onExplainRef.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeStageIdRef, onCancelRunRef, onExplainRef, onRunRef, onRunToStageRef, previewLoadingRef, runningRef]);

  // ── Derived UI values ───────────────────────────────────────────

  const outputCount =
    state.lastRun?.rows.length !== undefined ? state.lastRun.rows.length : null;
  const outputStale = state.lastRun ? state.lastRun.pipelineSig !== sigs.pipeline : false;
  const hasWriteStage = stages.some((s) => s.enabled && isWriteStage(s.op));
  const activeIndex = stages.findIndex((s) => s.id === state.activeStageId);
  const activeStage = stages[activeIndex];
  const previewStage: PreviewStage | null = activeStage
    ? {
        id: activeStage.id,
        index: activeIndex,
        op: activeStage.op,
        enabled: activeStage.enabled,
        stale: staleStageIds.has(activeStage.id),
        loading: previewLoading.has(activeStage.id),
        sample: stageResults[activeStage.id]?.sample,
        count: stageResults[activeStage.id]?.count,
      }
    : null;
  const mac = isMacRenderer();
  const runShortcut = formatShortcut('⌘↵', mac);
  // Unavailable Run and Explain stay hoverable (aria-disabled, not disabled) so
  // their tooltips can say why; their handlers refuse the click themselves.
  const runBlocked = !running && blockedReason !== null;
  const explainBlocked = running || blockedReason !== null;
  let explainTip = `Explain the pipeline (${formatShortcut('⌘E', mac)})`;
  if (running) explainTip = 'Explain waits for the run to finish';
  else if (blockedReason) explainTip = blockedReason;
  let runTip = `Run the pipeline (${runShortcut})`;
  if (running) runTip = 'Cancel the run';
  else if (blockedReason) runTip = blockedReason;

  const suggestionContext = React.useMemo<SuggestionContext | null>(() => {
    if (!connectionId || !dbName || !collection) return null;
    return {
      connectionId: connectionId,
      dbName: dbName,
      collection: collection,
      recentDocs: state.lastRun?.rows,
    };
  }, [connectionId, dbName, collection, state.lastRun?.rows]);

  const onViewChange = (v: ResultViewMode) => onPatch({ outputView: v });
  const onHeightChange = (px: number) => {
    // instant visual update
    onPatch({ outputHeight: px });
  };
  const onHeightCommit = () => {
    // Patch already debounced — no separate commit channel needed.
  };

  const onStagesDividerDown = (e: React.MouseEvent) => {
    // No text selection while dragging across the editors.
    e.preventDefault();
    const startX = e.clientX;
    const startW = stagesWidth;
    const onMove = (ev: MouseEvent) =>
      setStagesWidth(Math.max(STAGES_MIN_PX, Math.min(stagesMaxPx(), startW + ev.clientX - startX)));
    const stop = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', stop);
      dividerDragStopRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', stop);
    dividerDragStopRef.current = stop;
  };
  const onStagesDividerKey = (e: React.KeyboardEvent) => {
    const next = resizeKeyStep(e.key, 'horizontal', stagesWidth, STAGES_MIN_PX, stagesMaxPx());
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    setStagesWidth(next);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Pipeline bar (below the view header) */}
      <Group
        data-testid="pipeline-bar"
        gap={T.gapSm}
        wrap="nowrap"
        style={{
          height: 44,
          boxSizing: 'border-box',
          padding: '0 14px',
          borderBottom: `1px solid ${T.border}`,
          background: T.surface,
          flexShrink: 0,
        }}
      >
        <Group gap={themeVars.gapXs} wrap="nowrap" style={{ minWidth: 0, flexShrink: 1 }}>
          <span
            title={state.name ?? undefined}
            style={{ minWidth: 0, fontSize: T.fsSm, color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {state.name ?? 'Unsaved pipeline'}
          </span>
          {state.dirty && (
            <Tooltip label="Unsaved changes" withArrow>
              <span
                aria-label="Unsaved changes"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: T.accent,
                  display: 'inline-block',
                  flexShrink: 0,
                }}
              />
            </Tooltip>
          )}
          {hasWriteStage && (
            <span
              style={{
                fontSize: T.fsXs,
                color: T.red,
                background: 'rgba(180,60,60,0.08)',
                padding: '1px 5px',
                borderRadius: T.rx,
                border: `1px solid ${T.border}`,
                whiteSpace: 'nowrap',
              }}
            >
              contains write stage
            </span>
          )}
        </Group>

        <Menu position="bottom-start" shadow="md">
          <Menu.Target>
            <Button size="compact-xs" variant="default" leftSection={I.save} rightSection={I.chevD} style={{ flexShrink: 0 }}>
              Save
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={() => void onSave()} disabled={running || !state.dirty}>
              Save
            </Menu.Item>
            <Menu.Item onClick={onSaveAs} disabled={running}>
              Save as…
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>

        <div style={{ flex: 1 }} />

        <Tooltip label={explainTip} withArrow>
          <Button
            size="compact-xs"
            variant="default"
            leftSection={I.eye}
            {...submittingProps(explainBlocked)}
            onClick={onExplain}
            style={{ flexShrink: 0 }}
          >
            Explain
          </Button>
        </Tooltip>
        <Menu position="bottom-end" shadow="md">
          <Menu.Target>
            {/* The preview has its own "Copy"; the name says which. */}
            <Button
              size="compact-xs"
              variant="default"
              leftSection={I.copy}
              rightSection={I.chevD}
              disabled={!validation.ok}
              aria-label="Copy pipeline"
              style={{ flexShrink: 0 }}
            >
              Copy
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={() => onCopy(null)}>Pipeline (EJSON array)</Menu.Item>
            {CODE_LANGS.map(({ lang, label }) => (
              <Menu.Item key={lang} onClick={() => onCopy(lang)}>
                {label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
        {/* The view's only filled button. */}
        <Tooltip label={runTip} withArrow>
          <Button
            size="compact-xs"
            variant="filled"
            leftSection={running ? I.close : I.play}
            // The glyphs fit the fixed width; "Ctrl+Enter" would not, so off a
            // Mac the shortcut is the tooltip's alone.
            rightSection={
              running || !mac ? undefined : <span aria-hidden="true" style={{ opacity: 0.7 }}>{runShortcut}</span>
            }
            disabled={stopping}
            {...submittingProps(runBlocked)}
            onClick={running ? onCancelRun : onRun}
            // Wide enough for "Stopping…", so Run becoming Cancel moves nothing.
            w={104}
            style={{ flexShrink: 0 }}
          >
            {running ? (stopping ? 'Stopping…' : 'Cancel') : 'Run'}
          </Button>
        </Tooltip>
      </Group>

      <div style={{ flex: 1, display: 'flex', flexDirection: stacked ? 'column' : 'row', overflow: 'hidden', minHeight: 0 }}>
        <section
          aria-label="Stages"
          style={{
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            minWidth: 0,
            ...(stacked ? { flex: 1 } : { width: stagesWidth, flexShrink: 0 }),
          }}
        >
          <StageAccordion
            stages={stages}
            activeId={state.activeStageId}
            collection={collection}
            sourceCount={sourceCount}
            outputCount={outputCount}
            outputStale={outputStale}
            stageCounts={stageCounts}
            staleStageIds={staleStageIds}
            previewLoading={previewLoading}
            darkMode={darkMode}
            suggestionContext={suggestionContext}
            onAdd={onAddStage}
            onToggleActive={onSelectStage}
            onSelect={onSelect}
            onToggleEnabled={onToggleEnabled}
            onChangeOp={onChangeOp}
            onBodyChange={onSetBody}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            onReorder={onReorderStage}
            onRemove={onRemoveStage}
            onDuplicate={onDuplicateStage}
            onRunToStage={onRunToStage}
          />
        </section>

        {!stacked && (
          <div
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label="Resize stages column"
            aria-valuenow={stagesWidth}
            aria-valuemin={STAGES_MIN_PX}
            aria-valuemax={stagesMaxPx()}
            className="resize-separator"
            onMouseDown={onStagesDividerDown}
            onKeyDown={onStagesDividerKey}
            style={{ width: 5, flexShrink: 0, cursor: 'ew-resize', background: T.border }}
          />
        )}

        <OutputPanel
          stacked={stacked}
          onToggleStacked={narrow ? undefined : () => setStackChoice((v) => !v)}
          height={state.outputHeight}
          view={state.outputView}
          lastRun={state.lastRun}
          outputStale={outputStale}
          running={running}
          pipelineName={state.name ?? null}
          stage={previewStage}
          onRunToStage={(id) => void onRunToStage(id)}
          onHeightChange={onHeightChange}
          onHeightCommit={onHeightCommit}
          onViewChange={onViewChange}
          onSaveAsCollection={onSaveAsCollection}
          onSaveAsView={onSaveAsView}
          onRun={onRun}
          runBlockedReason={blockedReason}
        />
      </div>

      {writeWarning && (
        <WriteStageConfirm
          op={writeWarning.op}
          target={writeWarning.target}
          onCancel={() => setWriteWarning(null)}
          onProceed={() => {
            setWriteWarning(null);
            void executeRun(true);
          }}
        />
      )}

      {explainOpen && (
        <ExplainDrawer
          onClose={() => setExplainOpen(false)}
          runExplain={runExplain}
          onCancelToken={onCancelExplainToken}
        />
      )}

      {saveOpen && (
        <SavePipelineModal
          connectionId={connectionId}
          dbName={dbName}
          collection={collection}
          stages={stages}
          initialName={state.name}
          onClose={() => setSaveOpen(false)}
          onSaved={(saved) => {
            onPatch({ savedId: saved.id, name: saved.name, dirty: false });
            notify.success(`Saved pipeline “${saved.name}”`);
          }}
        />
      )}

      {saveAsCollectionOpen && (
        <SaveAsCollectionModal
          connectionId={connectionId}
          dbName={dbName}
          collection={collection}
          stages={stages}
          onClose={() => setSaveAsCollectionOpen(false)}
          onWritten={(info) => {
            // The target may be in another database than the source.
            notifyCollectionChanged({ connectionId, dbName: info.dbName, collection: info.collection });
            notify.success(saveResultMessage(info));
          }}
        />
      )}

      {saveAsViewStages && (
        <SaveAsViewModal
          connectionId={connectionId}
          dbName={dbName}
          collection={collection}
          stages={saveAsViewStages}
          onClose={() => setSaveAsViewStages(null)}
          onCreated={(name) => {
            notifyCollectionChanged({ connectionId, dbName, collection: name });
            notify.success(`Created view “${name}”`);
          }}
        />
      )}
    </div>
  );
}

// ─── Write-stage confirm dialog ─────────────────────────────────────────

export function WriteStageConfirm({
  op,
  target,
  onCancel,
  onProceed,
}: {
  op: string;
  target?: string;
  onCancel: () => void;
  onProceed: () => void;
}) {
  const T = themeVars;
  // Dismiss paths only — Proceed is a handoff into the run.
  const cancel = useDialogFocusReturn(onCancel);
  return (
    // X15 T6 — no `closeOnClickOutside={false}` here on purpose. This dialog
    // holds no typed input, so a backdrop click loses nothing and the Mantine
    // default is the right convenience. That also makes the ticket's
    // `closeOnClickOutside` mutation *equivalent* for this overlay — there is
    // no test to write that could tell the two builds apart, and writing one
    // that pretends otherwise would be theatre.
    <Modal
      opened
      onClose={cancel}
      title="Confirm write"
      size={440}
      centered
    >
      <div>
        <div style={{ fontSize: T.fsSm, color: T.textMuted, marginBottom: 16 }}>
          Running this pipeline will write to collection{' '}
          <code style={{ color: T.text }}>{target ?? '(unknown)'}</code> via{' '}
          <code style={{ color: T.text }}>{op}</code>. Proceed?
        </div>
        <div style={{ display: 'flex', gap: T.gapSm, justifyContent: 'flex-end' }}>
          <Button variant="default" size="xs" c={T.textMuted} onClick={cancel}>
            Cancel
          </Button>
          <Button color="red" size="xs" onClick={onProceed}>
            Proceed
          </Button>
        </div>
      </div>
    </Modal>
  );
}
