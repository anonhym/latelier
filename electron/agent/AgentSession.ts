import type { Socket } from 'node:net';
import { Server, inputRequired, isJSONRPCRequest, type JSONRPCMessage, type ProtocolEra } from '@modelcontextprotocol/server';
import { StdioServerTransport, serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import type { Logger } from '../log.ts';
import type { AgentSessionIdentity } from './AgentGate.ts';
import type { AgentAskState, AgentToolRunner } from './AgentToolRunner.ts';
import {
  OPEN_CONNECTION_KEY,
  acceptsFormElicitation,
  clientInfoOf,
  envelopeClientInfo,
  openConnectionAnswer,
} from './openConnectionPause.ts';
import { SERVER_INSTRUCTIONS, toolListEntries, type AgentTool } from './tools.ts';

/** An oversized message closes that session only (X27 §4.5). */
export const MAX_MESSAGE_BYTES = 1_048_576;

export { MAX_CLIENT_INFO_CHARS } from './openConnectionPause.ts';

const SERVER_INFO = { name: 'latelier', version: '1' };

/** The question has no fields: accepting is the answer. */
const EMPTY_FORM = { type: 'object' as const, properties: {} };

export interface AgentSessionDeps {
  socket: Socket;
  identity: AgentSessionIdentity;
  runner: AgentToolRunner;
  tools: readonly AgentTool[];
  log: Pick<Logger, 'info' | 'warn'>;
  /** Called once, on the first request that is not `server/discover`: a discovery probe never counts as a client (X29 §2). */
  onActive: (session: AgentSession) => void;
  /** Called once, when the session's socket is gone. */
  onClosed: (session: AgentSession) => void;
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

  constructor(deps: AgentSessionDeps) {
    this.deps = deps;
    this.identity = deps.identity;
  }

  /** Whether the client has sent anything beyond a discovery probe. */
  get isActive(): boolean {
    return this.active;
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
      if (isJSONRPCRequest(message) && message.method !== 'server/discover') this.markActive();
      sdkOnMessage?.(message);
    };
    const sdkOnClose = transport.onclose;
    // The transport closes itself on an oversized message, even the first one, but it does not own the socket: end that too.
    transport.onclose = () => {
      sdkOnClose?.();
      this.close();
    };
    // Held back by the handshake reader; any bytes it pushed back are delivered now.
    socket.resume();
  }

  /** Ends the session: a graceful FIN so a pending response is flushed, then a destroy. */
  close(): void {
    // Closing the SDK's handle closes the transport, whose `onclose` lands back here.
    if (this.ending) return;
    this.ending = true;
    const { socket } = this.deps;
    void this.handle?.close();
    if (!socket.destroyed) socket.end(() => socket.destroy());
    this.markClosed();
  }

  /** Immediate: nothing more is sent. */
  destroy(): void {
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
      if (reply.closeSession) setImmediate(() => this.close());
      return reply.result;
    });
    return server;
  }

  /** The SDK's message can name the oversize; it never carries a token. Class only, to stay safe. */
  private warn(err: Error): void {
    this.deps.log.warn('agent', 'session transport error', { errName: err.name, session: this.identity.sessionId });
  }

  private markActive(): void {
    if (this.active || this.closed) return;
    this.active = true;
    this.deps.onActive(this);
  }

  private markClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.deps.onClosed(this);
  }
}
