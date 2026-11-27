import type { PrivilegeResult } from '@shared/types';

/** The user-facing strings Agent Access shares across screens (X27 §1, X30), in one place so the terms never drift. */
export const AGENT_ACCESS_COPY = {
  switchLabel: 'Agent Access',
  removeBridge: 'Remove bridge',
  windowsCaveat: 'On Windows the Agent Bridge talks through a named pipe, which any process of your user account can open. The token is what keeps other programs out.',
  notChecked: 'Not checked this session',
  shareAction: 'Share with Agents…',
  stopShareAction: 'Stop sharing with Agents',
  sharedBadge: 'Shared with Agents',
  openFirst: 'Open this Connection first',
} as const;

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
