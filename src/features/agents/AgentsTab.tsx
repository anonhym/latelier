import type { ReactNode } from 'react';
import { themeVars } from '../../theme/themeVars';
import type { AgentAccessState, ConnectionSummary } from '@shared/types';
import type { QuerySeed } from './activityRow';
import { AgentPage } from './AgentPage';
import type { AgentsPage } from './agentsPage';
import { AgentsHome } from './AgentsHome';
import { AllActivityPage } from './AllActivityPage';
import { ConnectAgentPanel } from './ConnectAgentPanel';
import type { ConnectDrafts, ConnectPanelAction } from './connectPanel';
import type { ConnectionActivity } from './homeModel';
import { SessionPage } from './SessionPage';
import { SetupCapabilities } from './SetupCapabilities';

const T = themeVars;

/**
 * The body of the one Agents tab (X30 §4–§7): routes its page.
 */
export function AgentsTab({
  page,
  state,
  connections,
  onNavigate,
  openConnection,
  connectDrafts,
  onConnectAction,
  activity,
  onOpenQuery,
}: {
  page: AgentsPage;
  /** Null until the first read of Agent Access lands. */
  state: AgentAccessState | null;
  connections: ConnectionSummary[];
  onNavigate: (page: AgentsPage) => void;
  openConnection: (id: string) => void;
  /** Held above the tab: the Connect panels of this run, and what the Read Log says per Connection. */
  connectDrafts: ConnectDrafts;
  onConnectAction: (tokenId: string | undefined, action: ConnectPanelAction) => void;
  activity: ReadonlyMap<string, ConnectionActivity>;
  /** Open as query: fills a tab with an Agent's query and never runs it. */
  onOpenQuery: (seed: QuerySeed) => void;
}) {
  let body: ReactNode;
  if (!state) {
    body = <div style={{ color: T.textMuted, fontSize: T.fsMd }}>Loading…</div>;
  } else {
    switch (page.kind) {
      case 'home':
        body = (
          <AgentsHome
            // Keyed: a Review from a toast opens its Proposal even when Home is already showing.
            key={page.proposalId ?? ''}
            state={state}
            connections={connections}
            activity={activity}
            onNavigate={onNavigate}
            openConnection={openConnection}
            reviewProposalId={page.proposalId ?? null}
          />
        );
        break;
      case 'connect':
        body = (
          <ConnectAgentPanel
            state={state}
            tokenId={page.tokenId}
            drafts={connectDrafts}
            onAction={onConnectAction}
            onNavigate={onNavigate}
          />
        );
        break;
      case 'setup':
        body = <SetupCapabilities state={state} />;
        break;
      case 'session':
        // Keyed by session, so a page's own state (a Proposal opened for review) is the session's.
        body = (
          <SessionPage
            key={`${page.sessionId}\u0000${page.proposalId ?? ''}`}
            page={page}
            state={state}
            openConnection={openConnection}
            onOpenQuery={onOpenQuery}
          />
        );
        break;
      case 'agent':
        body = <AgentPage key={page.tokenId} page={page} state={state} onNavigate={onNavigate} />;
        break;
      case 'activity':
        body = <AllActivityPage page={page} state={state} connections={connections} onNavigate={onNavigate} onOpenQuery={onOpenQuery} />;
    }
  }
  return (
    <div
      role="tabpanel"
      aria-label="Agents"
      data-testid="agents-tab-panel"
      style={{ flex: 1, minHeight: 0, overflow: 'auto', background: T.bg }}
    >
      <div style={{ padding: '22px 28px', boxSizing: 'border-box' }}>{body}</div>
    </div>
  );
}
