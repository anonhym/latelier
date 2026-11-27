import React from 'react';
import { Button, Switch, Tooltip, VisuallyHidden } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { api, getErrorMessage } from '../../api/atelier';
import { notify } from '../../theme/notifications';
import { themeVars } from '../../theme/themeVars';
import type { AgentAccessState, ConnectionSummary } from '@shared/types';
import { AGENT_ACCESS_COPY, privilegeText } from '../agentAccess/agentAccessCopy';
import { shareWithAgents, stopSharingWithAgents } from '../agentAccess/useShareWithAgents';
import type { AgentsPage } from './agentsPage';
import { connectionRows, homeStatusLine, privilegePill, setupSteps, showSetup, type ConnectionActivity, type ConnectionRow, type SetupStep, type StatusTone } from './homeModel';
import { laterItems, needsYouItems, type ProposalItem } from './needsYou';
import { useOpenProposals } from './proposalStore';
import { NeedsYouList } from './NeedsYouList';
import { useAnySessionEver } from './useAnySessionEver';
import { useNow } from './useNow';

const T = themeVars;

const COLUMNS = 'minmax(0,1.4fr) 92px 130px minmax(0,1.2fr) 120px 110px';

function pillColors(tone: StatusTone): React.CSSProperties {
  if (tone === 'ok') return { background: T.greenSoft, borderColor: T.greenBorder, color: T.greenText };
  if (tone === 'warn') return { background: T.warnSoft, borderColor: T.warnBorder, color: T.warnText };
  return { background: 'transparent', borderColor: T.borderMed, color: T.textMuted };
}

function Pill({ label, tone, title }: { label: string; tone: StatusTone; title?: string }) {
  return (
    <span
      title={title}
      style={{
        fontSize: T.fsXs,
        borderRadius: 10,
        padding: '2px 8px',
        border: '1px solid',
        whiteSpace: 'nowrap',
        display: 'inline-flex',
        alignItems: 'center',
        ...pillColors(tone),
      }}
    >
      {label}
    </span>
  );
}

function card(): React.CSSProperties {
  return { background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.r };
}

/** The first-run checklist (X30 §5.1). */
function SetupChecklist({
  steps,
  onEnable,
  onShare,
  onConnect,
}: {
  steps: SetupStep[];
  onEnable: () => void;
  onShare: () => void;
  onConnect: () => void;
}) {
  const action: Record<SetupStep['id'], () => void> = { enable: onEnable, share: onShare, connect: onConnect };
  return (
    <section aria-labelledby="agents-setup-heading" data-testid="agents-setup" style={{ ...card(), padding: '12px 16px' }}>
      <h2 id="agents-setup-heading" style={{ margin: '0 0 8px', fontSize: T.fsMd, fontWeight: 600 }}>
        Setup
      </h2>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: themeVars.gapSm }}>
        {steps.map((step, i) => (
          <li
            key={step.id}
            data-testid={`agents-setup-${step.id}`}
            data-done={step.done || undefined}
            style={{ display: 'flex', alignItems: 'center', gap: themeVars.gapSm, fontSize: T.fsMd }}
          >
            <span
              aria-hidden
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: T.fsXs,
                fontWeight: 600,
                boxSizing: 'border-box',
                ...(step.done
                  ? { background: T.greenDot, color: '#fff' }
                  : { border: `1.5px solid ${T.accent}`, background: T.accentSoft, color: T.accentInk }),
              }}
            >
              {step.done ? '✓' : i + 1}
            </span>
            <span style={{ color: step.done ? T.textMuted : T.text }}>
              {step.label}
              <VisuallyHidden>{step.done ? ' (done)' : ' (to do)'}</VisuallyHidden>
            </span>
            {!step.done && (
              <Button size="compact-xs" variant="default" style={{ marginLeft: 'auto' }} onClick={action[step.id]}>
                {step.label}
              </Button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ConnectionTableRow({
  row,
  onShared,
  onOpen,
}: {
  row: ConnectionRow;
  onShared: (row: ConnectionRow, shared: boolean) => void;
  onOpen: (id: string) => void;
}) {
  const asked = row.askedBy.length > 0;
  const pill = privilegePill(row.privilege);
  const cantShare = !row.shared && !row.open;
  return (
    <div
      role="row"
      data-testid="agents-connection-row"
      data-connection-id={row.id}
      data-requested={asked || undefined}
      style={{
        display: 'grid',
        gridTemplateColumns: COLUMNS,
        alignItems: 'center',
        gap: themeVars.gapMd,
        padding: '0 16px',
        minHeight: 44,
        borderTop: `1px solid ${T.border}`,
        fontSize: T.fsMd,
        background: asked ? T.warnSoft : undefined,
      }}
    >
      <span role="cell" style={{ display: 'flex', alignItems: 'center', gap: themeVars.gapSm, minWidth: 0 }}>
        <span
          role="img"
          aria-label={row.open ? 'Open' : 'Not open'}
          style={
            row.open
              ? { width: 8, height: 8, borderRadius: 4, background: T.greenDot, flexShrink: 0 }
              : { width: 8, height: 8, borderRadius: 4, border: `1.5px solid ${T.textGhost}`, boxSizing: 'border-box', flexShrink: 0 }
          }
        />
        <span title={row.name} style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.name}
        </span>
        {row.shared && pill && <Pill label={pill.label} tone={pill.tone} title={privilegeText(row.privilege)} />}
      </span>
      <span role="cell">
        <Tooltip label={AGENT_ACCESS_COPY.openFirst} disabled={!cantShare} withArrow>
          <span style={{ display: 'inline-flex' }}>
            <Switch
              size="xs"
              aria-label={`Share ${row.name} with Agents`}
              checked={row.shared}
              disabled={cantShare}
              onChange={(e) => onShared(row, e.currentTarget.checked)}
            />
          </span>
        </Tooltip>
      </span>
      <span role="cell">
        <Pill label={row.status} tone={row.tone} />
      </span>
      <span
        role="cell"
        style={{ color: asked ? T.warnText : row.usedNowBy === '—' ? T.textGhost : T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={asked ? `Asked for by ${row.askedBy.join(', ')}` : row.usedNowBy}
      >
        {asked ? `Asked for by ${row.askedBy.join(', ')}` : row.usedNowBy}
      </span>
      <span role="cell" style={{ color: T.textGhost, whiteSpace: 'nowrap' }}>
        {row.lastCall}
      </span>
      <span role="cell" style={{ textAlign: 'right' }}>
        {row.showOpen && (
          <Button size="compact-xs" variant="default" aria-label={`Open ${row.name}`} onClick={() => onOpen(row.id)}>
            Open
          </Button>
        )}
      </span>
    </div>
  );
}

/**
 * Agents Home (X30 §5.1): the status line, the checklist on first run, Needs
 * you, and every saved Connection with what Agents can reach of it.
 */
export function AgentsHome({
  state,
  connections,
  activity,
  onNavigate,
  openConnection,
}: {
  state: AgentAccessState;
  connections: ConnectionSummary[];
  /** Last Agent call and recent callers per Connection, kept above the tab for the run. */
  activity: ReadonlyMap<string, ConnectionActivity>;
  onNavigate: (page: AgentsPage) => void;
  openConnection: (id: string) => void;
}) {
  const now = useNow();
  const tableRef = React.useRef<HTMLElement>(null);
  const anySessionEver = useAnySessionEver(state.sessions.length);

  const steps = setupSteps({
    enabled: state.enabled,
    anyShared: connections.some((c) => c.shareWithAgents),
    anySessionEver,
  });
  const rows = connectionRows({ connections, state, activity, now });
  const proposals = useOpenProposals().list;
  const items = needsYouItems(state, now, proposals, state.sessions);
  const later = laterItems(proposals, now, state.sessions);
  // Review opens a Proposal in its first backer's session page; one whose session was not kept opens here.
  const [reviewing, setReviewing] = React.useState<string | null>(null);
  const review = (item: ProposalItem) => {
    if (item.sessionId === null) {
      setReviewing((id) => (id === item.proposal.id ? null : item.proposal.id));
      return;
    }
    const tokenId = item.proposal.backers[0]?.tokenId ?? null;
    onNavigate({ kind: 'session', sessionId: item.sessionId, agentName: item.agent, tokenId, proposalId: item.proposal.id });
  };

  const enable = () =>
    void api.agentAccess.requestEnable().catch((err: unknown) => notify.error(getErrorMessage(err, 'Could not turn on Agent Access.')));
  const dismiss = (sessionId: string, connectionId: string) =>
    void api.agentAccess
      .dismissRequest({ sessionId, connectionId })
      .catch((err: unknown) => notify.error(getErrorMessage(err, 'Could not dismiss the request.')));

  return (
    <div data-testid="agents-home" style={{ display: 'flex', flexDirection: 'column', gap: themeVars.gapLg }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: themeVars.gapMd, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: T.fsLg, fontWeight: 600 }}>Agents</h1>
          <div data-testid="agents-status-line" style={{ fontSize: T.fsMd, color: T.textMuted, marginTop: 3 }}>
            {homeStatusLine(state)}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: themeVars.gapXs }}>
          <Button size="xs" variant="default" onClick={() => onNavigate({ kind: 'activity' })}>
            All activity
          </Button>
          <Button size="xs" leftSection={<IconPlus size={12} />} onClick={() => onNavigate({ kind: 'connect' })}>
            Connect an Agent
          </Button>
        </div>
      </div>

      {showSetup(steps) && (
        <SetupChecklist
          steps={steps}
          onEnable={enable}
          onShare={() => {
            tableRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
            tableRef.current?.focus();
          }}
          onConnect={() => onNavigate({ kind: 'connect' })}
        />
      )}

      <NeedsYouList
        items={items}
        later={later}
        reviewing={reviewing}
        handlers={{ onOpenConnection: openConnection, onNotNow: (item) => dismiss(item.sessionId, item.connectionId), onReview: review }}
      />

      <section
        ref={tableRef}
        tabIndex={-1}
        aria-labelledby="agents-connections-heading"
        data-testid="agents-connections"
        style={{ ...card(), outline: 'none' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px 6px' }}>
          <h2 id="agents-connections-heading" style={{ margin: 0, fontSize: T.fsMd, fontWeight: 600 }}>
            Connections Agents can reach
          </h2>
        </div>
        <div role="table" aria-labelledby="agents-connections-heading">
          <div
            role="row"
            style={{
              display: 'grid',
              gridTemplateColumns: COLUMNS,
              gap: themeVars.gapMd,
              padding: '0 16px',
              minHeight: 32,
              alignItems: 'center',
              fontSize: T.fsSm,
              color: T.textGhost,
              fontWeight: 500,
            }}
          >
            <span role="columnheader">Connection</span>
            <span role="columnheader">Shared</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Used now by</span>
            <span role="columnheader">Last Agent call</span>
            <span role="columnheader">
              <VisuallyHidden>Action</VisuallyHidden>
            </span>
          </div>
          {rows.map((row) => (
            <ConnectionTableRow
              key={row.id}
              row={row}
              onShared={(r, shared) => void (shared ? shareWithAgents(r.id) : stopSharingWithAgents(r.id))}
              onOpen={openConnection}
            />
          ))}
        </div>
        <div style={{ padding: '10px 16px 12px', fontSize: T.fsSm, color: T.textGhost, borderTop: `1px solid ${T.border}` }}>
          An Agent sees a Connection only while it is shared and open.
        </div>
      </section>
    </div>
  );
}
