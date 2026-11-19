import type { PrivilegeResult } from '@shared/types';
import { displayName } from './safeText.ts';

/**
 * The actions of MongoDB's built-in `read` role. A database user is read-only
 * for X27's purposes only when every action it holds is in this set. Anything
 * else, including an action a future server adds, reads as "beyond read": the
 * check fails closed, and a warning is the worst a false alarm can cost.
 */
export const READ_ACTIONS: ReadonlySet<string> = new Set([
  'find',
  'listCollections',
  'listIndexes',
  'listSearchIndexes',
  'collStats',
  'dbStats',
  'dbHash',
  'killCursors',
  'changeStream',
  'planCacheRead',
  'listDatabases',
]);

/** A role name comes from the server, so it is cut before it goes into a dialog. */
const MAX_ROLE_CHARS = 64;
/** The dialog names this many roles and counts the rest. */
const MAX_ROLES_SHOWN = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rolesOf(authInfo: Record<string, unknown>): string[] {
  const raw = authInfo.authenticatedUserRoles;
  if (!Array.isArray(raw)) return [];
  const names = new Set<string>();
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.role !== 'string' || typeof entry.db !== 'string') continue;
    // Role names are chosen by whoever runs the server and are printed in a dialog.
    names.add(`${displayName(entry.role, MAX_ROLE_CHARS)}@${displayName(entry.db, MAX_ROLE_CHARS)}`.slice(0, MAX_ROLE_CHARS));
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** The command did not run, or its reply could not be read. Never a pass. */
export function failedVerdict(errorCode: string): PrivilegeResult {
  return { kind: 'failed', roles: [], errorCode };
}

/**
 * Reads a `connectionStatus` reply (run with `showPrivileges: true`) into the
 * share dialog's verdict (X27 §3.3). A server with auth off answers with no
 * authenticated user, which is `no-auth`: it is never shown as a pass.
 */
export function privilegeVerdict(reply: unknown): PrivilegeResult {
  if (!isRecord(reply) || !isRecord(reply.authInfo)) return failedVerdict('UNEXPECTED_REPLY');
  const authInfo = reply.authInfo;
  const users = authInfo.authenticatedUsers;
  if (!Array.isArray(users) || users.length === 0) return { kind: 'no-auth', roles: [] };

  const roles = rolesOf(authInfo);
  const privileges = authInfo.authenticatedUserPrivileges;
  // A signed-in user with no readable privilege list cannot be called read-only.
  if (!Array.isArray(privileges) || privileges.length === 0) {
    return { kind: 'failed', roles, errorCode: 'UNEXPECTED_REPLY' };
  }
  let beyondRead = false;
  for (const privilege of privileges) {
    if (!isRecord(privilege) || !Array.isArray(privilege.actions)) {
      return { kind: 'failed', roles, errorCode: 'UNEXPECTED_REPLY' };
    }
    for (const action of privilege.actions) {
      // `Set.has` is false for anything that is not one of its strings, so a non-string action is beyond read too.
      if (!READ_ACTIONS.has(action as string)) beyondRead = true;
    }
  }
  return { kind: beyondRead ? 'beyond-read' : 'read-only', roles };
}

/** The four §3.3 texts, as the share dialog shows them. */
export function privilegeText(result: PrivilegeResult): string {
  switch (result.kind) {
    case 'read-only':
      return 'This user can only read.';
    case 'beyond-read': {
      const shown = result.roles.slice(0, MAX_ROLES_SHOWN);
      const more = result.roles.length - shown.length;
      const named = shown.length === 0 ? 'none listed' : shown.join(', ') + (more > 0 ? `, and ${more} more` : '');
      return (
        `Warning: this user can do more than read (roles: ${named}). ` +
        "An Agent can only read through L'Atelier, but a read-only database user is the stronger guarantee: " +
        'consider connecting with one before you share.'
      );
    }
    case 'no-auth':
      return 'Cannot verify: this server does not require authentication, so anything that reaches it can write.';
    case 'failed':
      return `Could not check this user's privileges (error code: ${result.errorCode ?? 'UNKNOWN'}).`;
  }
}
