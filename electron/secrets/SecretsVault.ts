import type { Database, Statement } from 'better-sqlite3';
import { SystemError } from '../errors.ts';

/**
 * Abstraction over Electron's `safeStorage` module. Real usage passes the
 * module through; tests inject a shim so integration tests don't depend on a
 * running Electron app.
 */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plaintext: string): Buffer;
  decryptString(ciphertext: Buffer): string;
}

export type SecretField = 'password' | 'ssh_password' | 'ssh_passphrase';

export interface SecretsVaultOptions {
  /**
   * Returns the user's current opt-in to the plaintext fallback. When the OS
   * keychain is unavailable and this returns true, `set()` stores the password
   * as raw UTF-8 bytes with `is_plaintext = 1`. Defaults to always-false so
   * existing call sites get the historical behavior.
   */
  getAllowPlaintext?: () => boolean;
}

interface Row {
  ciphertext: Buffer;
  is_plaintext: number;
}

export class SecretsVault {
  private selectStmt: Statement<[string, string]>;
  private upsertStmt: Statement<[string, string, Buffer, number, string]>;
  private deleteOneStmt: Statement<[string, string]>;
  private deleteAllStmt: Statement<[string]>;
  private hasStmt: Statement<[string, string]>;
  private safeStorage: SafeStorageLike;
  private getAllowPlaintext: () => boolean;

  constructor(db: Database, safeStorage: SafeStorageLike, opts: SecretsVaultOptions = {}) {
    this.safeStorage = safeStorage;
    this.getAllowPlaintext = opts.getAllowPlaintext ?? (() => false);
    this.selectStmt = db.prepare(
      'SELECT ciphertext, is_plaintext FROM connection_secrets WHERE connection_id = ? AND field = ?',
    );
    this.upsertStmt = db.prepare(
      `INSERT INTO connection_secrets (connection_id, field, ciphertext, is_plaintext, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (connection_id, field) DO UPDATE SET
         ciphertext = excluded.ciphertext,
         is_plaintext = excluded.is_plaintext,
         updated_at = excluded.updated_at`,
    );
    this.deleteOneStmt = db.prepare(
      'DELETE FROM connection_secrets WHERE connection_id = ? AND field = ?',
    );
    this.deleteAllStmt = db.prepare(
      'DELETE FROM connection_secrets WHERE connection_id = ?',
    );
    this.hasStmt = db.prepare(
      'SELECT 1 FROM connection_secrets WHERE connection_id = ? AND field = ?',
    );
  }

  /**
   * Throws `SECRETS_UNAVAILABLE` only when the keychain is unavailable AND
   * the plaintext-fallback pref is off. With the pref on, callers can still
   * persist secrets — they just land in the database as plaintext.
   */
  assertAvailable(): void {
    if (this.safeStorage.isEncryptionAvailable()) return;
    if (this.getAllowPlaintext()) return;
    throw new SystemError(
      'SECRETS_UNAVAILABLE',
      'OS keychain not accessible on this system',
    );
  }

  set(connectionId: string, field: SecretField, plaintext: string): void {
    if (!plaintext || plaintext.length === 0) {
      this.delete(connectionId, field);
      return;
    }
    const updatedAt = new Date().toISOString();
    if (this.safeStorage.isEncryptionAvailable()) {
      const ciphertext = this.safeStorage.encryptString(plaintext);
      this.upsertStmt.run(connectionId, field, ciphertext, 0, updatedAt);
      return;
    }
    if (this.getAllowPlaintext()) {
      this.upsertStmt.run(connectionId, field, Buffer.from(plaintext, 'utf8'), 1, updatedAt);
      return;
    }
    throw new SystemError(
      'SECRETS_UNAVAILABLE',
      'OS keychain not accessible on this system',
    );
  }

  get(connectionId: string, field: SecretField): string | null {
    const row = this.selectStmt.get(connectionId, field) as Row | undefined;
    if (!row) return null;
    if (row.is_plaintext === 1) {
      return row.ciphertext.toString('utf8');
    }
    try {
      return this.safeStorage.decryptString(row.ciphertext);
    } catch (err) {
      throw new SystemError(
        'SECRET_DECRYPT_FAILED',
        'Stored secret could not be decrypted. You may need to re-enter it.',
        { cause: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  has(connectionId: string, field: SecretField): boolean {
    return this.hasStmt.get(connectionId, field) !== undefined;
  }

  delete(connectionId: string, field: SecretField): void {
    this.deleteOneStmt.run(connectionId, field);
  }

  deleteAll(connectionId: string): void {
    this.deleteAllStmt.run(connectionId);
  }
}
