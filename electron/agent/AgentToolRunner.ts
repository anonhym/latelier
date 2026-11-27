import type { AgentCallSummary } from '@shared/types';
import type { AgentGate, AgentSessionIdentity } from './AgentGate.ts';
import type { AgentReadLogEntry } from '../db/repositories/AgentReadLogRepo.ts';
import type { Logger } from '../log.ts';
import {
  AgentToolError,
  errorText,
  NOT_OPEN_DECLINED_MESSAGE,
  toAgentError,
  type AgentError,
  type AgentOutcome,
} from './errorMap.ts';
import { metaLine } from './envelope.ts';
import { openConnectionMessage, type OpenConnectionAnswer } from './openConnectionPause.ts';
import type { AgentProposals, AgentReferenceRules, AgentTool, ToolOutcome } from './tools.ts';

export interface AgentCallResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface AgentToolRunnerDeps {
  gate: AgentGate;
  tools: readonly AgentTool[];
  /** `transaction`, when given, holds a tool's own write and its row together. */
  readLog: { insert(entry: AgentReadLogEntry): string; transaction?<T>(fn: () => T): T };
  tokens: { touchLastUsed(id: string, at: string): void };
  connections: { findById(id: string): { id: string; name: string } | null };
  log: Pick<Logger, 'warn' | 'error'>;
  /** The Reference Rules the relation tools read (X27 §16.7). */
  refs: AgentReferenceRules;
  /** The Proposals the X28 tools file and read. */
  proposals: AgentProposals;
  /**
   * Called once per Agent Read Log row written, with the row as stored minus
   * its request: for the read counts and the live call feed. One object, so a
   * consumer that needs more of the call can be given it without a new argument.
   */
  onRowWritten?: (row: AgentCallSummary) => void;
  /** Whether the user dismissed this session's Connection request for the Connection (X27 §16.6). */
  openDeclined?: (sessionId: string, connectionId: string) => boolean;
  now?: () => number;
}

/** Whether this call may pause to ask the user to open a closed Connection (X29 §4), and what it was answered. */
export interface AgentAskState {
  /** A 2026-07-28 request from a client that declares form elicitation. */
  canAsk: boolean;
  answer: OpenConnectionAnswer;
}

const NEVER_ASK: AgentAskState = { canAsk: false, answer: 'none' };

/** A call either ends with a result or pauses with the one question X29 asks. */
export type AgentCallReply =
  | { kind: 'result'; result: AgentCallResult; closeSession: boolean }
  | { kind: 'ask'; message: string };

/** A cut for any string lifted from the Agent's arguments into a log column. */
const MAX_LOGGED_NAME = 256;
const MAX_LOGGED_TOOL = 64;

function stringField(args: unknown, key: string): string | null {
  if (typeof args !== 'object' || args === null) return null;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.slice(0, MAX_LOGGED_NAME) : null;
}

/** Every tool but `list_connections` names a Connection; only those can be refused NOT_OPEN. */
function takesConnection(input: unknown): boolean {
  return typeof input === 'object' && input !== null && typeof (input as { connectionId?: unknown }).connectionId === 'string';
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
    ask: AgentAskState = NEVER_ASK,
  ): Promise<AgentCallReply> {
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
      // Declined, cancelled or garbled: the user did not open it, so the gate is not run again.
      if (ask.answer === 'refused' && takesConnection(input)) throw new AgentToolError('NOT_OPEN', NOT_OPEN_DECLINED_MESSAGE);
      const ran = tool.run(input, { gate: this.deps.gate, session, signal, log: this.deps.log, refs: this.deps.refs, proposals: this.deps.proposals });
      // A synchronous tool is not awaited: from its checks to its row nothing else runs, so a write it plans cannot be raced.
      outcome = ran instanceof Promise ? await ran : ran;
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
    const target = this.target(rawArgs);
    const question = failure?.code === 'NOT_OPEN' ? this.question(ask, target.connectionName) : null;
    // A refusal on a pair the user dismissed must not claim the user was asked again.
    if (
      failure?.code === 'NOT_OPEN' &&
      question === null &&
      target.connectionId !== null &&
      this.deps.openDeclined?.(session.sessionId, target.connectionId) === true
    ) {
      failure = { ...failure, message: NOT_OPEN_DECLINED_MESSAGE };
    }
    const text = failure ? errorText(failure) : outcome!.text;
    let rowOutcome: AgentOutcome = 'ok';
    if (question !== null) rowOutcome = 'INPUT_REQUIRED';
    else if (failure) rowOutcome = failure.code;
    const summary: Omit<AgentCallSummary, 'id'> = {
      sessionId: session.sessionId,
      ts: new Date(t0).toISOString(),
      tokenId: session.tokenId,
      tokenName: session.tokenName,
      clientName: session.clientName,
      clientVersion: session.clientVersion,
      ...target,
      tool: name.slice(0, MAX_LOGGED_TOOL),
      docCount: failure ? 0 : outcome!.count,
      // The asking round returns no data: nothing of the refusal text it replaces reaches the Agent.
      bytes: question === null ? Buffer.byteLength(text) : 0,
      durationMs,
      outcome: rowOutcome,
      truncated: failure ? false : outcome!.truncated === true,
    };
    let rowId: string;
    const commit = failure ? undefined : outcome!.commit;
    const write = (): string => {
      commit?.();
      return this.deps.readLog.insert({ ...summary, outcome: rowOutcome, requestJson: requestJsonOf(rawArgs) });
    };
    try {
      rowId = commit !== undefined && this.deps.readLog.transaction ? this.deps.readLog.transaction(write) : write();
    } catch (err) {
      // Fail closed: a read the user cannot see afterwards does not happen.
      this.deps.log.error('agent', 'could not write the Agent Read Log row', {
        errName: err instanceof Error ? err.name : typeof err,
      });
      const refused = toAgentError(new AgentToolError('DB_ERROR'));
      return { kind: 'result', result: { isError: true, content: [{ type: 'text', text: errorText(refused) }] }, closeSession };
    }
    this.deps.onRowWritten?.({ id: rowId, ...summary });
    if (!failure) this.announce(outcome!);

    if (question !== null) return { kind: 'ask', message: question };
    if (failure) {
      return { kind: 'result', result: { isError: true, content: [{ type: 'text', text }] }, closeSession };
    }
    // No `structuredContent` and no `outputSchema`: a client that has one shows the model only that and drops the text holding the data.
    const meta = metaLine({
      count: outcome!.count,
      truncated: outcome!.truncated === true,
      appliedLimits: outcome!.appliedLimits ?? [],
      durationMs,
      estimate: outcome!.estimate,
    });
    return { kind: 'result', result: { content: [{ type: 'text', text: `${text}\n${meta}` }] }, closeSession };
  }

  /** What a committed write announces. It cannot undo the write, so a failure is logged and the call still answers. */
  private announce(outcome: ToolOutcome): void {
    try {
      outcome.afterCommit?.();
    } catch (err) {
      this.deps.log.warn('agent', 'could not announce a tool write', { errName: err instanceof Error ? err.name : typeof err });
    }
  }

  /**
   * The question for a call the gate refused with NOT_OPEN, or null when this
   * call may not ask: the client cannot show a form, or it already answered.
   * A Connection whose name cannot be read is not asked about: the gate passed
   * it as shared, so a missing row means it went away in between.
   */
  private question(ask: AgentAskState, connectionName: string | null): string | null {
    if (!ask.canAsk || ask.answer !== 'none' || connectionName === null) return null;
    return openConnectionMessage(connectionName);
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
      // A Proposal names its source namespace, which is the one its row and any Connection request show.
      database: stringField(rawArgs, 'database') ?? stringField(rawArgs, 'sourceDb'),
      collection: stringField(rawArgs, 'collection') ?? stringField(rawArgs, 'sourceCollection'),
    };
  }
}
