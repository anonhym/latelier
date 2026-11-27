import type { ReactNode } from 'react';
import { UnstyledButton } from '@mantine/core';
import { IconChevronLeft } from '@tabler/icons-react';
import { themeVars } from '../../theme/themeVars';
import type { AgentAccessState, ConnectionSummary } from '@shared/types';
import { agentsPageCrumbs, type AgentsPage } from './agentsPage';
import { AgentsHome } from './AgentsHome';
import { ConnectAgentPanel } from './ConnectAgentPanel';
import type { ConnectDrafts, ConnectPanelAction } from './connectPanel';
import type { ConnectionActivity } from './homeModel';
import { SetupCapabilities } from './SetupCapabilities';

const T = themeVars;

/**
 * The Agent, session and All activity pages until they are built: a heading,
 * so a link to one already lands somewhere and the tab names it.
 */
function PendingPage({
  page,
  state,
  onNavigate,
}: {
  page: Extract<AgentsPage, { kind: 'agent' | 'session' | 'activity' }>;
  state: AgentAccessState;
  onNavigate: (page: AgentsPage) => void;
}) {
  const crumbs = agentsPageCrumbs(page, { tokens: state.tokens, sessions: state.sessions });
  const heading = page.kind === 'agent' ? 'Agent' : page.kind === 'session' ? 'Session' : 'All activity';
  return (
    <div data-testid={`agents-page-${page.kind}`} style={{ display: 'flex', flexDirection: 'column', gap: themeVars.gapMd }}>
      <UnstyledButton
        onClick={() => onNavigate({ kind: 'home' })}
        style={{ display: 'inline-flex', alignItems: 'center', gap: themeVars.gapXs, color: T.textMuted, fontSize: T.fsSm, alignSelf: 'flex-start' }}
      >
        <IconChevronLeft size={14} aria-hidden="true" />
        Agents
      </UnstyledButton>
      <h1 style={{ margin: 0, fontSize: T.fsLg, fontWeight: 600 }}>{heading}</h1>
      {page.kind !== 'activity' && (
        <div style={{ fontSize: T.fsMd, color: T.textMuted, overflowWrap: 'anywhere' }}>{crumbs.join(' · ')}</div>
      )}
    </div>
  );
}

/**
 * The body of the one Agents tab (X30 §4–§7): routes its page. Home, the
 * Connect panel and Setup & capabilities are drawn here.
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
}) {
  let body: ReactNode;
  if (!state) {
    body = <div style={{ color: T.textMuted, fontSize: T.fsMd }}>Loading…</div>;
  } else {
    switch (page.kind) {
      case 'home':
        body = (
          <AgentsHome state={state} connections={connections} activity={activity} onNavigate={onNavigate} openConnection={openConnection} />
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
      default:
        body = <PendingPage page={page} state={state} onNavigate={onNavigate} />;
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
