import React from 'react';
import { themeVars } from '../../../theme/themeVars';
import { I } from '../../../icons';
import type { AggregationLastRun, LastRunError, ResultViewMode } from '@shared/types';
import { PaneState } from '../../../components/PaneState';
import { ActionIcon, Button, Group, Menu, SegmentedControl, Tooltip, VisuallyHidden } from '@mantine/core';
import { ejsonStringifyReadable } from '../../../utils/ejson';
import { copyToClipboard } from '../../../utils/clipboard';
import { api, getErrorMessage } from '../../../api/atelier';
import { notify } from '../../../theme/notifications';
import { resizeKeyStep } from '../resizeKeyStep';
import { useElementWidth } from '../../../hooks/useElementWidth';
import { formatShortcut } from '../../../commands/shortcutLabel';
import { isMacRenderer } from '../../../utils/platform';

/** The stage card selected in the stages column, when one is. */
export interface PreviewStage {
  id: number;
  index: number;
  op: string;
  enabled: boolean;
  stale: boolean;
  loading: boolean;
}

interface OutputPanelProps {
  /** Under the stages (with the height handle) rather than beside them. */
  stacked: boolean;
  /** The preview header's layout toggle; absent while the window is too narrow to choose. */
  onToggleStacked?: () => void;
  height: number;
  view: ResultViewMode;
  lastRun: AggregationLastRun | undefined;
  /** True when a stage was edited since the last full run. */
  outputStale: boolean;
  running: boolean;
  pipelineName: string | null;
  /** The selected stage, or null for the whole pipeline's output. */
  stage: PreviewStage | null;
  onRunToStage: (id: number) => void;
  onHeightChange: (px: number) => void;
  onHeightCommit: () => void;
  onViewChange: (v: ResultViewMode) => void;
  onSaveAsCollection: () => void;
  /** Saves the pipeline itself, so it needs no output rows. */
  onSaveAsView: () => void;
  /** The pipeline bar's Run, offered again by the empty and failed states. */
  onRun: () => void;
  /** Why Run cannot start (`runBlockedReason`), or null when it can. */
  runBlockedReason: string | null;
}

const DEFAULT_HEIGHT = 260;
const MIN_HEIGHT = 120;
/** Below this header width the count goes and Export results is its icon alone. */
const COMPACT_BAR_PX = 420;
const VIEWS: ResultViewMode[] = ['Table', 'Tree', 'JSON'];

function maxHeight(): number {
  return Math.floor(window.innerHeight * 0.7);
}

function clampHeight(px: number): number {
  return Math.max(MIN_HEIGHT, Math.min(maxHeight(), px));
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

/** The whole error, server details included, since nothing else shows them. */
function errorText(err: LastRunError): string {
  const head = `${err.code}: ${err.message}`;
  return err.details === undefined ? head : `${head}\n\n${JSON.stringify(err.details, null, 2)}`;
}

/**
 * The JSON view, Copy and Download share this, and all three are read by a
 * person. `ejsonStringifyReadable` unwraps only sentinels that re-parse to
 * identical BSON, so the copied text still means exactly what the server
 * returned; an int64 stays wrapped rather than arriving rounded.
 */
function safeStringifyArray(rows: unknown[]): string {
  try {
    return ejsonStringifyReadable(rows, 2);
  } catch {
    return JSON.stringify(rows, null, 2);
  }
}

export function OutputPanel({
  stacked,
  onToggleStacked,
  height,
  view,
  lastRun,
  outputStale,
  running,
  pipelineName,
  stage,
  onRunToStage,
  onHeightChange,
  onHeightCommit,
  onViewChange,
  onSaveAsCollection,
  onSaveAsView,
  onRun,
  runBlockedReason,
}: OutputPanelProps) {
  const T = themeVars;
  const dragRef = React.useRef<{ startY: number; startH: number } | null>(null);

  // `maxHeight()` reads `window.innerHeight` fresh on every call, so the
  // clamp itself is always correct at interaction time (drag/keyboard both
  // call it live). Without this, only the *displayed* `aria-valuemax` would
  // go stale — stuck at whatever it was on the last render — if the window
  // is resized while the separator holds focus and nothing else re-renders.
  const [ariaMaxHeight, setAriaMaxHeight] = React.useState(maxHeight);
  React.useEffect(() => {
    const onResize = () => setAriaMaxHeight(maxHeight());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { startY: e.clientY, startH: height };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - ev.clientY;
      onHeightChange(clampHeight(dragRef.current.startH + delta));
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (d) onHeightCommit();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onDoubleClick = () => {
    onHeightChange(DEFAULT_HEIGHT);
    onHeightCommit();
  };

  // Keyboard equivalent of both the drag and the double-click reset above.
  // Arrow/Home/End resize by the same shared step every separator in the app
  // uses; Enter is the reset, since double-click has no other keyboard analog.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onDoubleClick();
      return;
    }
    const next = resizeKeyStep(e.key, 'vertical', height, MIN_HEIGHT, maxHeight());
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    onHeightChange(next);
    onHeightCommit();
  };

  // The full run's rows: what Export results exports, whatever is selected.
  const rows = lastRun?.rows ?? [];
  const err = lastRun?.error;
  const noRows = rows.length === 0;
  const [barRef, barWidth] = useElementWidth<HTMLDivElement>();
  const compact = barWidth !== null && barWidth < COMPACT_BAR_PX;
  const sample = stage ? lastRun?.stageSamples[stage.id] : undefined;
  const stageCount = stage ? lastRun?.stageCounts[stage.id] : undefined;
  const runUpToShortcut = formatShortcut('⇧⌘↵', isMacRenderer());

  const runButton = (label: string) => (
    <Button variant="default" size="xs" disabled={running || runBlockedReason !== null} onClick={onRun}>
      {label}
    </Button>
  );
  const runUpToButton = (s: PreviewStage) => (
    <Button
      variant="default"
      size="xs"
      disabled={s.loading}
      onClick={() => onRunToStage(s.id)}
      rightSection={<span aria-hidden="true" style={{ color: T.textGhost }}>{runUpToShortcut}</span>}
    >
      Run up to this stage
    </Button>
  );

  // Always mounted: a live region only announces text that changes after it
  // exists, so start and finish of a run are both heard.
  let statusText = '';
  if (running) statusText = 'Running…';
  else if (err) statusText = 'Run failed';
  else if (lastRun) statusText = `Finished: ${rows.length} documents`;

  const copyAll = () => {
    if (rows.length === 0) return;
    void copyToClipboard(safeStringifyArray(rows), 'Output copied to the clipboard.');
  };

  const download = async () => {
    if (rows.length === 0) return;
    const content = safeStringifyArray(rows);
    const defaultName = `${pipelineName ?? 'pipeline'}-output.json`;
    // A cancelled save panel resolves `{ path: null }`; only a real write
    // failure throws, and the user has to hear about that one.
    try {
      await api.app.saveFile({ defaultName, content });
    } catch (err) {
      notify.error(`Could not save the output: ${getErrorMessage(err, 'the file could not be written')}`);
    }
  };

  // ── What the header says about what is shown ──
  let heading: string;
  let meta = '';
  let stale: boolean;
  if (stage) {
    heading = `Stage ${stage.index + 1} · ${stage.op}`;
    if (typeof stageCount === 'number') meta = `${fmt(stageCount)} docs`;
    stale = stage.stale && sample !== undefined;
  } else {
    heading = 'Output';
    if (lastRun) meta = `${rows.length} docs · ${lastRun.durationMs} ms`;
    stale = outputStale;
  }

  // ── The body: a pane state, or rows ──
  let body: React.ReactNode;
  let shownRows: unknown[] | null = null;
  // The empty pipeline's reason is the pane's own line; otherwise a strip states it.
  const reasonIsPane = !stage && !lastRun && runBlockedReason !== null;
  if (stage) {
    if (!stage.enabled) {
      body = <PaneState title={`Stage ${stage.index + 1} is turned off`} detail="Turn it on to preview its output." />;
    } else if (sample === undefined) {
      body = stage.loading ? (
        <PaneState title={`Running up to stage ${stage.index + 1}…`} />
      ) : (
        <PaneState title="This stage has not been run yet" actions={runUpToButton(stage)} />
      );
    } else if (sample.length === 0) {
      body = <PaneState title={`No documents reach stage ${stage.index + 1}`} actions={runUpToButton(stage)} />;
    } else {
      shownRows = sample;
    }
  } else if (err) {
    body = <PaneState tone="error" title="The pipeline failed" detail={errorText(err)} actions={runButton('Run again')} />;
  } else if (!lastRun) {
    // Not "Run": that name belongs to the pipeline bar's button.
    body = reasonIsPane ? (
      <PaneState title={runBlockedReason} />
    ) : (
      <PaneState title="Run the pipeline to see output" actions={runButton('Run pipeline')} />
    );
  } else if (rows.length === 0) {
    body = (
      <PaneState
        title="The pipeline returned no documents"
        detail="Select a stage to see where the documents stop."
        actions={runButton('Run again')}
      />
    );
  } else {
    shownRows = rows;
  }
  if (shownRows) {
    if (view === 'JSON') body = <JsonOutput rows={shownRows} />;
    else if (view === 'Table') body = <TableOutput rows={shownRows} />;
    else body = <TreeOutput rows={shownRows} />;
  }

  return (
    <section
      aria-label="Preview"
      style={{
        ...(stacked
          ? { height, flexShrink: 0, borderTop: `1px solid ${T.border}` }
          : { flex: 1, minWidth: 0 }),
        display: 'flex',
        flexDirection: 'column',
        background: T.surface,
      }}
    >
      {stacked && (
        <div
          onMouseDown={onMouseDown}
          onDoubleClick={onDoubleClick}
          onKeyDown={onKeyDown}
          tabIndex={0}
          role="separator"
          className="resize-separator"
          aria-label="Resize output panel"
          aria-valuenow={height}
          aria-valuemin={MIN_HEIGHT}
          aria-valuemax={ariaMaxHeight}
          style={{
            height: 6,
            cursor: 'ns-resize',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: T.surfaceRaised,
            borderBottom: `1px solid ${T.border}`,
          }}
        >
          <div style={{ width: 32, height: 3, borderRadius: 2, background: T.border }} />
        </div>
      )}

      <Group
        ref={barRef}
        data-testid="output-bar"
        gap={themeVars.gapSm}
        wrap="nowrap"
        style={{
          minHeight: 42,
          boxSizing: 'border-box',
          padding: '0 14px',
          borderBottom: `1px solid ${T.border}`,
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}
      >
        <SegmentedControl
          size="xs"
          value={view}
          onChange={(v) => onViewChange(v as ResultViewMode)}
          data={VIEWS.map((m) => ({ label: m, value: m }))}
          aria-label="Preview view"
          style={{ flexShrink: 0 }}
        />
        {/* Holds the gap whatever is shown: a long heading truncates here before any control moves. */}
        <span
          data-testid="preview-heading"
          title={[heading, meta].filter(Boolean).join(' · ')}
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontSize: T.fsSm,
            color: T.textMuted,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <span style={{ color: T.text, fontWeight: 600 }}>{heading}</span>
          {!compact && meta && ` · ${meta}`}
          {stale && <span title="Stage edited after last run"> · ⚠ stale</span>}
        </span>
        {stage && sample !== undefined && stage.enabled && (
          <Tooltip label={`Run up to this stage again (${runUpToShortcut})`} withArrow>
            <ActionIcon
              variant="default"
              size={26}
              onClick={() => onRunToStage(stage.id)}
              disabled={stage.loading}
              aria-label="Refresh preview"
              style={{ flexShrink: 0 }}
            >
              {I.sync}
            </ActionIcon>
          </Tooltip>
        )}
        {onToggleStacked && (
          <Tooltip label={stacked ? 'Show the preview beside the stages' : 'Show the preview under the stages'} withArrow>
            <ActionIcon
              variant="default"
              size={26}
              onClick={onToggleStacked}
              aria-label="Stack preview under stages"
              aria-pressed={stacked}
              style={{ flexShrink: 0 }}
            >
              {stacked ? I.chevR : I.chevD}
            </ActionIcon>
          </Tooltip>
        )}
        <Menu position="bottom-end" shadow="md">
          <Menu.Target>
            {compact ? (
              <ActionIcon variant="default" size={26} aria-label="Export results" style={{ flexShrink: 0 }}>
                {I.download}
              </ActionIcon>
            ) : (
              <Button
                size="compact-xs"
                variant="default"
                leftSection={I.download}
                rightSection={I.chevD}
                style={{ flexShrink: 0 }}
              >
                Export results
              </Button>
            )}
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={I.copy} onClick={copyAll} disabled={noRows}>
              Copy
            </Menu.Item>
            <Menu.Item leftSection={I.download} onClick={() => void download()} disabled={noRows}>
              Download…
            </Menu.Item>
            <Menu.Item leftSection={I.save} onClick={onSaveAsCollection} disabled={running || noRows}>
              Save to collection…
            </Menu.Item>
            <Menu.Item leftSection={I.view} onClick={onSaveAsView} disabled={running}>
              Create view…
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>

      {runBlockedReason !== null && !reasonIsPane && (
        <div
          data-testid="run-blocked-reason"
          style={{
            flexShrink: 0,
            padding: '4px 14px',
            fontSize: T.fsXs,
            color: T.textMuted,
            borderBottom: `1px solid ${T.border}`,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={runBlockedReason}
        >
          {runBlockedReason}
        </div>
      )}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '8px 14px',
          // A pane state fills the pane in the app's text face; rows keep the code face.
          ...(shownRows
            ? { fontFamily: 'JetBrains Mono, monospace', fontSize: T.fsSm }
            : { display: 'flex', flexDirection: 'column' }),
          position: 'relative',
        }}
      >
        <VisuallyHidden role="status" aria-live="polite">
          {statusText}
        </VisuallyHidden>
        {running && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 4,
              right: 14,
              fontSize: T.fsXs,
              color: T.textMuted,
              background: T.surface,
              padding: '1px 6px',
              borderRadius: T.rx,
            }}
          >
            Running…
          </div>
        )}
        {body}
      </div>
    </section>
  );
}

// ─── Lightweight local views ──────────────────────────────────────────────

function JsonOutput({ rows }: { rows: unknown[] }) {
  const T = themeVars;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: T.gapSm }}>
      {rows.map((doc, i) => (
        <div
          key={i}
          style={{
            padding: '7px 10px',
            background: T.surfaceRaised,
            border: `1px solid ${T.border}`,
            borderRadius: T.rs,
          }}
        >
          <pre
            style={{
              margin: 0,
              fontSize: T.fsXs,
              color: T.text,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {tryStringify(doc, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}

function TreeOutput({ rows }: { rows: unknown[] }) {
  const T = themeVars;
  return (
    <div>
      {rows.map((doc, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            gap: T.gapSm,
            padding: '4px 0',
            borderBottom: `1px solid ${T.border}`,
            alignItems: 'flex-start',
          }}
        >
          <span style={{ color: T.textGhost }}>{I.doc}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: `${themeVars.gapXs} ${themeVars.gapLg}`, flex: 1 }}>
            {doc && typeof doc === 'object'
              ? Object.entries(doc as Record<string, unknown>).map(([k, v]) => (
                  <span key={k} style={{ fontSize: T.fsXs, color: T.textMuted }}>
                    <span style={{ color: T.textMuted }}>{k}: </span>
                    <span style={{ color: typeof v === 'number' ? '#5B8FCA' : T.text }}>
                      {tryStringify(v)}
                    </span>
                  </span>
                ))
              : (
                <span style={{ fontSize: T.fsXs, color: T.text }}>{tryStringify(doc)}</span>
              )}
          </div>
        </div>
      ))}
    </div>
  );
}

function flattenKeys(doc: unknown, prefix = ''): string[] {
  if (!doc || typeof doc !== 'object') return [];
  const keys: string[] = [];
  for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (k === '_id' && v && typeof v === 'object' && !isBsonSentinel(v)) {
      keys.push(...flattenKeys(v, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

function isBsonSentinel(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  return Object.keys(v as object).some((k) => k.startsWith('$'));
}

function getByPath(doc: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = doc;
  for (const p of parts) {
    if (cur && typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

function TableOutput({ rows }: { rows: unknown[] }) {
  const T = themeVars;
  const columns = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of rows.slice(0, 50)) {
      for (const k of flattenKeys(r)) set.add(k);
    }
    return Array.from(set);
  }, [rows]);

  return (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        <tr style={{ background: T.surfaceRaised, borderBottom: `1px solid ${T.border}` }}>
          {columns.map((h) => (
            <th
              key={h}
              style={{
                padding: '4px 8px',
                textAlign: 'left',
                fontSize: T.fsXs,
                fontWeight: 600,
                color: T.textMuted,
                whiteSpace: 'nowrap',
              }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((doc, i) => (
          <tr key={i} style={{ borderBottom: `1px solid ${T.border}` }}>
            {columns.map((h) => {
              const v = getByPath(doc, h);
              return (
                <td key={h} style={{ padding: '4px 8px', color: T.text }}>
                  {v === undefined ? '' : typeof v === 'number' ? (
                    <span style={{ color: '#5B8FCA' }}>{v}</span>
                  ) : (
                    tryStringify(v)
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * a single value or document, for the table and tree cells. Same
 * renderer as the Documents views now, which is the point: `n` read `102` in
 * one tab and `{"$numberInt":"102"}` in the other.
 */
function tryStringify(v: unknown, indent?: number): string {
  try {
    return ejsonStringifyReadable(v, indent);
  } catch {
    try {
      return JSON.stringify(v, null, indent);
    } catch {
      return String(v);
    }
  }
}
