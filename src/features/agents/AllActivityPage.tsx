import { CloseButton, NativeSelect, SegmentedControl } from '@mantine/core';
import { themeVars } from '../../theme/themeVars';
import type { AgentAccessState, AgentCallOutcomeFilter, ConnectionSummary } from '@shared/types';
import type { QuerySeed } from './activityRow';
import { ActivityTable } from './ActivityTable';
import type { AgentsPage } from './agentsPage';

const T = themeVars;

type ActivityPage = Extract<AgentsPage, { kind: 'activity' }>;

const OUTCOMES: Array<{ value: AgentCallOutcomeFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'ok', label: 'OK' },
  { value: 'refused', label: 'Refused' },
];

/**
 * All activity (X30 §5.1): the whole Agent Read Log, as a session's Activity,
 * with filters for Agent, Connection and outcome. A link from a collection's
 * History arrives with its Connection, database and collection set.
 */
export function AllActivityPage({
  page,
  state,
  connections,
  onNavigate,
  onOpenQuery,
}: {
  page: ActivityPage;
  state: AgentAccessState;
  connections: ConnectionSummary[];
  onNavigate: (page: AgentsPage) => void;
  onOpenQuery: (seed: QuerySeed) => void;
}) {
  const outcome = page.outcome ?? 'all';
  // The filters live in the page, so the tab keeps them for the run.
  const set = (patch: Partial<ActivityPage>) => onNavigate({ ...page, ...patch });
  const tokens = [...state.tokens].sort((a, b) => a.name.localeCompare(b.name));
  const conns = [...connections].sort((a, b) => a.name.localeCompare(b.name));
  const namespace = [page.database, page.collection].filter(Boolean).join('.');
  return (
    <div data-testid="agents-page-activity" style={{ display: 'flex', flexDirection: 'column', gap: themeVars.gapLg }}>
      <h1 style={{ margin: 0, fontSize: T.fsLg, fontWeight: 600 }}>All activity</h1>
      <div style={{ display: 'flex', gap: themeVars.gapMd, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <NativeSelect
          size="xs"
          label="Agent"
          value={page.tokenId ?? ''}
          data={[{ value: '', label: 'Every Agent' }, ...tokens.map((t) => ({ value: t.id, label: t.name }))]}
          onChange={(e) => set({ tokenId: e.currentTarget.value || undefined })}
        />
        <NativeSelect
          size="xs"
          label="Connection"
          value={page.connectionId ?? ''}
          data={[{ value: '', label: 'Every Connection' }, ...conns.map((c) => ({ value: c.id, label: c.name }))]}
          // A database and collection belong to the Connection they were chosen on.
          onChange={(e) => set({ connectionId: e.currentTarget.value || undefined, database: undefined, collection: undefined })}
        />
        <div>
          <div id="activity-outcome-label" style={{ fontSize: T.fsSm, fontWeight: 500, marginBottom: 2 }}>
            Outcome
          </div>
          <SegmentedControl
            size="xs"
            aria-labelledby="activity-outcome-label"
            value={outcome}
            data={OUTCOMES}
            onChange={(v) => set({ outcome: v as AgentCallOutcomeFilter })}
          />
        </div>
        {namespace && (
          <span
            data-testid="activity-namespace"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: themeVars.gapXs,
              fontSize: T.fsSm,
              padding: '2px 4px 2px 8px',
              borderRadius: 10,
              border: `1px solid ${T.accentBorder}`,
              background: T.accentSoft,
              color: T.accentInk,
            }}
          >
            <span style={{ overflowWrap: 'anywhere' }}>{namespace}</span>
            <CloseButton size="xs" aria-label={`Show every collection, not only ${namespace}`} onClick={() => set({ database: undefined, collection: undefined })} />
          </span>
        )}
      </div>
      <section aria-label="Agent Read Log" style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.r, minWidth: 0 }}>
        <ActivityTable
          filter={{
            outcome,
            ...(page.tokenId ? { tokenId: page.tokenId } : {}),
            ...(page.connectionId ? { connectionId: page.connectionId } : {}),
            ...(page.database ? { database: page.database } : {}),
            ...(page.collection ? { collection: page.collection } : {}),
          }}
          onOpenQuery={onOpenQuery}
          empty="No Agent call matches these filters."
        />
      </section>
    </div>
  );
}
