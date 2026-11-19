import type { PrivilegeResult } from '@shared/types';

/** Every user-facing string of Agent Access (X27 §1, §12), in one place so the terms never drift. */
export const AGENT_ACCESS_COPY = {
  sectionLabel: 'Agent Access',
  switchLabel: 'Agent Access',
  intro: 'Let Agents you run on this computer read the Connections you share with them.',
  connectable: 'Agents can connect',
  canTitle: 'What Agents can do',
  can: ['Read from Connections that are Shared with Agents.', 'Run read-only tools: list, find, count and aggregate.'],
  cannotTitle: 'What Agents cannot do',
  cannot: ['Write, update or delete anything.', 'See saved credentials or connection strings.', 'Open a Connection that is not already open.'],
  readOnlyAdvice: 'Share a Connection that uses a read-only database user.',
  addAgent: 'Add Agent',
  agentNameLabel: 'Agent name',
  addConfirm: 'Add',
  noTokens: 'No Agents yet. Add one to get a token.',
  tokenHint: 'A token is shown once, in a separate window, when you add or regenerate an Agent.',
  removeBridge: 'Remove bridge',
  removeBridgeHint: 'Deletes the Agent Bridge copied for this user.',
  windowsCaveat: 'On Windows the Agent Bridge talks through a named pipe, which any process of your user account can open. The token is what keeps other programs out.',
  notChecked: 'Not checked this session',
  shareAction: 'Share with Agents…',
  stopShareAction: 'Stop sharing with Agents',
  sharedBadge: 'Shared with Agents',
} as const;

export function readCountText(n: number): string {
  return `${n} Agent ${n === 1 ? 'read' : 'reads'} this session`;
}

/** The status bar's accessible name (the visible text is the short `Agents · N`). */
export function indicatorLabel(n: number): string {
  return `Agent Access: ${n} ${n === 1 ? 'read' : 'reads'} this session`;
}

export function privilegeText(result: PrivilegeResult | undefined): string {
  if (!result) return AGENT_ACCESS_COPY.notChecked;
  switch (result.kind) {
    case 'read-only':
      return 'This user can only read.';
    case 'beyond-read':
      return `This user can do more than read${result.roles.length > 0 ? `: ${result.roles.join(', ')}` : ''}. Use a read-only database user.`;
    case 'no-auth':
      return 'Cannot verify: this server does not require authentication, so anything that reaches it can write.';
    case 'failed':
      return `Could not check this user's privileges${result.errorCode ? ` (${result.errorCode})` : ''}.`;
  }
}
