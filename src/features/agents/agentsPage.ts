import type { AgentTokenInfo } from '@shared/types';

/**
 * What the one Agents tab shows (X30 §4). Home, the Connect panel and Setup &
 * capabilities are drawn here; the Agent, session and All activity pages are
 * the next slice's, and keep their place in this union so a link to one
 * already works.
 */
export type AgentsPage =
  | { kind: 'home' }
  | { kind: 'connect'; tokenId?: string }
  | { kind: 'setup' }
  | { kind: 'activity'; connectionId?: string; database?: string; collection?: string }
  | { kind: 'agent'; tokenId: string }
  | {
      kind: 'session';
      sessionId: string;
      /**
       * What the link knew of the session when it was followed, for the tab's
       * label once the session has ended and left the live list. Both came
       * from the Agent's side: text only.
       */
      agentName?: string | null;
      where?: string | null;
    };

export const HOME_PAGE: AgentsPage = { kind: 'home' };

/** Just what the label needs of a live session. */
export interface AgentsPageSession {
  id: string;
  tokenName: string;
  clientName: string | null;
  folder: string | null;
}

export interface AgentsPageNames {
  tokens: ReadonlyArray<Pick<AgentTokenInfo, 'id' | 'name'>>;
  sessions: ReadonlyArray<AgentsPageSession>;
}

/** The last segment of a reported folder, `shop-api` for `~/Projects/shop-api`. Text only. */
export function folderLastSegment(folder: string | null | undefined): string | null {
  if (!folder) return null;
  const parts = folder.split(/[\\/]/).filter((p) => p !== '');
  return parts.length > 0 ? parts[parts.length - 1]! : folder;
}

/** "{folder or client}" for a session: the folder's last segment, else the client's name. */
export function sessionWhere(session: { folder: string | null; clientName: string | null }): string | null {
  return folderLastSegment(session.folder) ?? session.clientName;
}

const FIXED_TITLES = {
  home: 'Home',
  connect: 'Connect an Agent',
  setup: 'Setup & capabilities',
  activity: 'All activity',
} as const;

/**
 * The page's crumbs after "Agents": one for most pages, two for a session
 * (`{Agent}`, `{folder or client}`). A name not known yet reads as the kind.
 */
export function agentsPageCrumbs(page: AgentsPage, names: AgentsPageNames): string[] {
  switch (page.kind) {
    case 'home':
    case 'connect':
    case 'setup':
    case 'activity':
      return [FIXED_TITLES[page.kind]];
    case 'agent':
      return [names.tokens.find((t) => t.id === page.tokenId)?.name ?? 'Agent'];
    case 'session': {
      const live = names.sessions.find((s) => s.id === page.sessionId);
      const agent = live?.tokenName ?? page.agentName ?? 'Agent';
      const where = (live ? sessionWhere(live) : page.where) ?? 'Session';
      return [agent, where];
    }
  }
}

/** The tab's label: "Agents · Home", "Agents · laptop-claude", "Agents · laptop-claude · shop-api". */
export function agentsTabLabel(page: AgentsPage, names: AgentsPageNames): string {
  return ['Agents', ...agentsPageCrumbs(page, names)].join(' · ');
}

/** The title bar's breadcrumb: `Agents › {page}` or `Agents › {Agent} › {session}`. */
export function agentsBreadcrumb(page: AgentsPage, names: AgentsPageNames): string[] {
  return ['Agents', ...agentsPageCrumbs(page, names)];
}
