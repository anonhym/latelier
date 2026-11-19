import type { AgentGate, AgentSessionIdentity } from './AgentGate.ts';
import type { AgentReadLogEntry } from '../db/repositories/AgentReadLogRepo.ts';
import type { Logger } from '../log.ts';
import {
  AgentToolError,
  errorText,
  toAgentError,
  type AgentError,
  type AgentOutcome,
} from './errorMap.ts';
import { metaLine } from './envelope.ts';
import type { AgentTool, ToolOutcome } from './tools.ts';

export interface AgentCallResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface AgentToolRunnerDeps {
  gate: AgentGate;
  tools: readonly AgentTool[];
  readLog: { insert(entry: AgentReadLogEntry): string };
  tokens: { touchLastUsed(id: string, at: string): void };
  connections: { findById(id: string): { id: string; name: string } | null };
  log: Pick<Logger, 'warn' | 'error'>;
  /** Called once per Agent Read Log row written, for the session read count. */
  onRowWritten?: () => void;
  now?: () => number;
}

/** A cut for any string lifted from the Agent's arguments into a log column. */
const MAX_LOGGED_NAME = 256;
const MAX_LOGGED_TOOL = 64;

function stringField(args: unknown, key: string): string | null {
  if (typeof args !== 'object' || args === null) return null;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.slice(0, MAX_LOGGED_NAME) : null;
}

/**
 * The arguments as the row stores them. Input nested thousands deep parses
 * (the transport's own parser has no depth limit) but `JSON.stringify` throws
 * on it: that must not cost the call its row, or a refusal would turn into
 * DB_ERROR and leave no trace. The marker is stored like any other request.
 */
export function requestJsonOf(rawArgs: unknown): string {
  try {
    return JSON.stringify(rawArgs ?? {});
  } catch (err) {
    if (err instanceof RangeError) return '{"unserializable":true}';
    throw err;
  }
}

/**
 * Runs one `tools/call` in the order X27 requires: re-check the token, parse
 * the input, run the tool, then write the Agent Read Log row before any data
 * is returned. Every outcome, refusals included, writes its row; a row that
 * cannot be written turns the call into DB_ERROR with no data.
 */
export class AgentToolRunner {
  private deps: AgentToolRunnerDeps;
  private byName: Map<string, AgentTool>;

  constructor(deps: AgentToolRunnerDeps) {
    this.deps = deps;
    this.byName = new Map(deps.tools.map((t) => [t.name, t]));
  }

  async call(
    session: AgentSessionIdentity,
    name: string,
    rawArgs: unknown,
    signal: AbortSignal,
  ): Promise<{ result: AgentCallResult; closeSession: boolean }> {
    const now = this.deps.now ?? Date.now;
    const t0 = now();
    let outcome: ToolOutcome | null = null;
    let failure: AgentError | null = null;
    let closeSession = false;

    try {
      if (this.deps.gate.checkToken(session) !== 'ok') {
        // The token was revoked or regenerated, or Agent Access went off: the
        // session ends once this answer has been sent.
        closeSession = true;
        throw new AgentToolError('ACCESS_OFF', 'This Agent Token is no longer valid, or Agent Access is off.');
      }
      this.deps.tokens.touchLastUsed(session.tokenId, new Date(now()).toISOString());
      const tool = this.byName.get(name);
      if (!tool) throw new AgentToolError('INVALID_INPUT', 'Unknown tool.');
      const input = tool.inputSchema.parse(rawArgs ?? {});
      outcome = await tool.run(input, { gate: this.deps.gate, session, signal, log: this.deps.log });
    } catch (err) {
      failure = toAgentError(err);
      if (failure.code === 'DB_ERROR') {
        // Only the error's class and numeric code: a driver message can quote document values.
        this.deps.log.warn('agent', 'tool failed', {
          tool: name.slice(0, MAX_LOGGED_TOOL),
          errName: err instanceof Error ? err.name : typeof err,
          serverCode: failure.serverCode,
        });
      }
    }

    const durationMs = Math.max(0, Math.round(now() - t0));
    const text = failure ? errorText(failure) : outcome!.text;
    try {
      const row: AgentReadLogEntry = {
        ts: new Date(t0).toISOString(),
        tokenId: session.tokenId,
        tokenName: session.tokenName,
        clientName: session.clientName,
        clientVersion: session.clientVersion,
        ...this.target(rawArgs),
        tool: name.slice(0, MAX_LOGGED_TOOL),
        requestJson: requestJsonOf(rawArgs),
        docCount: failure ? 0 : outcome!.count,
        bytes: Buffer.byteLength(text),
        durationMs,
        outcome: (failure ? failure.code : 'ok') satisfies AgentOutcome,
        truncated: failure ? false : outcome!.truncated === true,
      };
      this.deps.readLog.insert(row);
    } catch (err) {
      // Fail closed: a read the user cannot see afterwards does not happen.
      this.deps.log.error('agent', 'could not write the Agent Read Log row', {
        errName: err instanceof Error ? err.name : typeof err,
      });
      const refused = toAgentError(new AgentToolError('DB_ERROR'));
      return { result: { isError: true, content: [{ type: 'text', text: errorText(refused) }] }, closeSession };
    }
    this.deps.onRowWritten?.();

    if (failure) {
      return { result: { isError: true, content: [{ type: 'text', text }] }, closeSession };
    }
    // No `structuredContent` and no `outputSchema`: a client that has one shows the model only that and drops the text holding the data.
    const meta = metaLine({
      count: outcome!.count,
      truncated: outcome!.truncated === true,
      appliedLimits: outcome!.appliedLimits ?? [],
      durationMs,
      estimate: outcome!.estimate,
    });
    return { result: { content: [{ type: 'text', text: `${text}\n${meta}` }] }, closeSession };
  }

  /** The Connection, database and collection an Agent named, whether or not the call was allowed. */
  private target(rawArgs: unknown): Pick<
    AgentReadLogEntry,
    'connectionId' | 'connectionName' | 'database' | 'collection'
  > {
    const connectionId = stringField(rawArgs, 'connectionId');
    const found = connectionId === null ? null : this.deps.connections.findById(connectionId);
    return {
      connectionId,
      connectionName: found?.name ?? null,
      database: stringField(rawArgs, 'database'),
      collection: stringField(rawArgs, 'collection'),
    };
  }
}
