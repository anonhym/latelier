import { randomUUID } from 'node:crypto';
import type { Database, Statement } from 'better-sqlite3';
import { SystemError } from '../../errors.ts';
import { AGENT_ERROR_CODES, type AgentOutcome } from '../../agent/errorMap.ts';
import type { ColumnCipher } from '../columnCipher.ts';

/** `request_json` is capped here (X27 §11.2): a refused, oversized request is still logged and must not grow the table. */
export const REQUEST_JSON_MAX_BYTES = 16_384;
const REQUEST_HEAD_CHARS = 16_000;

/**
 * The request as stored: unchanged when it fits, else a marker holding its
 * size and the start of it. The marker itself is kept under the cap, so
 * characters the JSON encoder must escape cannot push it back over.
 */
export function capRequestJson(json: string): string {
  const bytes = Buffer.byteLength(json);
  if (bytes <= REQUEST_JSON_MAX_BYTES) return json;
  let head = json.slice(0, REQUEST_HEAD_CHARS);
  for (;;) {
    const marker = JSON.stringify({ truncated: true, bytes, head });
    if (Buffer.byteLength(marker) <= REQUEST_JSON_MAX_BYTES) return marker;
    head = head.slice(0, Math.floor(head.length * 0.9));
  }
}

export interface AgentReadLogEntry {
  ts: string;
  tokenId: string | null;
  tokenName: string | null;
  clientName: string | null;
  clientVersion: string | null;
  connectionId: string | null;
  connectionName: string | null;
  database: string | null;
  collection: string | null;
  tool: string;
  /** The tool's arguments as the Agent sent them, JSON-encoded. */
  requestJson: string | null;
  docCount: number;
  bytes: number;
  durationMs: number;
  outcome: AgentOutcome;
  truncated: boolean;
}

const OUTCOMES: ReadonlySet<string> = new Set<string>(['ok', 'INPUT_REQUIRED', ...AGENT_ERROR_CODES]);

/**
 * The Agent Read Log (X27 §11). Only `request_json` is sealed: it holds
 * literals from the user's data. Database and collection names follow the
 * Audit Log and stay plaintext.
 */
export class AgentReadLogRepo {
  private cipher: ColumnCipher;
  private insertStmt: Statement;
  private deleteOlderThanStmt: Statement<[number]>;
  private countStmt: Statement;

  constructor(db: Database, cipher: ColumnCipher) {
    this.cipher = cipher;
    this.insertStmt = db.prepare(`
      INSERT INTO agent_read_log
        (id, ts, token_id, token_name, client_name, client_version, connection_id, connection_name,
         database, collection, tool, request_json, doc_count, bytes, duration_ms, outcome, truncated)
      VALUES
        (@id, @ts, @token_id, @token_name, @client_name, @client_version, @connection_id, @connection_name,
         @database, @collection, @tool, @request_json, @doc_count, @bytes, @duration_ms, @outcome, @truncated)
    `);
    // julianday rather than a text comparison: `ts` is ISO-8601 with a `T`
    // separator, `datetime('now', ...)` is not (see AuditRepo).
    this.deleteOlderThanStmt = db.prepare(
      "DELETE FROM agent_read_log WHERE julianday(ts) < julianday('now', '-' || ? || ' days')",
    );
    this.countStmt = db.prepare('SELECT COUNT(*) AS n FROM agent_read_log');
  }

  /** Writes one row and returns its id. Throws when the row cannot be written: the caller must then return no data. */
  insert(entry: AgentReadLogEntry): string {
    if (!OUTCOMES.has(entry.outcome)) {
      throw new SystemError('INTERNAL', 'Unknown Agent Read Log outcome.', { outcome: entry.outcome });
    }
    const id = randomUUID();
    const request =
      entry.requestJson === null
        ? null
        : this.cipher.seal('agent_read_log', 'request_json', id, capRequestJson(entry.requestJson));
    this.insertStmt.run({
      id,
      ts: entry.ts,
      token_id: entry.tokenId,
      token_name: entry.tokenName,
      client_name: entry.clientName,
      client_version: entry.clientVersion,
      connection_id: entry.connectionId,
      connection_name: entry.connectionName,
      database: entry.database,
      collection: entry.collection,
      tool: entry.tool,
      request_json: request,
      doc_count: entry.docCount,
      bytes: entry.bytes,
      duration_ms: entry.durationMs,
      outcome: entry.outcome,
      truncated: entry.truncated ? 1 : 0,
    });
    return id;
  }

  /** Delete rows older than `days` days. Returns the rows affected. */
  deleteOlderThan(days: number): number {
    return this.deleteOlderThanStmt.run(days).changes;
  }

  count(): number {
    return (this.countStmt.get() as { n: number }).n;
  }
}
