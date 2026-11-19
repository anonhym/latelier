import type { Socket } from 'node:net';
import { Server } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { Logger } from '../log.ts';
import type { AgentSessionIdentity } from './AgentGate.ts';
import type { AgentToolRunner } from './AgentToolRunner.ts';
import { SERVER_INSTRUCTIONS, toolListEntries, type AgentTool } from './tools.ts';

/** An oversized message closes that session only (X27 §4.5). */
export const MAX_MESSAGE_BYTES = 1_048_576;

const SERVER_INFO = { name: 'latelier', version: '1' };

/** What the client calls itself goes into Agent Read Log rows and so into the log screen: a cut, because the client chooses it. */
export const MAX_CLIENT_INFO_CHARS = 128;

const cutClientInfo = (value: string | undefined): string | null => (value === undefined ? null : value.slice(0, MAX_CLIENT_INFO_CHARS));

export interface AgentSessionDeps {
  socket: Socket;
  identity: AgentSessionIdentity;
  runner: AgentToolRunner;
  tools: readonly AgentTool[];
  log: Pick<Logger, 'info' | 'warn'>;
  /** Called once, when the session's socket is gone. */
  onClosed: (session: AgentSession) => void;
}

/**
 * One MCP `Server` over one authenticated socket. The low-level `Server` is
 * used on purpose: it hands the raw `arguments` to the runner, so a call that
 * fails schema validation still writes its Agent Read Log row.
 */
export class AgentSession {
  readonly identity: AgentSessionIdentity;
  private deps: AgentSessionDeps;
  private server: Server;
  private closed = false;

  constructor(deps: AgentSessionDeps) {
    this.deps = deps;
    this.identity = deps.identity;
    this.server = new Server(SERVER_INFO, {
      capabilities: { tools: {} },
      instructions: SERVER_INSTRUCTIONS,
    });
    const entries = toolListEntries(deps.tools);
    this.server.setRequestHandler('tools/list', () => ({ tools: entries }));
    this.server.setRequestHandler('tools/call', async (request, ctx) => {
      const client = this.server.getClientVersion();
      this.identity.clientName = cutClientInfo(client?.name);
      this.identity.clientVersion = cutClientInfo(client?.version);
      const { result, closeSession } = await this.deps.runner.call(
        this.identity,
        request.params.name,
        request.params.arguments,
        ctx.mcpReq.signal,
      );
      // After the response is queued: closing now would drop it.
      if (closeSession) setImmediate(() => this.close());
      return result;
    });
  }

  async start(): Promise<void> {
    const { socket } = this.deps;
    const transport = new StdioServerTransport(socket, socket, { maxBufferSize: MAX_MESSAGE_BYTES });
    transport.onerror = (err) => {
      // The SDK's message can name the oversize; it never carries a token. Class only, to stay safe.
      this.deps.log.warn('agent', 'session transport error', { errName: err.name, session: this.identity.sessionId });
    };
    // The transport closes itself on an oversized message but does not own the socket: end it too.
    transport.onclose = () => this.close();
    socket.once('close', () => this.markClosed());
    await this.server.connect(transport);
    // Held back by the handshake reader; any bytes it pushed back are delivered now.
    socket.resume();
  }

  /** Ends the session: a graceful FIN so a pending response is flushed, then a destroy. */
  close(): void {
    const { socket } = this.deps;
    if (!socket.destroyed) socket.end(() => socket.destroy());
    this.markClosed();
  }

  /** Immediate: nothing more is sent. */
  destroy(): void {
    this.deps.socket.destroy();
    this.markClosed();
  }

  private markClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.deps.onClosed(this);
  }
}
