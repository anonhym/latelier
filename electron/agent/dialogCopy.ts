import type { PrivilegeResult } from '@shared/types';
import { privilegeText } from './privilegeVerdict.ts';
import { displayName } from './safeText.ts';
import { SNIPPET_CLIENTS } from './snippets.ts';

/** The shape of an Electron `showMessageBox` call, without importing Electron into a testable module. */
export interface AgentMessageBox {
  type: 'info' | 'warning';
  buttons: string[];
  defaultId: number;
  cancelId: number;
  title: string;
  message: string;
  detail: string;
}

/** On Windows the pipe is not owner-only and the token is the only protection (X27 §4.3). Said in plain words, in every dialog that turns Agent Access or a share on. */
const WINDOWS_CAVEAT =
  "On Windows, the only protection against other users of this computer is the Agent Token. The pipe L'Atelier listens on is not limited to your account, so keep every token private.";

const withCaveat = (detail: string, platform: NodeJS.Platform): string =>
  platform === 'win32' ? `${detail}\n\n${WINDOWS_CAVEAT}` : detail;

export function enableBox(platform: NodeJS.Platform): AgentMessageBox {
  return {
    type: 'warning',
    buttons: ['Cancel', 'Turn on'],
    defaultId: 0,
    cancelId: 0,
    title: 'Turn on Agent Access?',
    message: 'Let AI Agents read your shared Connections?',
    detail: withCaveat(
      [
        "Agents are external AI tools, such as Claude Code, Claude Desktop or Cursor, that connect to L'Atelier on this computer.",
        'They can read documents, schemas and indexes from the Connections you share with them, while those Connections are open.',
        'They cannot write or delete anything, see hosts, URIs or passwords, or open a Connection.',
        'Every Agent read is recorded. For the strongest guarantee, share only Connections that use a read-only database user.',
      ].join('\n\n'),
      platform,
    ),
  };
}

export function shareBox(connectionName: string, result: PrivilegeResult, platform: NodeJS.Platform): AgentMessageBox {
  return {
    type: result.kind === 'read-only' ? 'info' : 'warning',
    buttons: ['Cancel', 'Share'],
    defaultId: 0,
    cancelId: 0,
    title: 'Share with Agents?',
    message: `Share "${displayName(connectionName)}" with Agents?`,
    detail: withCaveat(
      `${privilegeText(result)}\n\nAn Agent can read this Connection only while it is open, and you can stop sharing at any time.`,
      platform,
    ),
  };
}

export function notOpenBox(connectionName: string): AgentMessageBox {
  return {
    type: 'info',
    buttons: ['OK'],
    defaultId: 0,
    cancelId: 0,
    title: 'Open this Connection first',
    message: `Open "${displayName(connectionName)}" first`,
    detail: "L'Atelier checks the database user's privileges before it shares a Connection, and that needs the Connection to be open.",
  };
}

/** Button 0 is Done, so Escape ends the loop; 1..n copy a client's configuration. */
export const TOKEN_DONE = 0;

export function tokenBox(
  agentName: string,
  token: string,
  kind: 'added' | 'regenerated',
  /** What the last copy button did, shown above the token; null before any was pressed. */
  note: string | null,
): AgentMessageBox {
  const lines = [
    note,
    kind === 'regenerated' ? 'The previous token for this Agent no longer works.' : null,
    'Copy this token now: it is shown only once, and L\'Atelier keeps only a hash of it.',
    token,
  ];
  return {
    type: 'info',
    buttons: ['Done', ...SNIPPET_CLIENTS.map((c) => `Copy for ${c.label}`)],
    defaultId: TOKEN_DONE,
    cancelId: TOKEN_DONE,
    title: kind === 'added' ? 'Agent added' : 'Token regenerated',
    message: kind === 'added' ? `Token for "${displayName(agentName)}"` : `New token for "${displayName(agentName)}"`,
    detail: lines.filter((l): l is string => l !== null).join('\n\n'),
  };
}
