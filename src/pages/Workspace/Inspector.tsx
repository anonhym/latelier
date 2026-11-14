import React from 'react';
import { ActionIcon, Tabs, Tooltip } from '@mantine/core';
import type { ExplainVerbosity } from '@shared/types';
import { I } from '../../icons';
import { themeVars } from '../../theme/themeVars';
import { ExplainBody } from './Aggregation/ExplainDrawer';
import { compileFindOptions } from './builder';
import { useCollectionWorkspace } from './context';
import { useFindExplain } from './useFindExplain';

export type InspectorTab = 'filter' | 'plan';

/** What the Plan tab explains. `seq` is new for every request, so a repeat remounts the view. */
export interface PlanRequest {
  tabId: string;
  seq: number;
  verbosity: ExplainVerbosity;
  /** A plan the caller holds (the status bar's badge); fetched on open when absent. */
  plan?: unknown;
  /** The plan describes an earlier run than the query on screen. */
  stale?: boolean;
}

/** An Escape that belongs to a popup, menu or dialog stays theirs. */
const OWN_ESCAPE = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [aria-expanded="true"]';

function PlanPane({ request, onClose }: { request: PlanRequest; onClose: () => void }) {
  const { state } = useCollectionWorkspace();
  // The committed filter text, like every read surface (the Run menu commits first).
  const { runExplain: explainNow, onCreateIndex } = useFindExplain(() => state.queryRaw);
  // The query as it stands now, and as it stood when the plan on screen was made.
  const nowQuery = JSON.stringify([state.queryRaw.trim(), compileFindOptions(state.builder)]);
  // A plan the caller marked stale matches no query on screen until a fetch replaces it.
  const [explainedQuery, setExplainedQuery] = React.useState<string | null>(request.stale ? null : nowQuery);
  const runExplain = React.useCallback(
    async (verbosity: ExplainVerbosity) => {
      const res = await explainNow(verbosity);
      setExplainedQuery(nowQuery);
      return res;
    },
    [explainNow, nowQuery],
  );
  const stale = explainedQuery !== nowQuery;
  return (
    <>
      {stale && (
        <div
          style={{
            padding: '6px 14px',
            fontSize: themeVars.fsXs,
            color: themeVars.warnText,
            background: themeVars.warnSoft,
            borderBottom: `1px solid ${themeVars.warnBorder}`,
          }}
        >
          This plan is not current: the query has changed since it was made.
        </div>
      )}
      <ExplainBody
        key={request.seq}
        onClose={onClose}
        initialVerbosity={request.verbosity}
        initialPlan={request.plan}
        runExplain={runExplain}
        // A suggestion built from the query now on screen would not be about the plan being read.
        onCreateIndex={stale ? undefined : onCreateIndex}
      />
    </>
  );
}

interface InspectorProps {
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  onClose: () => void;
  /** The plan the Plan tab shows; none until one was asked for. */
  plan: PlanRequest | null;
  /** The Filter tab: the builder. Kept mounted while Plan shows, so its drafts survive. */
  children: React.ReactNode;
}

/**
 * The right-hand panel (W05 §9.7): a 36px header with its title, the
 * `Filter | Plan` switch and close, over the builder or the query plan.
 * Escape closes it unless it belongs to something open inside.
 */
export function Inspector({ tab, onTabChange, onClose, plan, children }: InspectorProps) {
  const T = themeVars;
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (e.target instanceof Element && e.target.closest(OWN_ESCAPE)) return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };
  return (
    <div
      data-testid="inspector"
      onKeyDown={onKeyDown}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        borderLeft: `1px solid ${T.border}`,
        background: T.surface,
      }}
    >
      <Tabs
        value={tab}
        onChange={(v) => v && onTabChange(v as InspectorTab)}
        variant="default"
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: T.gapSm,
            height: 36,
            padding: '0 6px 0 12px',
            flexShrink: 0,
            borderBottom: `1px solid ${T.border}`,
          }}
        >
          <span style={{ fontSize: T.fsXs, fontWeight: 600, color: T.textMuted }}>Inspector</span>
          <Tabs.List aria-label="Inspector view" style={{ flex: 1, height: 36, borderBottom: 'none' }}>
            <Tabs.Tab value="filter" styles={{ tab: { fontSize: T.fsXs } }}>
              Filter
            </Tabs.Tab>
            <Tabs.Tab value="plan" styles={{ tab: { fontSize: T.fsXs } }}>
              Plan
            </Tabs.Tab>
          </Tabs.List>
          <Tooltip label="Close (Esc)" withArrow>
            <ActionIcon variant="subtle" color="gray" size={24} onClick={onClose} aria-label="Close inspector">
              {I.close}
            </ActionIcon>
          </Tooltip>
        </div>
        <Tabs.Panel
          value="filter"
          keepMounted
          style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
        >
          {children}
        </Tabs.Panel>
        <Tabs.Panel value="plan" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {plan && <PlanPane key={plan.seq} request={plan} onClose={onClose} />}
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
