import { ZodError } from 'zod';
import { isMaxTimeMSExpired } from '../mongo/errors.ts';

/** The stable codes an Agent can see (X27 §9.4). */
export const AGENT_ERROR_CODES = [
  'NOT_SHARED',
  'NOT_OPEN',
  'ACCESS_OFF',
  'NAMESPACE_DENIED',
  'STAGE_NOT_ALLOWED',
  'JS_NOT_ALLOWED',
  'INVALID_INPUT',
  'BUSY',
  'TIMEOUT',
  'CANCELLED',
  'DB_ERROR',
] as const;

export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];

/**
 * What an Agent Read Log row records as the outcome. `INPUT_REQUIRED` marks a
 * call that paused to ask the user to open its Connection (X29 §5): a row of
 * its own, never an error an Agent receives.
 */
export type AgentOutcome = 'ok' | 'INPUT_REQUIRED' | AgentErrorCode;

const DEFAULT_MESSAGES: Record<AgentErrorCode, string> = {
  NOT_SHARED: 'This Connection is not shared with Agents.',
  NOT_OPEN: "This Connection is not open. Ask the user to open it in L'Atelier.",
  ACCESS_OFF: 'Agent Access is off.',
  NAMESPACE_DENIED: 'Agents cannot read this database or collection.',
  STAGE_NOT_ALLOWED: 'This pipeline stage is not allowed.',
  JS_NOT_ALLOWED: 'Server-side JavaScript operators are not allowed. Use $expr instead.',
  INVALID_INPUT: 'The input is invalid.',
  BUSY: 'Too many Agent operations are running on this Connection. Try again shortly.',
  TIMEOUT: 'The operation exceeded its time limit.',
  CANCELLED: 'The operation was cancelled.',
  DB_ERROR: 'The database returned an error.',
};

export function defaultAgentMessage(code: AgentErrorCode): string {
  return DEFAULT_MESSAGES[code];
}

/**
 * An error the app raises on purpose. Its message is app-written and safe to
 * send; nothing that reaches an Agent may be built from a driver's message.
 */
export class AgentToolError extends Error {
  public readonly code: AgentErrorCode;
  public readonly serverCode?: number;

  constructor(code: AgentErrorCode, message?: string, serverCode?: number, options?: ErrorOptions) {
    super(message ?? DEFAULT_MESSAGES[code], options);
    this.name = 'AgentToolError';
    this.code = code;
    this.serverCode = serverCode;
  }
}

export interface AgentError {
  code: AgentErrorCode;
  message: string;
  /** The server's numeric error code, only ever on DB_ERROR. */
  serverCode?: number;
}

const MAX_ISSUES = 5;
const MAX_PATH_PART = 64;

function cutPart(part: string): string {
  return part.length > MAX_PATH_PART ? part.slice(0, MAX_PATH_PART) : part;
}

/**
 * Issue paths are keys the Agent itself sent and issue codes are zod's fixed
 * vocabulary; the issue `message` is never read, because some of them quote
 * the received value.
 */
function describeZodError(err: ZodError): string {
  const parts = err.issues.slice(0, MAX_ISSUES).map((issue) => {
    const path = issue.path.map((p) => cutPart(String(p))).join('.') || 'input';
    if (issue.code === 'unrecognized_keys') {
      return `${path}: unknown field ${issue.keys.map((k) => cutPart(k)).join(', ')}`;
    }
    return `${path}: ${issue.code}`;
  });
  return `${DEFAULT_MESSAGES.INVALID_INPUT} ${parts.join('; ')}`;
}

function isAbort(err: unknown): boolean {
  const e = err as { name?: unknown; code?: unknown } | null;
  return e?.name === 'AbortError' || e?.name === 'MongoAbortedError' || e?.code === 'ABORT_ERR';
}

/**
 * Maps anything thrown on the read path to a code and an app-written message.
 * The driver's own message is never read: it can echo field values,
 * namespaces and hosts. A driver error carrying a numeric server code keeps
 * only that number.
 */
export function toAgentError(err: unknown): AgentError {
  if (err instanceof AgentToolError) {
    return { code: err.code, message: err.message, serverCode: err.serverCode };
  }
  if (err instanceof ZodError) {
    return { code: 'INVALID_INPUT', message: describeZodError(err) };
  }
  if (isAbort(err)) return { code: 'CANCELLED', message: DEFAULT_MESSAGES.CANCELLED };
  if (isMaxTimeMSExpired(err)) return { code: 'TIMEOUT', message: DEFAULT_MESSAGES.TIMEOUT };
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'number' && Number.isInteger(code)) {
    return { code: 'DB_ERROR', message: DEFAULT_MESSAGES.DB_ERROR, serverCode: code };
  }
  return { code: 'DB_ERROR', message: DEFAULT_MESSAGES.DB_ERROR };
}

/** The text of an error result: `<CODE>: <app message>`, plus the server code on DB_ERROR. */
export function errorText(error: AgentError): string {
  const suffix = error.serverCode === undefined ? '' : ` (server code ${error.serverCode})`;
  return `${error.code}: ${error.message}${suffix}`;
}
