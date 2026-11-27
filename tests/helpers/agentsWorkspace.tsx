// Test-only helper for the Agents mode specs: mounts the Workspace with a
// mocked `window.atelier` whose Agent Access state can be pushed.
import { act } from '@testing-library/react';
import { vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render } from './render';
import { installAtelierMock, AGENT_ACCESS_OFF, collectionTabFixture, connectionFixture } from './atelierMock';
import { HintsProvider } from '../../src/hints/HintsProvider';
import { SettingsProvider } from '../../src/pages/SettingsContext';
import Workspace from '../../src/pages/Workspace';
import type { IpcApi } from '@shared/ipc';
import type {
  AgentAccessState,
  AgentSessionInfo,
  AgentTokenInfo,
  ConnectionSummary,
  FeatureHintDismissalState,
  WorkspaceTab,
} from '@shared/types';

/** Every hint id, dismissed, so no hint covers what a spec clicks. */
const ALL_HINTS_DISMISSED: FeatureHintDismissalState = {
  dismissedIds: [
    'run.execute',
    'refs.configure',
    'tabs.pin',
    'saved.create',
    'palette.discover',
    'startup.restore',
    'find.options',
    'agents.share',
  ],
};

export function agentState(over: Partial<AgentAccessState> = {}): AgentAccessState {
  return {
    ...AGENT_ACCESS_OFF,
    enabled: true,
    bridgeInstalled: true,
    bridgePath: '/bridge/latelier-agent-bridge',
    socketPath: '/tmp/latelier.sock',
    snippetTemplates: {
      'claude-code-cli': 'claude mcp add latelier --scope user -e LATELIER_AGENT_TOKEN=YOUR_TOKEN -- /bridge/latelier-agent-bridge',
      'claude-code': '{"mcpServers":{"latelier":{"type":"stdio","env":{"LATELIER_AGENT_TOKEN":"YOUR_TOKEN"}}}}',
      'claude-desktop': '{"mcpServers":{"latelier":{"env":{"LATELIER_AGENT_TOKEN":"YOUR_TOKEN"}}}}',
      cursor: '{"mcpServers":{"latelier":{"env":{"LATELIER_AGENT_TOKEN":"YOUR_TOKEN"}}}}',
    },
    ...over,
  };
}

export function token(id: string, name: string, over: Partial<AgentTokenInfo> = {}): AgentTokenInfo {
  return { id, name, createdAt: '2026-11-01T00:00:00.000Z', ...over };
}

export function liveSession(over: Partial<AgentSessionInfo> = {}): AgentSessionInfo {
  return {
    id: 's1',
    tokenId: 't1',
    tokenName: 'laptop-claude',
    clientName: 'claude-code',
    clientVersion: '2.0.1',
    folder: '~/Projects/shop-api',
    startedAt: new Date(Date.now() - 34 * 60_000).toISOString(),
    callCount: 0,
    refusedCount: 0,
    lastCallAt: null,
    ...over,
  };
}

export interface AgentsWorkspace {
  api: IpcApi;
  prefs: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
  store: Map<string, unknown>;
  /** Pushes a new Agent Access state, as main does. */
  push: (state: AgentAccessState) => void;
}

export function mountAgentsWorkspace(
  opts: {
    state?: AgentAccessState;
    connections?: ConnectionSummary[];
    tabs?: WorkspaceTab[];
    prefs?: Record<string, unknown>;
    overrides?: Parameters<typeof installAtelierMock>[0];
  } = {},
): AgentsWorkspace {
  let state = opts.state ?? agentState();
  const listeners = new Set<(s: AgentAccessState) => void>();
  const store = new Map<string, unknown>([['ui.hints.dismissed', ALL_HINTS_DISMISSED], ...Object.entries(opts.prefs ?? {})]);
  const prefs = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : key === 'ui.workspace.builderCollapsed' ? false : null)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return value;
    }),
  };
  const tabs = opts.tabs ?? [collectionTabFixture()];
  const overrides = opts.overrides ?? {};
  const api = installAtelierMock({
    ...overrides,
    prefs: { ...prefs, ...(overrides.prefs ?? {}) } as never,
    tabs: {
      list: async () => tabs,
      setActive: async (id: string) => ({ id }),
      update: async () => tabs[0]!,
      ...(overrides.tabs ?? {}),
    } as never,
    conn: { list: async () => opts.connections ?? [connectionFixture()], ...(overrides.conn ?? {}) } as never,
    agentAccess: {
      getState: async () => state,
      onState: (cb: (s: AgentAccessState) => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      ...(overrides.agentAccess ?? {}),
    } as never,
    query: {
      find: async () => ({ documents: [], durationMs: 1, hasMore: false }),
      count: async () => ({ count: 0 }),
      ...(overrides.query ?? {}),
    } as never,
  });
  render(
    <MemoryRouter initialEntries={['/workspace']}>
      <SettingsProvider>
        <HintsProvider>
          <Workspace />
        </HintsProvider>
      </SettingsProvider>
    </MemoryRouter>,
  );
  return {
    api,
    prefs,
    store,
    push: (next) => {
      state = next;
      act(() => {
        for (const cb of listeners) cb(next);
      });
    },
  };
}
