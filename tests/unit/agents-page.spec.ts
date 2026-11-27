import { describe, it, expect } from 'vitest';
import {
  HOME_PAGE,
  agentsBreadcrumb,
  agentsPageCrumbs,
  agentsTabLabel,
  folderLastSegment,
  sessionWhere,
  type AgentsPageNames,
} from '../../src/features/agents/agentsPage';

const names: AgentsPageNames = {
  tokens: [
    { id: 't1', name: 'laptop-claude' },
    { id: 't2', name: 'cursor-work' },
  ],
  sessions: [
    { id: 's1', tokenName: 'laptop-claude', clientName: 'claude-code', folder: '~/Projects/shop-api' },
    { id: 's2', tokenName: 'cursor-work', clientName: 'cursor', folder: null },
    { id: 's3', tokenName: 'cursor-work', clientName: null, folder: null },
  ],
};

describe('folderLastSegment', () => {
  it('takes the last segment of a POSIX or Windows path, ignoring a trailing separator', () => {
    expect(folderLastSegment('~/Projects/shop-api')).toBe('shop-api');
    expect(folderLastSegment('~/Projects/shop-api/')).toBe('shop-api');
    expect(folderLastSegment('C:\\Users\\me\\reports')).toBe('reports');
    expect(folderLastSegment('~')).toBe('~');
  });

  it('keeps a path made only of separators as it is, and reads nothing as nothing', () => {
    expect(folderLastSegment('/')).toBe('/');
    expect(folderLastSegment('')).toBeNull();
    expect(folderLastSegment(null)).toBeNull();
    expect(folderLastSegment(undefined)).toBeNull();
  });
});

describe('sessionWhere', () => {
  it('prefers the folder, then the client', () => {
    expect(sessionWhere({ folder: '/a/b', clientName: 'cursor' })).toBe('b');
    expect(sessionWhere({ folder: null, clientName: 'cursor' })).toBe('cursor');
    expect(sessionWhere({ folder: null, clientName: null })).toBeNull();
  });
});

describe('agentsTabLabel and agentsBreadcrumb', () => {
  it('names the fixed pages', () => {
    expect(agentsTabLabel(HOME_PAGE, names)).toBe('Agents · Home');
    expect(agentsTabLabel({ kind: 'connect' }, names)).toBe('Agents · Connect an Agent');
    expect(agentsTabLabel({ kind: 'setup' }, names)).toBe('Agents · Setup & capabilities');
    expect(agentsTabLabel({ kind: 'activity' }, names)).toBe('Agents · All activity');
    expect(agentsBreadcrumb(HOME_PAGE, names)).toEqual(['Agents', 'Home']);
  });

  it("names an Agent page by the token's name, or 'Agent' when it is not known", () => {
    expect(agentsTabLabel({ kind: 'agent', tokenId: 't2' }, names)).toBe('Agents · cursor-work');
    expect(agentsPageCrumbs({ kind: 'agent', tokenId: 'gone' }, names)).toEqual(['Agent']);
  });

  it('names a live session by its Agent and its folder, else its client', () => {
    expect(agentsTabLabel({ kind: 'session', sessionId: 's1' }, names)).toBe('Agents · laptop-claude · shop-api');
    expect(agentsBreadcrumb({ kind: 'session', sessionId: 's2' }, names)).toEqual(['Agents', 'cursor-work', 'cursor']);
  });

  it('prefers the live record over what the link carried', () => {
    expect(
      agentsPageCrumbs({ kind: 'session', sessionId: 's1', agentName: 'old', where: 'elsewhere' }, names),
    ).toEqual(['laptop-claude', 'shop-api']);
    expect(agentsPageCrumbs({ kind: 'session', sessionId: 's3', where: 'elsewhere' }, names)).toEqual([
      'cursor-work',
      'Session',
    ]);
  });

  it('falls back to what the link carried for an ended session, then to the kind', () => {
    expect(agentsPageCrumbs({ kind: 'session', sessionId: 'ended', agentName: 'desktop', where: 'reports' }, names)).toEqual([
      'desktop',
      'reports',
    ]);
    expect(agentsPageCrumbs({ kind: 'session', sessionId: 'ended' }, names)).toEqual(['Agent', 'Session']);
  });
});
