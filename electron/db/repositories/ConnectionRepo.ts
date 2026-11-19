import type { Database, Statement } from 'better-sqlite3';
import type {
  AuthMech,
  Connection,
  ConnectionInput,
  ConnType,
  ReadPref,
  SshAuth,
} from '@shared/types';
import { ConflictError } from '../../errors.ts';
import { isUniqueConstraintError } from '../sqliteErrors.ts';
import { withTransaction } from '../sqlite.ts';

/**
 * Shape of a row in the `connections` table. Keys mirror SQL columns exactly.
 */
export interface ConnectionRow {
  id: string;
  name: string;
  color: string;
  connection_type: ConnType;
  host: string;
  port: number;
  default_db: string | null;
  auth_mech: AuthMech;
  auth_username: string | null;
  auth_database: string | null;
  tls_enabled: number;
  tls_verify: number;
  tls_ca_path: string | null;
  tls_client_cert_path: string | null;
  ssh_enabled: number;
  ssh_host: string | null;
  ssh_port: number | null;
  ssh_username: string | null;
  ssh_auth_method: SshAuth | null;
  ssh_private_key_path: string | null;
  connect_timeout_ms: number;
  socket_timeout_ms: number;
  server_selection_timeout_ms: number;
  read_preference: ReadPref;
  max_pool_size: number;
  direct_connection: number;
  app_name: string | null;
  read_only: number;
  /**
   * Written only by `setShared`. Absent on a row built by `inputToRow`, and
   * never named by the insert or update statements, so an edit cannot unshare
   * and an insert relies on the column default.
   */
  share_with_agents?: number;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

export class ConnectionRepo {
  private db: Database;
  private insertStmt: Statement;
  private updateStmt: Statement;
  private deleteStmt: Statement<[string]>;
  private findByIdStmt: Statement<[string]>;
  private findByNameStmt: Statement<[string]>;
  private listStmt: Statement;
  private touchStmt: Statement<[string, string, string]>;
  private setSharedStmt: Statement<[number, string, string]>;
  private listSharedStmt: Statement;

  constructor(db: Database) {
    this.db = db;
    this.insertStmt = db.prepare(`
      INSERT INTO connections (
        id, name, color, connection_type, host, port, default_db,
        auth_mech, auth_username, auth_database,
        tls_enabled, tls_verify, tls_ca_path, tls_client_cert_path,
        ssh_enabled, ssh_host, ssh_port, ssh_username, ssh_auth_method, ssh_private_key_path,
        connect_timeout_ms, socket_timeout_ms, server_selection_timeout_ms,
        read_preference, max_pool_size, direct_connection, app_name, read_only,
        created_at, updated_at, last_used_at
      ) VALUES (
        @id, @name, @color, @connection_type, @host, @port, @default_db,
        @auth_mech, @auth_username, @auth_database,
        @tls_enabled, @tls_verify, @tls_ca_path, @tls_client_cert_path,
        @ssh_enabled, @ssh_host, @ssh_port, @ssh_username, @ssh_auth_method, @ssh_private_key_path,
        @connect_timeout_ms, @socket_timeout_ms, @server_selection_timeout_ms,
        @read_preference, @max_pool_size, @direct_connection, @app_name, @read_only,
        @created_at, @updated_at, @last_used_at
      )
    `);
    this.updateStmt = db.prepare(`
      UPDATE connections SET
        name = @name,
        color = @color,
        connection_type = @connection_type,
        host = @host,
        port = @port,
        default_db = @default_db,
        auth_mech = @auth_mech,
        auth_username = @auth_username,
        auth_database = @auth_database,
        tls_enabled = @tls_enabled,
        tls_verify = @tls_verify,
        tls_ca_path = @tls_ca_path,
        tls_client_cert_path = @tls_client_cert_path,
        ssh_enabled = @ssh_enabled,
        ssh_host = @ssh_host,
        ssh_port = @ssh_port,
        ssh_username = @ssh_username,
        ssh_auth_method = @ssh_auth_method,
        ssh_private_key_path = @ssh_private_key_path,
        connect_timeout_ms = @connect_timeout_ms,
        socket_timeout_ms = @socket_timeout_ms,
        server_selection_timeout_ms = @server_selection_timeout_ms,
        read_preference = @read_preference,
        max_pool_size = @max_pool_size,
        direct_connection = @direct_connection,
        app_name = @app_name,
        read_only = @read_only,
        updated_at = @updated_at
      WHERE id = @id
    `);
    this.deleteStmt = db.prepare('DELETE FROM connections WHERE id = ?');
    this.findByIdStmt = db.prepare('SELECT * FROM connections WHERE id = ?');
    this.findByNameStmt = db.prepare('SELECT * FROM connections WHERE name = ?');
    this.listStmt = db.prepare(
      `SELECT * FROM connections
       ORDER BY (last_used_at IS NULL) ASC, last_used_at DESC, name ASC`,
    );
    this.touchStmt = db.prepare(
      'UPDATE connections SET last_used_at = ?, updated_at = ? WHERE id = ?',
    );
    // The only statement that writes the share flag (see `ConnectionRow.share_with_agents`).
    this.setSharedStmt = db.prepare(
      'UPDATE connections SET share_with_agents = ?, updated_at = ? WHERE id = ?',
    );
    this.listSharedStmt = db.prepare(
      'SELECT * FROM connections WHERE share_with_agents = 1 ORDER BY name ASC',
    );
  }

  /** Run `fn` in one SQLite transaction; it must stay synchronous. */
  transaction<T>(fn: () => T): T {
    return withTransaction(this.db, fn);
  }

  insert(row: ConnectionRow): void {
    try {
      this.insertStmt.run(row);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictError(`connection name '${row.name}' already exists`, {
          field: 'name',
        });
      }
      throw err;
    }
  }

  update(row: ConnectionRow): void {
    try {
      const info = this.updateStmt.run(row);
      if (info.changes === 0) throw new Error('row not found for update');
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictError(`connection name '${row.name}' already exists`, {
          field: 'name',
        });
      }
      throw err;
    }
  }

  deleteById(id: string): number {
    const info = this.deleteStmt.run(id);
    return info.changes;
  }

  findById(id: string): ConnectionRow | null {
    const row = this.findByIdStmt.get(id) as ConnectionRow | undefined;
    return row ?? null;
  }

  findByName(name: string): ConnectionRow | null {
    const row = this.findByNameStmt.get(name) as ConnectionRow | undefined;
    return row ?? null;
  }

  list(): ConnectionRow[] {
    return this.listStmt.all() as ConnectionRow[];
  }

  /** Each member Connection's Family, keyed by Connection id; Connections with no Family are absent. */
  familiesByConnection(): Map<string, { familyId: string; familyName: string }> {
    const rows = this.db
      .prepare(
        `SELECT c.id AS id, f.id AS family_id, f.name AS family_name
         FROM connections c JOIN connection_families f ON f.id = c.family_id`,
      )
      .all() as Array<{ id: string; family_id: string; family_name: string }>;
    return new Map(rows.map((r) => [r.id, { familyId: r.family_id, familyName: r.family_name }]));
  }

  /** Returns whether a row matched. */
  setShared(id: string, shared: boolean): boolean {
    return this.setSharedStmt.run(shared ? 1 : 0, new Date().toISOString(), id).changes > 0;
  }

  /** Connections whose share flag is on, by name. */
  listShared(): ConnectionRow[] {
    return this.listSharedStmt.all() as ConnectionRow[];
  }

  touchLastUsed(id: string): void {
    const now = new Date().toISOString();
    this.touchStmt.run(now, now, id);
  }
}

// ─── Row ↔ Connection mappers ────────────────────────────────────────────────

export function rowToConnection(
  row: ConnectionRow,
  flags: { hasPasswordStored: boolean; hasSshPasswordStored: boolean; hasSshPassphraseStored: boolean },
): Connection {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    connectionType: row.connection_type,
    host: row.host,
    port: row.port,
    defaultDb: row.default_db ?? undefined,
    authMech: row.auth_mech,
    authUsername: row.auth_username ?? undefined,
    authDatabase: row.auth_database ?? undefined,
    tls: {
      enabled: row.tls_enabled === 1,
      verify: row.tls_verify === 1,
      caPath: row.tls_ca_path ?? undefined,
      clientCertPath: row.tls_client_cert_path ?? undefined,
    },
    ssh: {
      enabled: row.ssh_enabled === 1,
      host: row.ssh_host ?? undefined,
      port: row.ssh_port ?? undefined,
      username: row.ssh_username ?? undefined,
      authMethod: row.ssh_auth_method ?? undefined,
      privateKeyPath: row.ssh_private_key_path ?? undefined,
    },
    advanced: {
      connectTimeoutMs: row.connect_timeout_ms,
      socketTimeoutMs: row.socket_timeout_ms,
      serverSelectionTimeoutMs: row.server_selection_timeout_ms,
      readPreference: row.read_preference,
      maxPoolSize: row.max_pool_size,
      directConnection: row.direct_connection === 1,
      appName: row.app_name ?? undefined,
    },
    hasPasswordStored: flags.hasPasswordStored,
    hasSshPasswordStored: flags.hasSshPasswordStored,
    hasSshPassphraseStored: flags.hasSshPassphraseStored,
    readOnly: row.read_only === 1,
    shareWithAgents: row.share_with_agents === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at ?? undefined,
  };
}

export function inputToRow(id: string, input: ConnectionInput, now: string): ConnectionRow {
  return {
    id,
    name: input.name,
    color: input.color,
    connection_type: input.connectionType,
    host: input.host,
    port: input.port,
    default_db: input.defaultDb ?? null,
    auth_mech: input.authMech,
    auth_username: input.authUsername ?? null,
    auth_database: input.authDatabase ?? null,
    tls_enabled: input.tls.enabled ? 1 : 0,
    tls_verify: input.tls.verify ? 1 : 0,
    tls_ca_path: input.tls.caPath ?? null,
    tls_client_cert_path: input.tls.clientCertPath ?? null,
    ssh_enabled: input.ssh?.enabled ? 1 : 0,
    ssh_host: input.ssh?.host ?? null,
    ssh_port: input.ssh?.port ?? null,
    ssh_username: input.ssh?.username ?? null,
    ssh_auth_method: input.ssh?.authMethod ?? null,
    ssh_private_key_path: input.ssh?.privateKeyPath ?? null,
    connect_timeout_ms: input.advanced.connectTimeoutMs,
    socket_timeout_ms: input.advanced.socketTimeoutMs,
    server_selection_timeout_ms: input.advanced.serverSelectionTimeoutMs,
    read_preference: input.advanced.readPreference,
    max_pool_size: input.advanced.maxPoolSize,
    direct_connection: input.advanced.directConnection ? 1 : 0,
    app_name: input.advanced.appName ?? null,
    read_only: input.readOnly ? 1 : 0,
    created_at: now,
    updated_at: now,
    last_used_at: null,
  };
}

/**
 * What a Connection is, to a server: the fields `mongoRelevantFieldsChanged`
 * compares, as one string. A share granted to Agents is a grant to this
 * identity, so a caller that holds a grant across an `await` compares this
 * before and after. Passwords live in the vault and are not part of it.
 */
export function connectionIdentityFingerprint(row: ConnectionRow): string {
  return JSON.stringify([
    row.connection_type,
    row.host,
    row.port,
    row.default_db,
    row.auth_mech,
    row.auth_username,
    row.auth_database,
    row.tls_enabled,
    row.tls_verify,
    row.tls_ca_path,
    row.tls_client_cert_path,
    row.connect_timeout_ms,
    row.socket_timeout_ms,
    row.server_selection_timeout_ms,
    row.max_pool_size,
    row.read_preference,
    row.direct_connection,
  ]);
}

/**
 * Subset of input fields that, when changed on an existing connection, require
 * disconnecting the pool so the new config takes effect next connect.
 */
export function mongoRelevantFieldsChanged(
  existing: ConnectionRow,
  patch: ConnectionInput,
): boolean {
  if (existing.connection_type !== patch.connectionType) return true;
  if (existing.host !== patch.host) return true;
  if (existing.port !== patch.port) return true;
  if (existing.default_db !== (patch.defaultDb ?? null)) return true;
  if (existing.auth_mech !== patch.authMech) return true;
  if (existing.auth_username !== (patch.authUsername ?? null)) return true;
  if (existing.auth_database !== (patch.authDatabase ?? null)) return true;
  if ((existing.tls_enabled === 1) !== patch.tls.enabled) return true;
  if ((existing.tls_verify === 1) !== patch.tls.verify) return true;
  if (existing.tls_ca_path !== (patch.tls.caPath ?? null)) return true;
  if (existing.tls_client_cert_path !== (patch.tls.clientCertPath ?? null)) return true;
  if (existing.connect_timeout_ms !== patch.advanced.connectTimeoutMs) return true;
  if (existing.socket_timeout_ms !== patch.advanced.socketTimeoutMs) return true;
  if (existing.server_selection_timeout_ms !== patch.advanced.serverSelectionTimeoutMs)
    return true;
  if (existing.max_pool_size !== patch.advanced.maxPoolSize) return true;
  if (existing.read_preference !== patch.advanced.readPreference) return true;
  if ((existing.direct_connection === 1) !== patch.advanced.directConnection) return true;
  return false;
}
