import type {
  AuthMechanism,
  RoleInfo,
  UserCreateInput,
  UserDropInput,
  UserInfo,
  UserRoleRef,
  UserUpdateInput,
} from '@shared/types';
import { ejsonParse, ejsonStringify } from './ejson.ts';
import { classifyMongoOpError } from './errors.ts';
import { ValidationError } from '../errors.ts';
import type { MongoPool } from './MongoPool.ts';
import { QUERY_TIMEOUT_MS, STATS_TIMEOUT_MS } from './timeouts.ts';

const USERNAME_MAX = 128;
const PASSWORD_MAX = 4096;

const PASSWORD_MECHANISMS: AuthMechanism[] = ['SCRAM-SHA-1', 'SCRAM-SHA-256'];

interface RawUser {
  _id?: string;
  user: string;
  db: string;
  mechanisms?: string[];
  roles?: Array<{ role: string; db: string }>;
  customData?: unknown;
}

interface RawRole {
  role: string;
  db: string;
  isBuiltin?: boolean;
  inheritedRoles?: Array<{ role: string; db: string }>;
}

export class UserService {
  private pool: MongoPool;

  constructor(pool: MongoPool) {
    this.pool = pool;
  }

  async list(input: { connectionId: string; dbName?: string }): Promise<UserInfo[]> {
    const client = await this.pool.readClient(input.connectionId);
    const db = client.db(input.dbName ?? 'admin');
    // One database is a fixed-cost catalog read; `forAllDBs` enumerates every
    // user across every database, so its cost scales with the deployment and
    // it gets the interactive budget instead.
    const cmd: Record<string, unknown> = input.dbName
      ? { usersInfo: 1, showCredentials: false, maxTimeMS: STATS_TIMEOUT_MS }
      : { usersInfo: { forAllDBs: true }, showCredentials: false, maxTimeMS: QUERY_TIMEOUT_MS };
    try {
      const res = (await db.command(cmd)) as { users?: RawUser[] };
      return (res.users ?? []).map(toUserInfo);
    } catch (err) {
      throw classifyMongoOpError(err);
    }
  }

  async get(input: {
    connectionId: string;
    dbName: string;
    username: string;
  }): Promise<UserInfo> {
    const client = await this.pool.readClient(input.connectionId);
    const db = client.db(input.dbName);
    try {
      const res = (await db.command({
        usersInfo: { user: input.username, db: input.dbName },
        showCredentials: false,
        maxTimeMS: STATS_TIMEOUT_MS,
      })) as { users?: RawUser[] };
      const row = (res.users ?? [])[0];
      if (!row) {
        throw classifyMongoOpError(
          Object.assign(new Error(`user "${input.username}" not found`), {
            code: 11,
            codeName: 'UserNotFound',
          }),
        );
      }
      return toUserInfo(row);
    } catch (err) {
      throw classifyMongoOpError(err);
    }
  }

  async create(input: UserCreateInput): Promise<{ ok: true }> {
    const w = this.pool.write(input.connectionId);
    validateUsername(input.username);
    validatePassword(input.password);
    validateRoles(input.roles);
    const customData = input.customData
      ? parseEjsonField(input.customData, 'customData')
      : undefined;
    const client = await w.client();
    const db = client.db(input.dbName);
    try {
      const cmd: Record<string, unknown> = {
        createUser: input.username,
        pwd: input.password,
        roles: input.roles,
        mechanisms: input.mechanisms ?? ['SCRAM-SHA-256'],
        maxTimeMS: STATS_TIMEOUT_MS,
      };
      if (customData !== undefined) cmd.customData = customData;
      await db.command(cmd);
      return { ok: true };
    } catch (err) {
      throw classifyMongoOpError(err);
    }
  }

  async update(input: UserUpdateInput): Promise<{ ok: true }> {
    const w = this.pool.write(input.connectionId);
    const { username, dbName, patch } = input;
    const cmd: Record<string, unknown> = { updateUser: username };
    if (patch.password !== undefined) {
      validatePassword(patch.password);
      cmd.pwd = patch.password;
    }
    if (patch.roles !== undefined) {
      validateRoles(patch.roles);
      cmd.roles = patch.roles;
    }
    if (patch.mechanisms !== undefined) {
      cmd.mechanisms = patch.mechanisms;
    }
    if (patch.customData !== undefined) {
      cmd.customData = parseEjsonField(patch.customData, 'customData');
    }
    if (Object.keys(cmd).length === 1) {
      throw new ValidationError('patch is empty', { username });
    }
    // Added after the empty-patch check above, which counts cmd's own keys
    // to detect a no-op patch — maxTimeMS must not count toward that.
    cmd.maxTimeMS = STATS_TIMEOUT_MS;
    const client = await w.client();
    try {
      await client.db(dbName).command(cmd);
      return { ok: true };
    } catch (err) {
      throw classifyMongoOpError(err);
    }
  }

  async drop(input: UserDropInput): Promise<{ dropped: true }> {
    const w = this.pool.write(input.connectionId);
    const client = await w.client();
    try {
      await client.db(input.dbName).command({ dropUser: input.username, maxTimeMS: STATS_TIMEOUT_MS });
      return { dropped: true };
    } catch (err) {
      throw classifyMongoOpError(err);
    }
  }

  async listRoles(input: { connectionId: string; dbName: string }): Promise<RoleInfo[]> {
    const client = await this.pool.readClient(input.connectionId);
    const db = client.db(input.dbName);
    try {
      const res = (await db.command({
        rolesInfo: 1,
        showBuiltinRoles: true,
        maxTimeMS: STATS_TIMEOUT_MS,
      })) as { roles?: RawRole[] };
      return (res.roles ?? []).map(toRoleInfo);
    } catch (err) {
      throw classifyMongoOpError(err);
    }
  }
}

export function toUserInfo(raw: RawUser): UserInfo {
  const mechanisms = (raw.mechanisms ?? []).filter(isAuthMechanism);
  const roles: UserRoleRef[] = (raw.roles ?? []).map((r) => ({ role: r.role, db: r.db }));
  const external =
    mechanisms.length > 0 && mechanisms.every((m) => !PASSWORD_MECHANISMS.includes(m));
  const info: UserInfo = {
    db: raw.db,
    username: raw.user,
    mechanisms,
    roles,
    external,
  };
  if (raw.customData !== undefined) {
    info.customData = ejsonStringify(raw.customData);
  }
  return info;
}

export function toRoleInfo(raw: RawRole): RoleInfo {
  return {
    role: raw.role,
    db: raw.db,
    isBuiltin: Boolean(raw.isBuiltin),
    inheritedRoles: (raw.inheritedRoles ?? []).map((r) => ({ role: r.role, db: r.db })),
  };
}

export function validateUsername(name: string): void {
  if (typeof name !== 'string' || name.length === 0) {
    throw new ValidationError('username is required', { field: 'username' });
  }
  if (name.length > USERNAME_MAX) {
    throw new ValidationError(`username exceeds ${USERNAME_MAX} characters`, {
      field: 'username',
    });
  }
  if (name.includes('\x00')) {
    throw new ValidationError('username cannot contain a NUL byte', { field: 'username' });
  }
}

export function validatePassword(pw: string): void {
  if (typeof pw !== 'string' || pw.length === 0) {
    throw new ValidationError('password cannot be empty', { field: 'password' });
  }
  if (pw.length > PASSWORD_MAX) {
    throw new ValidationError(`password exceeds ${PASSWORD_MAX} characters`, {
      field: 'password',
    });
  }
}

export function validateRoles(roles: UserRoleRef[]): void {
  if (!Array.isArray(roles) || roles.length === 0) {
    throw new ValidationError('at least one role is required', { field: 'roles' });
  }
  for (const r of roles) {
    if (!r.role || !r.db) {
      throw new ValidationError('each role requires both a role name and a db', {
        field: 'roles',
      });
    }
  }
}

function parseEjsonField(s: string, field: string): unknown {
  try {
    return ejsonParse(s);
  } catch (err) {
    throw new ValidationError(`${field}: invalid EJSON`, {
      field,
      reason: (err as Error).message,
    });
  }
}

function isAuthMechanism(s: string): s is AuthMechanism {
  return (
    s === 'SCRAM-SHA-1' ||
    s === 'SCRAM-SHA-256' ||
    s === 'MONGODB-X509' ||
    s === 'PLAIN' ||
    s === 'GSSAPI' ||
    s === 'MONGODB-AWS' ||
    s === 'MONGODB-OIDC'
  );
}
