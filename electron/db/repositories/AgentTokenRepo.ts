import type { Database, Statement } from 'better-sqlite3';
import { ConflictError } from '../../errors.ts';
import { isUniqueConstraintError } from '../sqliteErrors.ts';

export interface AgentTokenRow {
  id: string;
  name: string;
  token_hash: string;
  created_at: string;
  last_used_at: string | null;
}

/** Named Agent Tokens, by hash only: the plaintext token never reaches this class. */
export class AgentTokenRepo {
  private insertStmt: Statement;
  private updateHashStmt: Statement<[string, string]>;
  private deleteStmt: Statement<[string]>;
  private findByIdStmt: Statement<[string]>;
  private listStmt: Statement;
  private touchStmt: Statement<[string, string]>;

  constructor(db: Database) {
    this.insertStmt = db.prepare(
      `INSERT INTO agent_tokens (id, name, token_hash, created_at, last_used_at)
       VALUES (@id, @name, @token_hash, @created_at, @last_used_at)`,
    );
    this.updateHashStmt = db.prepare('UPDATE agent_tokens SET token_hash = ?, last_used_at = NULL WHERE id = ?');
    this.deleteStmt = db.prepare('DELETE FROM agent_tokens WHERE id = ?');
    this.findByIdStmt = db.prepare('SELECT * FROM agent_tokens WHERE id = ?');
    this.listStmt = db.prepare('SELECT * FROM agent_tokens ORDER BY created_at ASC, rowid ASC');
    this.touchStmt = db.prepare('UPDATE agent_tokens SET last_used_at = ? WHERE id = ?');
  }

  insert(row: AgentTokenRow): void {
    try {
      this.insertStmt.run(row);
    } catch (err) {
      // token_hash is UNIQUE: only a hash collision (or a repeated hash) lands here.
      if (isUniqueConstraintError(err)) throw new ConflictError('token already exists');
      throw err;
    }
  }

  /** Replaces the hash, so the old token stops matching at once. Returns whether a row matched. */
  replaceHash(id: string, tokenHash: string): boolean {
    return this.updateHashStmt.run(tokenHash, id).changes > 0;
  }

  deleteById(id: string): boolean {
    return this.deleteStmt.run(id).changes > 0;
  }

  findById(id: string): AgentTokenRow | null {
    return (this.findByIdStmt.get(id) as AgentTokenRow | undefined) ?? null;
  }

  list(): AgentTokenRow[] {
    return this.listStmt.all() as AgentTokenRow[];
  }

  touchLastUsed(id: string, at: string): void {
    this.touchStmt.run(at, id);
  }
}
