import type { Database, Statement } from 'better-sqlite3';
import type { AgentSessionEndReason, AgentSessionsQuery } from '@shared/types';
import type { Logger } from '../../log.ts';
import { REFUSED_OUTCOME_SQL, sessionsFilter } from '../../agent/callQuery.ts';
import type { ColumnCipher } from '../columnCipher.ts';
import { openListedCell } from './listedCell.ts';

export interface AgentSessionEntry {
  id: string;
  tokenId: string;
  tokenName: string;
  clientName: string | null;
  clientVersion: string | null;
  /** Already cleaned by the caller (`cleanFolder`); sealed here. */
  folder: string | null;
  startedAt: string;
}

/** A stored session with its folder opened (cleaned, not yet in display form) and its call counts. */
export interface StoredAgentSession {
  id: string;
  tokenId: string | null;
  tokenName: string | null;
  clientName: string | null;
  clientVersion: string | null;
  folder: string | null;
  startedAt: string;
  endedAt: string | null;
  endReason: AgentSessionEndReason | null;
  callCount: number;
  refusedCount: number;
  lastCallAt: string | null;
}

interface SessionDbRow {
  id: string;
  token_id: string | null;
  token_name: string | null;
  client_name: string | null;
  client_version: string | null;
  folder: Buffer | null;
  started_at: string;
  ended_at: string | null;
  end_reason: AgentSessionEndReason | null;
  call_count: number;
  refused_count: number;
  last_call_at: string | null;
}

// A paused call writes an asking-round row and a retry row; only the retry is a call.
const COUNTS = `
  (SELECT COUNT(*) FROM agent_read_log l WHERE l.session_id = s.id AND l.outcome <> 'INPUT_REQUIRED') AS call_count,
  (SELECT COUNT(*) FROM agent_read_log l WHERE l.session_id = s.id AND l.${REFUSED_OUTCOME_SQL}) AS refused_count,
  (SELECT MAX(l.ts) FROM agent_read_log l WHERE l.session_id = s.id AND l.outcome <> 'INPUT_REQUIRED') AS last_call_at`;

/**
 * Agent sessions (X27 §16.2). A row is written when a session is first
 * counted and closed once, with the reason it ended. Only `folder` is sealed:
 * it names the OS user and their projects.
 */
export class AgentSessionRepo {
  private db: Database;
  private cipher: ColumnCipher;
  private log: Pick<Logger, 'warn'> | undefined;
  private insertStmt: Statement;
  private setClientInfoStmt: Statement<[string | null, string | null, string]>;
  private closeStmt: Statement<[string, AgentSessionEndReason, string]>;
  private closeOrphansStmt: Statement<[string]>;
  private deleteEndedStmt: Statement<[number]>;
  private findStmt: Statement<[string]>;
  private listStmts = new Map<string, Statement>();

  constructor(db: Database, cipher: ColumnCipher, log?: Pick<Logger, 'warn'>) {
    this.db = db;
    this.cipher = cipher;
    this.log = log;
    this.insertStmt = db.prepare(`
      INSERT INTO agent_sessions (id, token_id, token_name, client_name, client_version, folder, started_at)
      VALUES (@id, @token_id, @token_name, @client_name, @client_version, @folder, @started_at)
    `);
    this.setClientInfoStmt = db.prepare(
      'UPDATE agent_sessions SET client_name = ?, client_version = ? WHERE id = ? AND client_name IS NULL AND client_version IS NULL',
    );
    this.closeStmt = db.prepare('UPDATE agent_sessions SET ended_at = ?, end_reason = ? WHERE id = ? AND ended_at IS NULL');
    this.closeOrphansStmt = db.prepare("UPDATE agent_sessions SET ended_at = ?, end_reason = 'unknown' WHERE ended_at IS NULL");
    // julianday rather than a text comparison, as in AgentReadLogRepo. A live session has no ended_at and is never matched.
    this.deleteEndedStmt = db.prepare(
      "DELETE FROM agent_sessions WHERE ended_at IS NOT NULL AND julianday(ended_at) < julianday('now', '-' || ? || ' days')",
    );
    this.findStmt = db.prepare(`SELECT s.*, ${COUNTS} FROM agent_sessions s WHERE s.id = ?`);
  }

  /** Throws when the row cannot be written: the caller then refuses the session. */
  insert(entry: AgentSessionEntry): void {
    this.insertStmt.run({
      id: entry.id,
      token_id: entry.tokenId,
      token_name: entry.tokenName,
      client_name: entry.clientName,
      client_version: entry.clientVersion,
      folder: entry.folder === null ? null : this.cipher.seal('agent_sessions', 'folder', entry.id, entry.folder),
      started_at: entry.startedAt,
    });
  }

  /** Writes the client info once: a row that already has any keeps it. True when it was written. */
  setClientInfoOnce(id: string, clientName: string | null, clientVersion: string | null): boolean {
    return this.setClientInfoStmt.run(clientName, clientVersion, id).changes > 0;
  }

  /** Closes a live session. A session already closed keeps its first reason. True when this call closed it. */
  close(id: string, endedAt: string, reason: AgentSessionEndReason): boolean {
    return this.closeStmt.run(endedAt, reason, id).changes > 0;
  }

  /** Closes every row a crash left open, as `unknown`. Returns how many. */
  closeOrphans(endedAt: string): number {
    return this.closeOrphansStmt.run(endedAt).changes;
  }

  /** Deletes sessions that ended more than `days` days ago. Live sessions are never deleted. */
  deleteEndedOlderThan(days: number): number {
    return this.deleteEndedStmt.run(days).changes;
  }

  findById(id: string): StoredAgentSession | null {
    const row = this.findStmt.get(id) as SessionDbRow | undefined;
    if (!row) return null;
    return this.toStored(row, row.folder === null ? null : this.cipher.open('agent_sessions', 'folder', row.id, row.folder));
  }

  /** Newest first on `(started_at, id)`, keyset-paged. A folder that cannot be opened reads as none. */
  list(query: AgentSessionsQuery): StoredAgentSession[] {
    const { where, params } = sessionsFilter(query);
    const rows = this.prepared(where).all({ ...params, limit: query.limit }) as SessionDbRow[];
    return rows.map((row) =>
      this.toStored(row, row.folder === null ? null : openListedCell(this.cipher, this.log, 'agent_sessions', 'folder', row.id, row.folder)),
    );
  }

  private prepared(where: string): Statement {
    let stmt = this.listStmts.get(where);
    if (!stmt) {
      stmt = this.db.prepare(`SELECT s.*, ${COUNTS} FROM agent_sessions s ${where} ORDER BY s.started_at DESC, s.id DESC LIMIT @limit`);
      this.listStmts.set(where, stmt);
    }
    return stmt;
  }

  private toStored(row: SessionDbRow, folder: string | null): StoredAgentSession {
    return {
      id: row.id,
      tokenId: row.token_id,
      tokenName: row.token_name,
      clientName: row.client_name,
      clientVersion: row.client_version,
      folder,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      endReason: row.end_reason,
      callCount: row.call_count,
      refusedCount: row.refused_count,
      lastCallAt: row.last_call_at,
    };
  }
}
