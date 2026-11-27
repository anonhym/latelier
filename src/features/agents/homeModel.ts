import type { AgentAccessState, AgentCallSummary, ConnectionSummary, PrivilegeResult } from '@shared/types';
import { ago } from './agentsTime';

/** "Used now by" counts the live sessions that called a Connection within this window (X30 §5.1). */
export const USED_NOW_WINDOW_MS = 5 * 60_000;

/** The X27 §16.5 refused bucket: every outcome but `ok` and a paused call's `INPUT_REQUIRED`. */
export function isRefusedOutcome(outcome: string): boolean {
  return outcome !== 'ok' && outcome !== 'INPUT_REQUIRED';
}

/** Home's one status line (X30 §5.1). */
export function homeStatusLine(state: Pick<AgentAccessState, 'enabled' | 'bridgeInstalled' | 'sessions'>): string {
  if (!state.enabled) return 'Agent Access is off';
  if (!state.bridgeInstalled) return 'Bridge not installed';
  const n = state.sessions.length;
  if (n === 0) return 'Agent Access is on · no live sessions';
  const agents = new Set(state.sessions.map((s) => s.tokenId)).size;
  return `Agent Access is on · ${n} live ${n === 1 ? 'session' : 'sessions'} from ${agents} ${agents === 1 ? 'Agent' : 'Agents'}`;
}

export type SetupStepId = 'enable' | 'share' | 'connect';

export interface SetupStep {
  id: SetupStepId;
  label: string;
  done: boolean;
}

/**
 * The first-run checklist, each step ticked from real state. It is shown
 * while any step is not done, so turning Agent Access off later brings it
 * back with the other two still ticked.
 */
export function setupSteps(input: { enabled: boolean; anyShared: boolean; anySessionEver: boolean }): SetupStep[] {
  return [
    { id: 'enable', label: 'Turn on Agent Access', done: input.enabled },
    { id: 'share', label: 'Share a Connection', done: input.anyShared },
    { id: 'connect', label: 'Connect an Agent', done: input.anySessionEver },
  ];
}

export function showSetup(steps: readonly SetupStep[]): boolean {
  return steps.some((s) => !s.done);
}

/** What the Agent Read Log says about one Connection: its last call and who called it lately. */
export interface ConnectionActivity {
  lastAt: string;
  lastOutcome: string;
  /** Session id → its newest call on this Connection. */
  recent: Map<string, string>;
}

/**
 * Folds Read Log rows (any order) into one record per Connection. Rows
 * with no Connection are skipped. Folding new rows into an existing map
 * keeps the newest of each.
 */
export function foldActivity(
  rows: ReadonlyArray<Pick<AgentCallSummary, 'connectionId' | 'sessionId' | 'ts' | 'outcome'>>,
  into: ReadonlyMap<string, ConnectionActivity> = new Map(),
): Map<string, ConnectionActivity> {
  const out = new Map<string, ConnectionActivity>();
  for (const [id, a] of into) out.set(id, { ...a, recent: new Map(a.recent) });
  for (const row of rows) {
    if (!row.connectionId) continue;
    let a = out.get(row.connectionId);
    if (!a) {
      a = { lastAt: row.ts, lastOutcome: row.outcome, recent: new Map() };
      out.set(row.connectionId, a);
    } else if (row.ts > a.lastAt) {
      a.lastAt = row.ts;
      a.lastOutcome = row.outcome;
    }
    if (row.sessionId) {
      const seen = a.recent.get(row.sessionId);
      if (seen === undefined || row.ts > seen) a.recent.set(row.sessionId, row.ts);
    }
  }
  return out;
}

export type StatusTone = 'ok' | 'warn' | 'neutral';

export interface ConnectionRow {
  id: string;
  name: string;
  shared: boolean;
  open: boolean;
  status: string;
  tone: StatusTone;
  privilege: PrivilegeResult | undefined;
  /** The Agents that asked for it while it was closed; non-empty tints the row. */
  askedBy: string[];
  usedNowBy: string;
  lastCall: string;
  /** Open, on a shared Connection that is not open. */
  showOpen: boolean;
}

function statusOf(shared: boolean, open: boolean): { status: string; tone: StatusTone } {
  if (shared) return open ? { status: 'Open · reachable', tone: 'ok' } : { status: 'Not open', tone: 'warn' };
  return { status: open ? 'Open · not shared' : 'Closed · not shared', tone: 'neutral' };
}

/** "2 sessions · laptop-claude, cursor-work" for the live sessions that called within the window, else "—". */
export function usedNowText(
  activity: ConnectionActivity | undefined,
  live: ReadonlyArray<{ id: string; tokenName: string }>,
  now: number,
): string {
  if (!activity) return '—';
  const callers = live.filter((s) => {
    const at = activity.recent.get(s.id);
    return at !== undefined && now - new Date(at).getTime() <= USED_NOW_WINDOW_MS;
  });
  if (callers.length === 0) return '—';
  const names = [...new Set(callers.map((s) => s.tokenName))].sort((a, b) => a.localeCompare(b));
  return `${callers.length} ${callers.length === 1 ? 'session' : 'sessions'} · ${names.join(', ')}`;
}

/** "2m ago", "refused · 2m ago", or "never". */
export function lastCallText(activity: ConnectionActivity | undefined, now: number): string {
  if (!activity) return 'never';
  const when = ago(activity.lastAt, now);
  return isRefusedOutcome(activity.lastOutcome) ? `refused · ${when}` : when;
}

/**
 * Home's table (X30 §5.1): every saved Connection, shared ones first, then by
 * name. A Connection is open only when it is `connected`.
 */
export function connectionRows(input: {
  connections: ReadonlyArray<Pick<ConnectionSummary, 'id' | 'name' | 'status' | 'shareWithAgents'>>;
  state: Pick<AgentAccessState, 'privilege' | 'sessions' | 'connectionRequests'>;
  activity: ReadonlyMap<string, ConnectionActivity>;
  now: number;
}): ConnectionRow[] {
  const { connections, state, activity, now } = input;
  return [...connections]
    .sort((a, b) => {
      const byShare = Number(!!b.shareWithAgents) - Number(!!a.shareWithAgents);
      return byShare !== 0 ? byShare : a.name.localeCompare(b.name);
    })
    .map((c) => {
      const shared = !!c.shareWithAgents;
      const open = c.status === 'connected';
      const askedBy = [
        ...new Set(state.connectionRequests.filter((r) => r.connectionId === c.id).map((r) => r.tokenName ?? 'an Agent')),
      ];
      const a = activity.get(c.id);
      return {
        id: c.id,
        name: c.name,
        shared,
        open,
        ...statusOf(shared, open),
        privilege: state.privilege[c.id],
        askedBy,
        usedNowBy: usedNowText(a, state.sessions, now),
        lastCall: lastCallText(a, now),
        showOpen: shared && !open,
      };
    });
}

/** The pill a privilege result reads as in the table (X27 §3.3). */
export function privilegePill(result: PrivilegeResult | undefined): { label: string; tone: StatusTone } | null {
  if (!result) return null;
  if (result.kind === 'read-only') return { label: 'read-only', tone: 'ok' };
  if (result.kind === 'beyond-read') return { label: 'can write', tone: 'warn' };
  return { label: 'cannot verify', tone: 'warn' };
}
