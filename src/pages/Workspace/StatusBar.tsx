import React from 'react';
import { createPortal } from 'react-dom';
import { ActionIcon, Badge, Button, Group, Select, Tooltip, UnstyledButton } from '@mantine/core';
import { themeVars } from '../../theme/themeVars';
import { I } from '../../icons';
import { useElementWidth } from '../../hooks/useElementWidth';
import type { ConnectionSummary } from '@shared/types';
import { api } from '../../api/atelier';
import { notify } from '../../theme/notifications';
import { STATUS_PRESENTATION } from '../../features/connections/connectionStatus';
import { DEFAULT_PAGE_SIZE_PREF_KEY, PAGE_SIZE_OPTIONS } from '../../state/workspaceTabs';
import { useCollectionWorkspace } from './context';
import { ExplainDrawer } from './Aggregation/ExplainDrawer';
import { useFindExplain } from './useFindExplain';
import { summarizeExplain } from '../../utils/explainSummary';
import { compileFindOptions, findProblem } from './builder';
import { LIMIT_EXPLANATION, limitChipText } from './queryCaps';
import { statusCountLayout } from './toolbarLayout';
import { setStatusBarSlot, useStatusBarSlot } from './statusBarSlot';

const PAGE_SIZE_DATA = PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: String(n) }));

/**
 * The 24px band along the bottom of the window (W01 §14.6). The left part is
 * the Focused Tab's Connection; the rest is a slot the Documents view fills
 * with its count and pager (`ResultStatus`), so a script tab or another view
 * leaves it empty without being told to.
 */
export function StatusBar({ connection }: { connection: ConnectionSummary | null }) {
  const T = themeVars;
  return (
    <div
      data-testid="status-bar"
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: T.gapMd,
        padding: '0 10px',
        boxSizing: 'border-box',
        borderTop: `1px solid ${T.border}`,
        background: T.surface,
        fontSize: T.fsXs,
        color: T.textMuted,
        whiteSpace: 'nowrap',
      }}
    >
      {connection && <ConnectionStatus connection={connection} />}
      <div ref={setStatusBarSlot} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: T.gapMd }} />
    </div>
  );
}

function ConnectionStatus({ connection }: { connection: ConnectionSummary }) {
  const T = themeVars;
  const presentation = STATUS_PRESENTATION[connection.status];
  const parts = [connection.name, connection.host];
  if (connection.status === 'connected' && connection.serverVersion) parts.push(`v${connection.serverVersion}`);
  return (
    <span
      data-testid="status-connection"
      style={{ display: 'inline-flex', alignItems: 'center', gap: T.gapXs, minWidth: 0, flex: '0 1 auto', overflow: 'hidden' }}
    >
      <span
        role="img"
        aria-label={presentation.spoken}
        style={{ width: 7, height: 7, borderRadius: '50%', background: presentation.band, flexShrink: 0 }}
      />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{parts.join(' · ')}</span>
      {connection.readOnly && (
        <Badge size="xs" variant="outline" color="gray" style={{ flexShrink: 0 }}>
          Read-only
        </Badge>
      )}
    </span>
  );
}

/**
 * The Documents view's half of the status bar: the last run's count and plan
 * badge in the middle, the pager at the right (W07 §7). Rendered by the
 * result bar and portalled, so it reads the same tab context.
 */
export function ResultStatus() {
  const slot = useStatusBarSlot();
  return slot ? createPortal(<ResultStatusContent />, slot) : null;
}

function ResultStatusContent() {
  const T = themeVars;
  const { state, actions, meta } = useCollectionWorkspace();
  const lastRun = state.lastRun;
  const page = state.page;
  const pageSize = state.pageSize;
  const docCount = lastRun?.documents.length ?? null;
  const duration = lastRun?.durationMs ?? null;
  const totalCount = state.totalCount;
  const hasMore = state.lastRunHasMore;
  const isLoading = meta.isLoading;
  const isReadOnly = !!meta.isReadOnly;
  const [planOpen, setPlanOpen] = React.useState(false);
  // The plan badge's drawer re-fetches only when the verbosity changes, and
  // then asks about the committed filter text, like any other read surface.
  const { runExplain, onCreateIndex } = useFindExplain(() => state.queryRaw);

  // X14 §5 — a refused filter never re-runs, so `lastRun` keeps describing the
  // query the user has since edited away. `findProblem` is the Run button's own
  // rule, so the count is marked stale exactly while Run is refusing to make it
  // current again.
  const runProblem = findProblem(state);
  const isStale = runProblem !== null;
  // Before the first run, offer the same Run gate QueryBar's button uses.
  // Read-only consumers have no working `run`, so they keep the plain label.
  const canRunHere = !isReadOnly && !isLoading && runProblem === null;

  // What the last run's query did: the index it used, or a collection scan.
  // An empty filter matches every document, so a scan is not a missing index.
  const planSummary = summarizeExplain(lastRun?.plan);
  const planLabel = planSummary?.collscan
    ? planSummary.emptyFilter
      ? null
      : 'no index'
    : planSummary?.usesIndex
      ? (planSummary.indexName ?? 'index')
      : null;
  const [countRef, countWidth] = useElementWidth<HTMLDivElement>();
  const layout = statusCountLayout(countWidth);
  // A stale count is the total and "· not current", at any width.
  const countForm = isStale ? 'total' : layout.count;

  // The limit that actually applies (a coerced one shows as what it runs as).
  const limitChip = limitChipText(compileFindOptions(state.builder).limit);

  const start = docCount !== null ? page * pageSize + 1 : null;
  const end = docCount !== null ? page * pageSize + docCount : null;
  const totalPages = totalCount !== undefined ? Math.max(1, Math.ceil(totalCount / pageSize)) : null;

  const canPrev = page > 0 && !isLoading;
  // Prefer totalPages when it's known: the find's `hasMore` is `docs.length ===
  // limit`, a false positive on a last page that happens to be exactly full.
  const canNext = !isLoading && (totalPages !== null ? page < totalPages - 1 : !!hasMore);
  const canLast = totalPages !== null && page < totalPages - 1 && !isLoading;
  const onLastPage = totalPages !== null ? page >= totalPages - 1 : !hasMore;
  const busy = 'Wait for the query to finish';
  const backReason = isLoading ? busy : 'Already on the first page';
  const nextReason = isLoading ? busy : 'No more results';
  const lastReason = isLoading ? busy : onLastPage ? 'No more results' : 'The total is still being counted';

  const totalLabel = `${(totalCount ?? docCount ?? 0).toLocaleString()}${hasMore && totalCount === undefined ? '+' : ''}`;
  const rangeLabel =
    start !== null && end !== null && docCount !== 0 ? `${start.toLocaleString()}–${end.toLocaleString()}` : null;
  // The merged forms drop words, never facts: the rest stays one hover away.
  const countDetail = `${totalLabel} results${duration !== null ? ` · ${duration} ms` : ''}${
    rangeLabel ? ` · showing ${rangeLabel}` : ''
  }`;

  // Patch + re-run with the same override so `run` doesn't close over a stale `page`.
  const goToPage = (p: number) => {
    const patch = { page: p };
    actions.patch(patch);
    actions.run(patch);
  };

  // Convert the Select's string once at this boundary, so a string never
  // reaches `effectivePageLimit` / `FindInput.limit`.
  const handlePageSizeChange = (value: string | null) => {
    if (!value) return;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0 || n === pageSize) return;
    const patch = { pageSize: n, page: 0 };
    actions.patch(patch);
    actions.run(patch);
    void api.prefs.set(DEFAULT_PAGE_SIZE_PREF_KEY, n).catch(() => {
      // The tab's own pageSize already persisted via patch; only the sticky
      // default for new tabs is lost, which the user is told.
      notify.error('Could not save the rows-per-page default', { id: 'pref-save-failed' });
    });
  };

  return (
    <>
      {/* The one flexible part: everything that depends on the query truncates
          here, so the pager never moves. */}
      <div
        ref={countRef}
        data-testid="result-count-slot"
        style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: T.gapXs, overflow: 'hidden' }}
      >
        {lastRun?.error && docCount === 0 ? (
          <span data-testid="result-count-failed" style={{ color: T.redText, fontWeight: 600 }}>
            Query failed
          </span>
        ) : docCount !== null ? (
          <>
            <span
              title={countForm === 'full' ? undefined : countDetail}
              style={{ flex: '0 0 auto', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {countForm === 'full' && (
                <>
                  <CountFigure stale={isStale}>{totalLabel}</CountFigure> results
                  {duration !== null && (
                    <>
                      {' · '}
                      <CountFigure>{duration}</CountFigure> ms
                    </>
                  )}
                  {/* An empty page has no range: "1–0" reads as a bug. */}
                  {' · '}
                  <span>{rangeLabel ? `showing ${rangeLabel}` : 'nothing to show'}</span>
                </>
              )}
              {countForm === 'range' &&
                (rangeLabel ? (
                  <>
                    <CountFigure stale={isStale}>{rangeLabel}</CountFigure> of {totalLabel}
                  </>
                ) : (
                  <>
                    <CountFigure stale={isStale}>{totalLabel}</CountFigure> results
                  </>
                ))}
              {/* Short of room, a stale count spends it on "not current", not the noun. */}
              {countForm === 'total' && (
                <>
                  <CountFigure stale={isStale}>{totalLabel}</CountFigure>
                  {!isStale && ' results'}
                </>
              )}
            </span>
            {/* Plain text, not a live region: the QueryBar's `role="alert"`
                already announces the reason. */}
            {isStale && (
              <span
                data-testid="result-count-stale"
                title="The query above has changed and cannot run as written"
                style={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', color: T.warn, fontWeight: 600 }}
              >
                · not current
              </span>
            )}
            {limitChip !== null && (
              <>
                <span style={{ flexShrink: 0 }}>·</span>
                <span
                  data-testid="result-limit-cap"
                  title={LIMIT_EXPLANATION}
                  style={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {limitChip}
                </span>
              </>
            )}
          </>
        ) : isReadOnly ? (
          <span>No run yet</span>
        ) : (
          <Tooltip label={runProblem ?? 'Run (Cmd+Enter)'} withArrow>
            <Button
              variant="subtle"
              color="gray"
              size="compact-xs"
              leftSection={I.play}
              onClick={() => canRunHere && actions.run()}
              disabled={!canRunHere}
              data-testid="resultbar-run-cta"
            >
              Run (Cmd+Enter)
            </Button>
          </Tooltip>
        )}

        {planLabel !== null && layout.planBadge && (
          <UnstyledButton
            type="button"
            data-testid="plan-badge"
            aria-label={`Query plan: ${planLabel}${isStale ? ' (not current)' : ''}`}
            title={planLabel}
            onClick={() => setPlanOpen(true)}
            style={{
              fontSize: T.fsXs,
              padding: '0 6px',
              lineHeight: '16px',
              flex: '0 1 auto',
              minWidth: 44,
              maxWidth: 140,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              borderRadius: T.rs,
              ...(isStale
                ? { background: T.surface, color: T.textGhost, border: `1px solid ${T.border}` }
                : planSummary?.collscan
                  ? { background: T.warnSoft, color: T.warnText, border: `1px solid ${T.warnBorder}` }
                  : { background: T.surfaceRaised, color: T.text, border: `1px solid ${T.border}` }),
            }}
          >
            {planLabel}
          </UnstyledButton>
        )}
      </div>

      {/* Pager — first · prev · P/T · next · last · rows per page */}
      <Group gap={0} wrap="nowrap" style={{ flexShrink: 0 }}>
        <PagerButton label="First page" reason={backReason} enabled={canPrev} onClick={() => goToPage(0)} icon={I.chevLL} />
        <PagerButton label="Previous page" reason={backReason} enabled={canPrev} onClick={() => goToPage(page - 1)} icon={I.chevL} />
        {/* Room for "2400 / 2400", the widest this page count reaches, so Next and Last hold still. */}
        <span
          data-testid="page-label"
          style={{
            minWidth: `max(48px, ${2 * String(totalPages ?? '').length + 3}ch)`,
            textAlign: 'center',
            color: T.text,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {page + 1}
          {totalPages !== null ? ` / ${totalPages}` : ''}
        </span>
        <PagerButton label="Next page" reason={nextReason} enabled={canNext} onClick={() => goToPage(page + 1)} icon={I.chevR} />
        <PagerButton
          label="Last page"
          reason={lastReason}
          enabled={canLast}
          onClick={() => totalPages !== null && goToPage(totalPages - 1)}
          icon={I.chevRR}
        />
        {/* `keepMounted: false` unmounts the option list while closed, so its
            numeric labels never collide with text locators elsewhere. */}
        <Tooltip label="Rows per page" withArrow openDelay={400}>
          <Select
            size="xs"
            aria-label="Rows per page"
            value={String(pageSize)}
            onChange={handlePageSizeChange}
            data={PAGE_SIZE_DATA}
            allowDeselect={false}
            withCheckIcon={false}
            comboboxProps={{ keepMounted: false }}
            rightSectionWidth={16}
            // A compact control inside a 24px band, not the theme's 36 px input.
            styles={{ input: { height: 20, minHeight: 20, fontSize: T.fsXs, paddingInline: '6px 16px' } }}
            style={{ width: 52, flexShrink: 0, marginLeft: 4 }}
          />
        </Tooltip>
      </Group>

      {planOpen && (
        <ExplainDrawer
          onClose={() => setPlanOpen(false)}
          initialPlan={lastRun?.plan}
          initialVerbosity="queryPlanner"
          runExplain={runExplain}
          stale={isStale}
          // A suggestion built from the query now on screen would not be about the plan being read.
          onCreateIndex={isStale ? undefined : onCreateIndex}
        />
      )}
    </>
  );
}

/** A disabled button fires no pointer events, so its tooltip hangs on a wrapper that does. */
function PagerButton({
  label,
  reason,
  enabled,
  onClick,
  icon,
}: {
  label: string;
  reason: string;
  enabled: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <Tooltip label={enabled ? label : reason} withArrow openDelay={300}>
      <span style={{ display: 'inline-flex' }}>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          onClick={() => enabled && onClick()}
          disabled={!enabled}
          aria-label={label}
        >
          {icon}
        </ActionIcon>
      </span>
    </Tooltip>
  );
}

function CountFigure({ stale = false, children }: { stale?: boolean; children: React.ReactNode }) {
  const T = themeVars;
  return <strong style={{ color: stale ? T.textGhost : T.text, fontWeight: 600 }}>{children}</strong>;
}
