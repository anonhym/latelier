import type { Socket } from 'node:net';
import {
  Server,
  inputRequired,
  isJSONRPCRequest,
  type JSONRPCMessage,
  type JSONRPCRequest,
  type ProtocolEra,
} from '@modelcontextprotocol/server';
import { StdioServerTransport, serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import type { AgentSessionEndReason } from '@shared/types';
import type { AgentSessionRepo } from '../db/repositories/AgentSessionRepo.ts';
import type { Logger } from '../log.ts';
import type { AgentSessionIdentity } from './AgentGate.ts';
import type { AgentAskState, AgentToolRunner } from './AgentToolRunner.ts';
import { sessionRecordFailedLine } from './handshake.ts';
import {
  OPEN_CONNECTION_KEY,
  acceptsFormElicitation,
  clientInfoOf,
  envelopeClientInfo,
  openConnectionAnswer,
  type ClientInfo,
} from './openConnectionPause.ts';
import { SERVER_INSTRUCTIONS, toolListEntries, type AgentTool } from './tools.ts';

/** An oversized message closes that session only (X27 §4.5). */
export const MAX_MESSAGE_BYTES = 1_048_576;

export { MAX_CLIENT_INFO_CHARS } from './openConnectionPause.ts';

const SERVER_INFO = { name: 'latelier', version: '1' };

/** The question has no fields: accepting is the answer. */
const EMPTY_FORM = { type: 'object' as const, properties: {} };

/** Where a session's row lives (X27 §16.2): written when the session is first counted, closed once. */
export type AgentSessionStore = Pick<AgentSessionRepo, 'insert' | 'setClientInfoOnce' | 'close'>;

/** A live, counted session as main reports it. `folder` is cleaned but not yet in display form. */
export interface AgentSessionSnapshot {
  id: string;
  tokenId: string;
  tokenName: string;
  clientName: string | null;
  clientVersion: string | null;
  folder: string | null;
  startedAt: string;
}

export interface AgentSessionDeps {
  socket: Socket;
  identity: AgentSessionIdentity;
  runner: AgentToolRunner;
  tools: readonly AgentTool[];
  log: Pick<Logger, 'info' | 'warn' | 'error'>;
  store: AgentSessionStore;
  /** What the bridge reported as its working folder, already cleaned; null when it reported none. */
  folder: string | null;
  /** Why the session ends when the runner closes it after a token check fails: the switch went off, or the token went away. */
  refusedReason: () => AgentSessionEndReason;
  now?: () => Date;
  /** Called once, on the first request that is not `server/discover`: a discovery probe never counts as a client (X29 §2). */
  onActive: (session: AgentSession) => void;
  /** Called once, when the session's socket is gone. `endReason` is set by then. */
  onClosed: (session: AgentSession) => void;
}

function hasClientInfo(info: ClientInfo): boolean {
  return info.clientName !== null || info.clientVersion !== null;
}

/**
 * The client info a raw request carries: `initialize`'s `clientInfo` in the
 * 2025 era, the `_meta` envelope's in 2026-07-28. Read off the message itself,
 * before the SDK sees it, so the first request can be recorded with it.
 */
function requestClientInfo(message: JSONRPCRequest): ClientInfo {
  const params = message.params as Record<string, unknown> | undefined;
  if (message.method === 'initialize') return clientInfoOf(params?.clientInfo);
  return envelopeClientInfo(params?._meta);
}

/**
 * One MCP connection over one authenticated socket, served in whichever era
 * the client opens with (X29 §2). The low-level `Server` is used on purpose:
 * it hands the raw `arguments` to the runner, so a call that fails schema
 * validation still writes its Agent Read Log row.
 */
export class AgentSession {
  readonly identity: AgentSessionIdentity;
  private deps: AgentSessionDeps;
  private handle: StdioServerHandle | null = null;
  private active = false;
  private ending = false;
  private closed = false;
  /** The row could not be written: every later message is dropped unread. */
  private unrecorded = false;
  private startedAt: string | null = null;
  /** The session's client info: seen before the row existed, or written to it once. */
  private clientInfo: ClientInfo = { clientName: null, clientVersion: null };
  private clientInfoStored = false;
  private reason: AgentSessionEndReason | null = null;

  constructor(deps: AgentSessionDeps) {
    this.deps = deps;
    this.identity = deps.identity;
  }

  /** Whether the client has sent anything beyond a discovery probe. Such a session has its row. */
  get isActive(): boolean {
    return this.active;
  }

  /** Why the session ended; null while it is open. */
  get endReason(): AgentSessionEndReason | null {
    return this.closed ? (this.reason ?? 'client-closed') : null;
  }

  /** The session as the live state shows it; null until it is counted. */
  snapshot(): AgentSessionSnapshot | null {
    if (!this.active || this.startedAt === null) return null;
    return {
      id: this.identity.sessionId,
      tokenId: this.identity.tokenId,
      tokenName: this.identity.tokenName,
      clientName: this.clientInfo.clientName,
      clientVersion: this.clientInfo.clientVersion,
      folder: this.deps.folder,
      startedAt: this.startedAt,
    };
  }

  async start(): Promise<void> {
    const { socket } = this.deps;
    const transport = new StdioServerTransport(socket, socket, { maxBufferSize: MAX_MESSAGE_BYTES });
    socket.once('close', () => this.markClosed());
    this.handle = serveStdio(({ era }) => this.buildServer(era), {
      transport,
      legacy: 'serve',
      onerror: (err) => this.warn(err),
    });
    // `serveStdio` has set its own handlers by now, synchronously. Both are wrapped, not replaced.
    const sdkOnMessage = transport.onmessage;
    transport.onmessage = (message: JSONRPCMessage) => {
      // The buffer hands over every message of a chunk at once: after a refusal none of them may reach the SDK.
      if (this.unrecorded) return;
      if (isJSONRPCRequest(message)) {
        this.noteClientInfo(requestClientInfo(message));
        if (message.method !== 'server/discover' && !this.active && !this.closed) {
          // Synchronous, so the row exists before the SDK handles the request (X27 §16.2).
          if (!this.record()) {
            this.refuseUnrecorded(message);
            return;
          }
          this.markActive();
        }
      }
      sdkOnMessage?.(message);
    };
    const sdkOnClose = transport.onclose;
    // The transport closes itself on an oversized message, even the first one, but it does not own the socket: end that too.
    transport.onclose = () => {
      sdkOnClose?.();
      // An oversized message or a client that ended its side: either way the client ended it.
      this.close('client-closed');
    };
    // Held back by the handshake reader; any bytes it pushed back are delivered now.
    socket.resume();
  }

  /** Ends the session: a graceful FIN so a pending response is flushed, then a destroy. The first reason given stays. */
  close(reason: AgentSessionEndReason): void {
    this.reason ??= reason;
    // Closing the SDK's handle closes the transport, whose `onclose` lands back here.
    if (this.ending) return;
    this.ending = true;
    const { socket } = this.deps;
    void this.handle?.close();
    if (!socket.destroyed) socket.end(() => socket.destroy());
    this.markClosed();
  }

  /** Immediate: nothing more is sent. */
  destroy(reason: AgentSessionEndReason): void {
    this.reason ??= reason;
    this.ending = true;
    this.deps.socket.destroy();
    void this.handle?.close();
    this.markClosed();
  }

  /** One instance per era the connection tries: a probe that falls back to `initialize` builds a second one. */
  private buildServer(era: ProtocolEra): Server {
    const server = new Server(SERVER_INFO, {
      capabilities: { tools: {} },
      instructions: SERVER_INSTRUCTIONS,
      // On a 2025 connection the SDK would turn a pause into a held server-to-client request; the app never pauses there, and this makes sure.
      inputRequired: { legacyShim: false },
    });
    server.onerror = (err) => this.warn(err);
    const entries = toolListEntries(this.deps.tools);
    server.setRequestHandler('tools/list', () => ({ tools: entries }));
    server.setRequestHandler('tools/call', async (request, ctx) => {
      const modern = era === 'modern';
      const { envelope, inputResponses, droppedInputResponseKeys } = ctx.mcpReq;
      // Per call: in the modern era nothing ties one request's client info to the next, and calls can overlap.
      const identity: AgentSessionIdentity = {
        ...this.identity,
        ...(modern ? envelopeClientInfo(envelope) : clientInfoOf(server.getClientVersion())),
      };
      const ask: AgentAskState = modern
        ? { canAsk: acceptsFormElicitation(envelope), answer: openConnectionAnswer(inputResponses, droppedInputResponseKeys) }
        : { canAsk: false, answer: 'none' };
      const reply = await this.deps.runner.call(identity, request.params.name, request.params.arguments, ctx.mcpReq.signal, ask);
      if (reply.kind === 'ask') {
        return inputRequired({
          inputRequests: { [OPEN_CONNECTION_KEY]: inputRequired.elicit({ message: reply.message, requestedSchema: EMPTY_FORM }) },
        });
      }
      // After the response is queued: closing now would drop it.
      if (reply.closeSession) setImmediate(() => this.close(this.deps.refusedReason()));
      return reply.result;
    });
    return server;
  }

  /** The SDK's message can name the oversize; it never carries a token. Class only, to stay safe. */
  private warn(err: Error): void {
    this.deps.log.warn('agent', 'session transport error', { errName: err.name, session: this.identity.sessionId });
  }

  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }

  /** Writes the session's row. False, after logging the error's class, when it cannot be written. */
  private record(): boolean {
    const startedAt = this.now();
    try {
      this.deps.store.insert({
        id: this.identity.sessionId,
        tokenId: this.identity.tokenId,
        tokenName: this.identity.tokenName,
        clientName: this.clientInfo.clientName,
        clientVersion: this.clientInfo.clientVersion,
        folder: this.deps.folder,
        startedAt,
      });
    } catch (err) {
      this.deps.log.error('agent', 'could not record the Agent session', { errName: err instanceof Error ? err.name : typeof err });
      return false;
    }
    this.startedAt = startedAt;
    this.clientInfoStored = hasClientInfo(this.clientInfo);
    return true;
  }

  /**
   * The first request that carries client info sets the session's, once.
   * Before the row exists it is held for the insert; after, it is written. A
   * failed write is logged and the session goes on: the info is display-only.
   */
  private noteClientInfo(info: ClientInfo): void {
    if (this.clientInfoStored || !hasClientInfo(info)) return;
    if (this.startedAt === null) {
      if (!hasClientInfo(this.clientInfo)) this.clientInfo = info;
      return;
    }
    this.clientInfo = info;
    this.clientInfoStored = true;
    try {
      this.deps.store.setClientInfoOnce(this.identity.sessionId, info.clientName, info.clientVersion);
    } catch (err) {
      this.deps.log.warn('agent', 'could not record the Agent client', { errName: err instanceof Error ? err.name : typeof err });
    }
  }

  /**
   * The row could not be written: the fixed -32003 line goes straight to the
   * socket, never through the SDK, and the socket ends. The bridge knows it by
   * its first 24 bytes, wherever on the socket it comes.
   */
  private refuseUnrecorded(message: JSONRPCRequest): void {
    this.unrecorded = true;
    this.ending = true;
    const { socket } = this.deps;
    if (!socket.destroyed) socket.end(sessionRecordFailedLine(message.id), () => socket.destroy());
    void this.handle?.close();
  }

  private markActive(): void {
    if (this.active || this.closed) return;
    this.active = true;
    this.deps.onActive(this);
  }

  private markClosed(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.startedAt !== null) {
      try {
        this.deps.store.close(this.identity.sessionId, this.now(), this.reason ?? 'client-closed');
      } catch (err) {
        this.deps.log.error('agent', 'could not record the end of an Agent session', {
          errName: err instanceof Error ? err.name : typeof err,
        });
      }
    }
    this.deps.onClosed(this);
  }
}
