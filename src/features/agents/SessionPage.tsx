import React from 'react';
import { Button } from '@mantine/core';
import { api, getErrorMessage } from '../../api/atelier';
import { notify } from '../../theme/notifications';
import { themeVars } from '../../theme/themeVars';
import type { AgentAccessState, AgentSessionEndReason } from '@shared/types';
import { endReasonWords, reachedConnections, shortId, type QuerySeed } from './activityRow';
import { ActivityTable } from './ActivityTable';
import type { AgentsPage } from './agentsPage';
import { clock, dayWord, elapsedShort } from './agentsTime';
import { forSession, laterItems, needsYouItems, type ProposalItem } from './needsYou';
import { NeedsYouList } from './NeedsYouList';
import { useOpenProposals } from './proposalStore';
import { useAgentTokenActions } from './useAgentTokenActions';
import { useSessionCalls, useStoredSession } from './useActivity';
import { useNow } from './useNow';

const T = themeVars;

type SessionPageProps = {
  page: Extract<AgentsPage, { kind: 'session' }>;
  state: AgentAccessState;
  openConnection: (id: string) => void;
  onOpenQuery: (seed: QuerySeed) => void;
};

/** What the page knows of a session, live or ended. Every text came from the Agent's side. */
interface SessionView {
  id: string;
  tokenId: string | null;
  tokenName: string | null;
  clientName: string | null;
  clientVersion: string | null;
  folder: string | null;
  startedAt: string;
  endedAt: string | null;
  endReason: AgentSessionEndReason | null;
  callCount: number;
  refusedCount: number;
}

type Tone = 'ok' | 'warn' | 'neutral';

function Pill({ children, tone, testId }: { children: React.ReactNode; tone: Tone; testId?: string }) {
  const colors =
    tone === 'ok'
      ? { background: T.greenSoft, borderColor: T.greenBorder, color: T.greenText }
      : tone === 'warn'
        ? { background: T.warnSoft, borderColor: T.warnBorder, color: T.warnText }
        : { background: 'transparent', borderColor: T.borderMed, color: T.textMuted };
  return (
    <span
      data-testid={testId}
      data-tone={tone}
      style={{ fontSize: T.fsSm, borderRadius: 10, padding: '1px 8px', border: '1px solid', whiteSpace: 'nowrap', ...colors }}
    >
      {children}
    </span>
  );
}

function Identity({ label, value, note }: { label: string; value: React.ReactNode; note: string | null }) {
  return (
    <>
      <dt style={{ fontSize: T.fsSm, color: T.textGhost }}>{label}</dt>
      <dd style={{ margin: 0, fontSize: T.fsMd, minWidth: 0, overflowWrap: 'anywhere' }}>
        {value}
        {note && <div style={{ fontSize: T.fsXs, color: T.textGhost }}>{note}</div>}
      </dd>
    </>
  );
}

function when(iso: string, now: number): string {
  return `${dayWord(iso, now)} ${clock(iso)}`;
}

/**
 * A session page (X30 §5.2): who the Agent is and where each fact comes
 * from, the Connections it reached, what needs you from it, and its
 * Activity, live. An ended session's page shows the same, read-only.
 */
export function SessionPage({ page, state, openConnection, onOpenQuery }: SessionPageProps) {
  const now = useNow();
  const live = state.sessions.find((s) => s.id === page.sessionId) ?? null;
  // A session that ends while shown is read again from the stored sessions;
  // the row read while it was live stays on screen meanwhile.
  const stored = useStoredSession(page.sessionId, page.tokenId ?? live?.tokenId, live ? 'live' : 'ended');
  const known: SessionView | null = live ? { ...live, endedAt: null, endReason: null } : stored.row;

  const calls = useSessionCalls(page.sessionId);
  const reached = reachedConnections(calls);
  const proposals = useOpenProposals().list;
  const items = forSession(needsYouItems(state, now, proposals, state.sessions), page.sessionId);
  const later = forSession(laterItems(proposals, now, state.sessions), page.sessionId);
  const [reviewing, setReviewing] = React.useState<string | null>(page.proposalId ?? null);
  const [refusedOnly, setRefusedOnly] = React.useState(false);
  const actions = useAgentTokenActions();
  const ended = !live;
  const token = known?.tokenId ? state.tokens.find((t) => t.id === known.tokenId) : undefined;
  const agentName = known?.tokenName ?? page.agentName ?? 'Agent';

  if (!known) {
    return (
      <div data-testid="agents-page-session" style={{ fontSize: T.fsMd, color: T.textMuted }}>
        {stored.done ? 'This session is not in the Agent Read Log any more.' : 'Loading…'}
      </div>
    );
  }

  const endSession = () =>
    void api.agentAccess.endSession({ sessionId: known.id }).catch((err: unknown) => notify.error(getErrorMessage(err, 'Could not end the session.')));
  const review = (item: ProposalItem) => setReviewing((id) => (id === item.proposal.id ? null : item.proposal.id));
  const client = [known.clientName, known.clientVersion].filter(Boolean).join(' ');

  return (
    <div data-testid="agents-page-session" data-ended={ended || undefined} style={{ display: 'flex', flexDirection: 'column', gap: themeVars.gapLg }}>
      <section
        aria-label="Session"
        data-testid="session-identity"
        style={{ display: 'flex', gap: themeVars.gapXl, padding: '16px 18px', background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.r, flexWrap: 'wrap' }}
      >
        <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: themeVars.gapMd }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: themeVars.gapSm, flexWrap: 'wrap' }}>
            <span
              aria-hidden
              style={
                ended
                  ? { width: 8, height: 8, borderRadius: 4, border: `1.5px solid ${T.textGhost}`, boxSizing: 'border-box' }
                  : { width: 8, height: 8, borderRadius: 4, background: T.greenDot }
              }
            />
            <h1 style={{ margin: 0, fontSize: T.fsLg, fontWeight: 600, overflowWrap: 'anywhere' }}>{agentName}</h1>
            {ended ? <Pill tone="neutral">Ended</Pill> : <Pill tone="ok">Live · {elapsedShort(known.startedAt, now)}</Pill>}
            <Pill tone={known.refusedCount > 0 ? 'warn' : 'neutral'} testId="session-counts">
              {known.callCount} {known.callCount === 1 ? 'call' : 'calls'} · {known.refusedCount} refused
            </Pill>
          </div>
          <dl style={{ display: 'grid', gridTemplateColumns: '118px minmax(0,1fr)', rowGap: themeVars.gapSm, columnGap: themeVars.gapMd, margin: 0 }}>
            <Identity label="Agent" value={agentName} note="your name for this token, checked at connect" />
            <Identity label="Client" value={client || 'not reported'} note="as the client reports it" />
            <Identity
              label="Folder"
              value={known.folder ?? 'not reported'}
              note={known.folder ? 'reported by the bridge' : null}
            />
            <Identity
              label="Session"
              value={
                <span data-testid="session-when">
                  {shortId(known.id)} · connected {when(known.startedAt, now)} ·{' '}
                  {known.endedAt ? `ended ${when(known.endedAt, now)} · ${endReasonWords(known.endReason)}` : 'live'}
                </span>
              }
              note={null}
            />
            <Identity
              label="Reached"
              value={
                reached.length === 0 ? (
                  <span style={{ color: T.textGhost }}>no Connection yet</span>
                ) : (
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: themeVars.gapXs }}>
                    {reached.map((r) => (
                      <Pill key={r.connectionId} tone={r.tone} testId="session-reached">
                        {r.label}
                      </Pill>
                    ))}
                  </span>
                )
              }
              note={null}
            />
          </dl>
        </div>
        {!ended && (
          <div style={{ width: 170, display: 'flex', flexDirection: 'column', gap: themeVars.gapSm }}>
            <Button size="xs" variant="default" onClick={endSession}>
              End this session
            </Button>
            {token && (
              <Button
                size="xs"
                variant="outline"
                styles={{ root: { borderColor: T.warnBorder, color: T.warn } }}
                onClick={() => void actions.revoke(token)}
              >
                Revoke {token.name}…
              </Button>
            )}
            <div style={{ fontSize: T.fsXs, color: T.textGhost }}>Revoke ends every session of this Agent and needs a new token.</div>
          </div>
        )}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.15fr)', gap: themeVars.gapLg, alignItems: 'start' }}>
        <NeedsYouList
          items={items}
          later={later}
          reviewing={reviewing}
          handlers={{
            onOpenConnection: openConnection,
            onNotNow: (item) =>
              void api.agentAccess
                .dismissRequest({ sessionId: item.sessionId, connectionId: item.connectionId })
                .catch((err: unknown) => notify.error(getErrorMessage(err, 'Could not dismiss the request.'))),
            onReview: review,
          }}
        />
        <section aria-labelledby="session-activity-heading" style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.r, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: themeVars.gapSm, padding: '10px 14px' }}>
            <h2 id="session-activity-heading" style={{ margin: 0, fontSize: T.fsMd, fontWeight: 600 }}>
              Activity <span style={{ color: T.textGhost, fontWeight: 400 }}>this session</span>
            </h2>
            <Button
              size="compact-xs"
              variant={refusedOnly ? 'light' : 'subtle'}
              color="gray"
              aria-pressed={refusedOnly}
              style={{ marginLeft: 'auto' }}
              onClick={() => setRefusedOnly(!refusedOnly)}
            >
              Refused only
            </Button>
          </div>
          <ActivityTable
            filter={{ sessionId: page.sessionId, outcome: refusedOnly ? 'refused' : 'all' }}
            onOpenQuery={onOpenQuery}
            empty={refusedOnly ? 'No refused call in this session.' : 'No call in this session yet.'}
          />
        </section>
      </div>
    </div>
  );
}
