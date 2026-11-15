import React from 'react';
import { ActionIcon, Button, Group, Select, Tooltip, UnstyledButton } from '@mantine/core';
import { themeVars } from '../../theme/themeVars';
import { I } from '../../icons';
import { useElementWidth } from '../../hooks/useElementWidth';
import { api } from '../../api/atelier';
import { notify } from '../../theme/notifications';
import { DEFAULT_PAGE_SIZE_PREF_KEY, PAGE_SIZE_OPTIONS } from '../../state/workspaceTabs';
import { useCollectionWorkspace } from './context';
import { summarizeExplain } from '../../utils/explainSummary';
import { compileFindOptions } from './builder';
import { formatElapsed, runProblem, stripText } from './optionPills';
import { isResultStale } from './resultPaneState';
import { useRunClock } from './runClock';
import { LIMIT_EXPLANATION, limitChipText } from './queryCaps';
import { pageLabelWidth, statusCountLayout, totalLabelText, type CanvasHeaderLayout } from './toolbarLayout';

const PAGE_SIZE_DATA = PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: String(n) }));

/**
 * The Documents view's count, plan badge and pager (W07 §7): the middle of the
 * result bar, right above the rows they describe. `layout` is the bar's step:
 * First and Last, then the page size, then the label's reserved room give way.
 */
export function ResultStatus({ layout: bar }: { layout: CanvasHeaderLayout }) {
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

  // W06 §8.2 — `lastRun` keeps describing the query the user has since edited
  // away, or one that can no longer run. The same rule as the band above the
  // rows, so the count is marked exactly while that band says so.
  const isStale = isResultStale(state);
  // Before the first run, offer the same Run gate QueryBar's button uses.
  // Read-only consumers have no working `run`, so they keep the plain label.
  const problem = runProblem(state);
  const canRunHere = !isReadOnly && !isLoading && problem === null;
  const clock = useRunClock(meta.tabId);

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

  // An uncounted total is a lower bound: the end of the range, not this page's own count.
  const totalLabel = totalLabelText(totalCount, end ?? 0, !!hasMore);
  const rangeLabel =
    start !== null && end !== null && docCount !== 0 ? `${start.toLocaleString()}–${end.toLocaleString()}` : null;
  // Where the user is in the result. An unknown total leaves the range alone,
  // except when empty: nothing matched, so "0 of 0" is known.
  const pagerLabel =
    docCount === null
      ? '–'
      : docCount === 0 && totalCount === undefined
        ? '0 of 0'
        : (rangeLabel ?? '0') + (totalCount !== undefined ? ` of ${totalLabel}` : '');
  const noun = (totalCount ?? docCount) === 1 && !hasMore ? 'document' : 'documents';

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
        {isLoading ? (
          // W05 §9.5: a slow query used to change nothing here but the Run button.
          <span role="status" data-testid="result-running" style={{ color: T.text, fontVariantNumeric: 'tabular-nums' }}>
            Running · {formatElapsed(clock?.kind === 'running' ? clock.elapsedMs : 0)}
          </span>
        ) : clock?.kind === 'cancelled' ? (
          <span role="status" data-testid="result-cancelled">
            Cancelled after {formatElapsed(clock.elapsedMs, true)}
          </span>
        ) : lastRun?.error && docCount === 0 ? (
          <span data-testid="result-count-failed" style={{ color: T.redText, fontWeight: 600 }}>
            Query failed
          </span>
        ) : docCount !== null ? (
          <>
            <span
              style={{ flex: '0 0 auto', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              <CountFigure stale={isStale}>{totalLabel}</CountFigure> {noun}
              {/* W01 §14.6: the duration is always shown, whatever else gives way. */}
              {duration !== null && (
                <>
                  {' · '}
                  <CountFigure>{duration}</CountFigure> ms
                </>
              )}
            </span>
            {/* Not a live region: the band above the rows already says it. */}
            {isStale && (
              <span
                role="img"
                data-testid="result-count-stale"
                aria-label="Not current"
                title="These results are not the current query's"
                style={{ width: 7, height: 7, borderRadius: '50%', background: T.warn, flexShrink: 0 }}
              />
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
          <Tooltip label={problem ? stripText(problem) : 'Run (Cmd+Enter)'} withArrow>
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

        {planLabel !== null && layout.planBadge && actions.openPlan && (
          <UnstyledButton
            type="button"
            data-testid="plan-badge"
            aria-label={`Query plan: ${planLabel}${isStale ? ' (not current)' : ''}`}
            title={planLabel}
            // The Inspector's Plan tab (W05 §9.7), which re-fetches only when the
            // verbosity changes, and then asks about the committed filter text.
            onClick={() => actions.openPlan?.({ verbosity: 'queryPlanner', plan: lastRun?.plan, stale: isStale })}
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
      <Group gap={0} wrap="nowrap" style={{ flex: '0 1 auto', minWidth: 0 }}>
        {bar.pagerEnds && (
          <PagerButton label="First page" reason={backReason} enabled={canPrev} onClick={() => goToPage(0)} icon={I.chevLL} />
        )}
        <PagerButton label="Previous page" reason={backReason} enabled={canPrev} onClick={() => goToPage(page - 1)} icon={I.chevL} />
        {/* Room for the widest label this total reaches, so Next and Last hold still.
            At the narrowest bar the reservation goes and the label itself truncates,
            never the buttons beside it. */}
        <span
          data-testid="page-label"
          style={{
            flex: '0 1 auto',
            minWidth: bar.labelReserve ? pageLabelWidth(totalLabel) : 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            textAlign: 'center',
            color: T.text,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {pagerLabel}
        </span>
        <PagerButton label="Next page" reason={nextReason} enabled={canNext} onClick={() => goToPage(page + 1)} icon={I.chevR} />
        {bar.pagerEnds && (
          <PagerButton
            label="Last page"
            reason={lastReason}
            enabled={canLast}
            onClick={() => totalPages !== null && goToPage(totalPages - 1)}
            icon={I.chevRR}
          />
        )}
        {/* `keepMounted: false` unmounts the option list while closed, so its
            numeric labels never collide with text locators elsewhere. */}
        {bar.pageSize && (
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
            // A compact control inside a 28px row, not the theme's 36 px input.
            styles={{ input: { height: 20, minHeight: 20, fontSize: T.fsXs, paddingInline: '6px 16px' } }}
            style={{ width: 52, flexShrink: 0, marginLeft: 4 }}
          />
        </Tooltip>
        )}
      </Group>
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
  // Looks disabled but stays focusable (`data-disabled`, not `disabled`), so
  // a keyboard user reaches it and the tooltip says why on focus.
  return (
    <Tooltip label={enabled ? label : reason} withArrow openDelay={300} events={{ hover: true, focus: true, touch: false }}>
      <ActionIcon
        variant="subtle"
        color="gray"
        size="sm"
        onClick={() => enabled && onClick()}
        style={{ flexShrink: 0 }}
        data-disabled={!enabled || undefined}
        aria-disabled={!enabled || undefined}
        aria-label={label}
      >
        {icon}
      </ActionIcon>
    </Tooltip>
  );
}

function CountFigure({ stale = false, children }: { stale?: boolean; children: React.ReactNode }) {
  const T = themeVars;
  return <strong style={{ color: stale ? T.textGhost : T.text, fontWeight: 600 }}>{children}</strong>;
}
