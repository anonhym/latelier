import { describe, it, expect } from 'vitest';
import { failedVerdict, privilegeText, privilegeVerdict, READ_ACTIONS } from '../../electron/agent/privilegeVerdict';

const READ = ['changeStream', 'collStats', 'dbHash', 'dbStats', 'find', 'killCursors', 'listCollections', 'listIndexes', 'listSearchIndexes', 'planCacheRead'];

function reply(over: {
  users?: unknown;
  roles?: unknown;
  privileges?: unknown;
}) {
  return {
    authInfo: {
      authenticatedUsers: 'users' in over ? over.users : [{ user: 'u', db: 'shop' }],
      authenticatedUserRoles: 'roles' in over ? over.roles : [{ role: 'read', db: 'shop' }],
      authenticatedUserPrivileges: 'privileges' in over ? over.privileges : [{ resource: { db: 'shop', collection: '' }, actions: READ }],
    },
    ok: 1,
  };
}

describe('privilegeVerdict', () => {
  it('lists the read role actions and nothing else', () => {
    expect([...READ_ACTIONS].sort((a, b) => a.localeCompare(b))).toEqual(
      [...READ, 'listDatabases'].sort((a, b) => a.localeCompare(b)),
    );
  });

  it('calls a user whose every action is a read action read-only, and keeps the roles', () => {
    expect(privilegeVerdict(reply({}))).toEqual({ kind: 'read-only', roles: ['read@shop'] });
  });

  it('accepts the cluster-wide listDatabases action a readAnyDatabase user holds', () => {
    const r = reply({
      roles: [{ role: 'readAnyDatabase', db: 'admin' }],
      privileges: [
        { resource: { db: '', collection: '' }, actions: READ },
        { resource: { cluster: true }, actions: ['listDatabases'] },
      ],
    });
    expect(privilegeVerdict(r)).toEqual({ kind: 'read-only', roles: ['readAnyDatabase@admin'] });
  });

  it.each(['insert', 'update', 'remove', 'dropCollection', 'createIndex', 'anyAction', 'FIND', ''])(
    'calls a user holding the extra action %j beyond read',
    (action) => {
      const r = reply({ privileges: [{ resource: {}, actions: [...READ, action] }] });
      expect(privilegeVerdict(r).kind).toBe('beyond-read');
    },
  );

  it('finds a write action in a later privilege, not only the first', () => {
    const r = reply({
      privileges: [
        { resource: {}, actions: READ },
        { resource: {}, actions: ['find'] },
        { resource: {}, actions: ['insert'] },
      ],
    });
    expect(privilegeVerdict(r).kind).toBe('beyond-read');
  });

  it('treats a non-string action as beyond read', () => {
    expect(privilegeVerdict(reply({ privileges: [{ resource: {}, actions: ['find', 7] }] })).kind).toBe('beyond-read');
  });

  it('sorts the roles with localeCompare, drops duplicates and keeps role@db', () => {
    const r = reply({
      roles: [
        { role: 'readWrite', db: 'shop' },
        { role: 'dbAdmin', db: 'shop' },
        { role: 'readWrite', db: 'shop' },
        { role: 'dbAdmin', db: 'admin' },
      ],
      privileges: [{ resource: {}, actions: ['insert'] }],
    });
    expect(privilegeVerdict(r)).toEqual({
      kind: 'beyond-read',
      roles: ['dbAdmin@admin', 'dbAdmin@shop', 'readWrite@shop'],
    });
  });

  it('cuts a role name from the server to 64 characters', () => {
    const r = reply({ roles: [{ role: 'r'.repeat(100), db: 'd' }] });
    const { roles } = privilegeVerdict(r);
    expect(roles).toHaveLength(1);
    expect(roles[0]).toBe('r'.repeat(64));
  });

  it('takes unsafe characters out of a role and db name from the server', () => {
    const r = reply({ roles: [{ role: 'read\u202E\n', db: 'sh\u200Bop' }] });
    expect(privilegeVerdict(r).roles).toEqual(['read@sh op']);
  });

  it('skips a role entry that is not a role and db pair', () => {
    const r = reply({
      roles: [null, 'x', { role: 'a' }, { db: 'b' }, { role: 1, db: 'b' }, { role: 'a', db: 2 }, { role: 'ok', db: 'db' }],
    });
    expect(privilegeVerdict(r).roles).toEqual(['ok@db']);
  });

  it('reports no roles when the role list is absent or not an array', () => {
    expect(privilegeVerdict(reply({ roles: undefined })).roles).toEqual([]);
    expect(privilegeVerdict(reply({ roles: 'read' })).roles).toEqual([]);
  });

  it.each([
    ['empty users', { users: [], roles: [], privileges: [] }],
    ['absent users', { users: undefined }],
    ['users not an array', { users: 'u' }],
  ])('reads %s as no authenticated user, never a pass', (_name, over) => {
    expect(privilegeVerdict(reply(over))).toEqual({ kind: 'no-auth', roles: [] });
  });

  it('answers no-auth for the real reply of a server with auth off', () => {
    expect(
      privilegeVerdict({ authInfo: { authenticatedUsers: [], authenticatedUserRoles: [], authenticatedUserPrivileges: [] }, ok: 1 }),
    ).toEqual({ kind: 'no-auth', roles: [] });
  });

  it.each([
    ['no privilege list', { privileges: undefined }],
    ['an empty privilege list', { privileges: [] }],
    ['a privilege list that is not an array', { privileges: {} }],
    ['a privilege that is not an object', { privileges: [null] }],
    ['a privilege without an actions array', { privileges: [{ resource: {} }] }],
    ['actions that is not an array', { privileges: [{ resource: {}, actions: 'find' }] }],
  ])('fails closed on a signed-in user with %s, keeping the roles', (_name, over) => {
    expect(privilegeVerdict(reply(over))).toEqual({ kind: 'failed', roles: ['read@shop'], errorCode: 'UNEXPECTED_REPLY' });
  });

  it.each([null, undefined, 7, 'x', [], {}, { authInfo: null }, { authInfo: [] }, { authInfo: 'x' }])(
    'fails on a reply that is not a connectionStatus reply: %j',
    (value) => {
      expect(privilegeVerdict(value)).toEqual({ kind: 'failed', roles: [], errorCode: 'UNEXPECTED_REPLY' });
    },
  );

  it('builds a failed verdict from an error code', () => {
    expect(failedVerdict('UNAUTHORIZED')).toEqual({ kind: 'failed', roles: [], errorCode: 'UNAUTHORIZED' });
  });
});

describe('privilegeText', () => {
  it('says the user can only read', () => {
    expect(privilegeText({ kind: 'read-only', roles: ['read@shop'] })).toBe('This user can only read.');
  });

  it('says it cannot verify a server without authentication, in the spec words', () => {
    expect(privilegeText({ kind: 'no-auth', roles: [] })).toBe(
      'Cannot verify: this server does not require authentication, so anything that reaches it can write.',
    );
  });

  it('names the code of a failed check', () => {
    expect(privilegeText({ kind: 'failed', roles: [], errorCode: 'UNAUTHORIZED' })).toBe(
      "Could not check this user's privileges (error code: UNAUTHORIZED).",
    );
  });

  it('names an unknown code when the failed check has none', () => {
    expect(privilegeText({ kind: 'failed', roles: [] })).toContain('(error code: UNKNOWN)');
  });

  it('warns about a user beyond read, names the roles and recommends a read-only user', () => {
    const text = privilegeText({ kind: 'beyond-read', roles: ['dbAdmin@shop', 'readWrite@shop'] });
    expect(text).toContain('Warning: this user can do more than read');
    expect(text).toContain('roles: dbAdmin@shop, readWrite@shop)');
    expect(text).toContain('read-only database user is the stronger guarantee');
    expect(text).toContain('consider connecting with one before you share.');
    expect(text).not.toContain('more)');
  });

  it('says so when the warning has no roles to name', () => {
    expect(privilegeText({ kind: 'beyond-read', roles: [] })).toContain('(roles: none listed)');
  });

  it('names the first eight roles and counts the rest', () => {
    const roles = Array.from({ length: 11 }, (_, i) => `role${String(i).padStart(2, '0')}@d`);
    const text = privilegeText({ kind: 'beyond-read', roles });
    expect(text).toContain('role07@d, and 3 more)');
    expect(text).not.toContain('role08@d');
  });

  it('names exactly eight roles without a count', () => {
    const roles = Array.from({ length: 8 }, (_, i) => `role${i}@d`);
    const text = privilegeText({ kind: 'beyond-read', roles });
    expect(text).toContain('role7@d)');
    expect(text).not.toContain(', and ');
  });
});
