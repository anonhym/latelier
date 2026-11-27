import React from 'react';
import { Button, UnstyledButton } from '@mantine/core';
import { api } from '../../api/atelier';
import { logFailure } from '../../utils/rendererLog';
import { themeVars } from '../../theme/themeVars';
import type { AgentAccessState, AgentSessionRow } from '@shared/types';
import { endReasonWords } from './activityRow';
import { AgentTokenDialogs } from './AgentTokenDialogs';
import { sessionWhere, type AgentsPage } from './agentsPage';
import { ago, clock, dayWord } from './agentsTime';
import { useAgentTokenActions } from './useAgentTokenActions';
import { useNow } from './useNow';

const T = themeVars;
const PAGE = 20;

/**
 * An Agent's stored sessions, newest first, a page at a time. Show more reads
 * the next page; only an empty page ends the list. Read again when
 * `refreshKey` changes (a session starting or ending).
 */
function useAgentSessions(tokenId: string, refreshKey: string) {
  const [state, setState] = React.useState<{ key: string; rows: AgentSessionRow[]; exhausted: boolean; loading: boolean }>({
    key: '',
    rows: [],
    exhausted: false,
    loading: true,
  });
  const key = `${tokenId}\u0000${refreshKey}`;
  React.useEffect(() => {
    let live = true;
    api.agentAccess.listSessions({ tokenId, includeEnded: true, limit: PAGE }).then(
      (rows) => live && setState({ key, rows, exhausted: rows.length === 0, loading: false }),
      (err: unknown) => {
        logFailure("listing an Agent's sessions", err);
        if (live) setState({ key, rows: [], exhausted: true, loading: false });
      },
    );
    return () => {
      live = false;
    };
  }, [key, tokenId]);
  const current = state.key === key ? state : { key, rows: [], exhausted: false, loading: true };
  const last = current.rows[current.rows.length - 1];
  const [moreLoading, setMoreLoading] = React.useState(false);
  const showMore = () => {
    if (!last || moreLoading) return;
    setMoreLoading(true);
    api.agentAccess
      .listSessions({ tokenId, includeEnded: true, limit: PAGE, before: { startedAt: last.startedAt, id: last.id } })
      .then(
        (page) =>
          setState((s) => {
            if (s.key !== key) return s;
            const ids = new Set(s.rows.map((r) => r.id));
            return page.length === 0 ? { ...s, exhausted: true } : { ...s, rows: [...s.rows, ...page.filter((r) => !ids.has(r.id))] };
          }),
        (err: unknown) => logFailure("listing an Agent's older sessions", err),
      )
      .finally(() => setMoreLoading(false));
  };
  return { ...current, showMore, moreLoading };
}

/**
 * An Agent's page (X30 §5.3): its name, when it was created and last used,
 * its sessions live and ended, and its menu: Copy setup again…, Rename…,
 * Revoke….
 */
export function AgentPage({
  page,
  state,
  onNavigate,
}: {
  page: Extract<AgentsPage, { kind: 'agent' }>;
  state: AgentAccessState;
  onNavigate: (page: AgentsPage) => void;
}) {
  const now = useNow();
  const token = state.tokens.find((t) => t.id === page.tokenId);
  const liveIds = state.sessions.filter((s) => s.tokenId === page.tokenId).map((s) => s.id);
  const sessions = useAgentSessions(page.tokenId, liveIds.join(','));
  const actions = useAgentTokenActions();

  if (!token) {
    return (
      <div data-testid="agents-page-agent" style={{ fontSize: T.fsMd, color: T.textMuted }}>
        This Agent no longer exists: it was revoked.
      </div>
    );
  }
  const live = new Set(liveIds);

  return (
    <div data-testid="agents-page-agent" style={{ display: 'flex', flexDirection: 'column', gap: themeVars.gapLg }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: themeVars.gapMd, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: T.fsLg, fontWeight: 600, overflowWrap: 'anywhere' }}>{token.name}</h1>
          <div data-testid="agent-page-dates" style={{ fontSize: T.fsMd, color: T.textMuted, marginTop: 3 }}>
            Created {dayWord(token.createdAt, now)} · {token.lastUsedAt ? `last used ${ago(token.lastUsedAt, now)}` : 'never used'}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: themeVars.gapXs, flexWrap: 'wrap' }}>
          <Button size="xs" variant="default" onClick={() => actions.askCopySetup(token)}>
            Copy setup again…
          </Button>
          <Button size="xs" variant="default" onClick={() => actions.askRename(token)}>
            Rename…
          </Button>
          <Button size="xs" variant="outline" styles={{ root: { borderColor: T.warnBorder, color: T.warn } }} onClick={() => void actions.revoke(token)}>
            Revoke…
          </Button>
        </div>
      </div>

      <section aria-labelledby="agent-sessions-heading" style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.r }}>
        <h2 id="agent-sessions-heading" style={{ margin: 0, padding: '12px 16px 6px', fontSize: T.fsMd, fontWeight: 600 }}>
          Sessions
        </h2>
        {sessions.rows.length === 0 && (
          <p style={{ margin: 0, padding: '6px 16px 12px', fontSize: T.fsSm, color: T.textMuted }}>
            {sessions.loading ? 'Loading…' : 'This Agent has not connected yet.'}
          </p>
        )}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {sessions.rows.map((s) => {
            const isLive = live.has(s.id) && s.endedAt === null;
            return (
              <li key={s.id} data-testid="agent-page-session" data-live={isLive || undefined}>
                <UnstyledButton
                  onClick={() =>
                    onNavigate({ kind: 'session', sessionId: s.id, agentName: s.tokenName ?? token.name, where: sessionWhere(s), tokenId: token.id })
                  }
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '10px minmax(0,1fr) auto',
                    gap: themeVars.gapSm,
                    alignItems: 'center',
                    width: '100%',
                    padding: '8px 16px',
                    borderTop: `1px solid ${T.border}`,
                    fontSize: T.fsMd,
                    color: isLive ? T.text : T.textMuted,
                  }}
                >
                  <span
                    aria-hidden
                    style={
                      isLive
                        ? { width: 8, height: 8, borderRadius: 4, background: T.greenDot }
                        : { width: 8, height: 8, borderRadius: 4, border: `1.5px solid ${T.textGhost}`, boxSizing: 'border-box' }
                    }
                  />
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.folder ?? undefined}>
                    {[s.clientName ?? 'unknown client', s.folder].filter(Boolean).join(' · ')}
                  </span>
                  <span style={{ fontSize: T.fsSm, color: T.textGhost, whiteSpace: 'nowrap' }}>
                    {isLive
                      ? `live · since ${clock(s.startedAt)}`
                      : `${dayWord(s.startedAt, now)} ${clock(s.startedAt)}–${clock(s.endedAt)} · ${endReasonWords(s.endReason)}`}
                    {' · '}
                    {s.callCount} {s.callCount === 1 ? 'call' : 'calls'}
                  </span>
                </UnstyledButton>
              </li>
            );
          })}
        </ul>
        {sessions.rows.length > 0 && !sessions.exhausted && (
          <div style={{ padding: '8px 16px', borderTop: `1px solid ${T.border}` }}>
            <Button size="compact-xs" variant="subtle" color="gray" disabled={sessions.moreLoading} onClick={sessions.showMore}>
              Show more
            </Button>
          </div>
        )}
      </section>
      <AgentTokenDialogs actions={actions} />
    </div>
  );
}
