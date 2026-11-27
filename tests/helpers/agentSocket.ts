import net from 'node:net';
import { once } from 'node:events';
import { Client, ReadBuffer, serializeMessage, type JSONRPCMessage, type Transport } from '@modelcontextprotocol/client';

/** A client transport over an already-connected socket, so no process is spawned. */
class SocketTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private readBuffer = new ReadBuffer();
  private readonly socket: net.Socket;

  constructor(socket: net.Socket) {
    this.socket = socket;
  }

  async start(): Promise<void> {
    this.socket.on('data', (chunk: Buffer) => {
      this.readBuffer.append(chunk);
      for (;;) {
        const message = this.readBuffer.readMessage();
        if (message === null || message === undefined) break;
        this.onmessage?.(message);
      }
    });
    this.socket.on('close', () => this.onclose?.());
    this.socket.on('error', (err) => this.onerror?.(err));
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.socket.write(serializeMessage(message));
  }

  async close(): Promise<void> {
    this.socket.destroy();
  }
}

export function handshakeLine(token: string, protocol = 1): string {
  return `${JSON.stringify({ agentToken: token, protocol })}\n`;
}

export async function openSocket(socketPath: string): Promise<net.Socket> {
  const socket = net.connect(socketPath);
  await once(socket, 'connect');
  return socket;
}

/** Everything the server sends until it closes the socket (or `ms` passes). */
export function readUntilClosed(socket: net.Socket, ms = 3_000): Promise<string> {
  return new Promise((resolve) => {
    let out = '';
    const timer = setTimeout(() => resolve(out), ms);
    socket.on('data', (c: Buffer) => (out += c.toString('utf8')));
    socket.on('error', () => undefined);
    socket.on('close', () => {
      clearTimeout(timer);
      resolve(out);
    });
  });
}

export interface AgentConnection {
  socket: net.Socket;
  client: Client;
  closed: Promise<void>;
  close: () => Promise<void>;
}

/** The answer a test client gives an `elicitation/create`, given the request's params. */
export type ElicitAnswer = (params: { message: string; requestedSchema?: unknown }) => Promise<{ action: 'accept' | 'decline' | 'cancel' }>;

export interface ConnectAgentOptions {
  /** Pin the 2026-07-28 era. The default client speaks the 2025 era (it opens with `initialize`). */
  modern?: boolean;
  /** Declared client capabilities, e.g. `{ elicitation: { form: {} } }`. */
  capabilities?: Record<string, unknown>;
  /** Registered as the `elicitation/create` handler; needs an `elicitation` capability. */
  onElicit?: ElicitAnswer;
}

/** Handshakes with the token, then runs an MCP `Client` over the same socket. */
export async function connectAgent(
  socketPath: string,
  token: string,
  clientInfo: { name: string; version: string } = { name: 'spec-client', version: '9.9' },
  options: ConnectAgentOptions = {},
): Promise<AgentConnection> {
  const socket = await openSocket(socketPath);
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  socket.write(handshakeLine(token));
  const client = new Client(clientInfo, {
    capabilities: options.capabilities ?? {},
    ...(options.modern ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {}),
  });
  const onElicit = options.onElicit;
  if (onElicit) client.setRequestHandler('elicitation/create', (request) => onElicit(request.params as { message: string; requestedSchema?: unknown }));
  await client.connect(new SocketTransport(socket));
  return {
    socket,
    client,
    closed,
    close: async () => {
      await client.close();
    },
  };
}

export function textOf(result: { content?: unknown }): string {
  const first = (result.content as Array<{ type: string; text?: string }> | undefined)?.[0];
  return first?.type === 'text' ? (first.text ?? '') : '';
}

export interface ResultMeta {
  count: number;
  truncated: boolean;
  appliedLimits: string[];
  durationMs: number;
  estimate?: boolean;
}

const META_LINE = /^Returned (\d+) items?\. truncated: (true|false)\. limits: (none|[a-z, ]+)\.(?: estimate: (true|false)\.)? (\d+) ms\.$/;

/** The metadata line the app writes as the last line of a successful result, outside the untrusted-data envelope. */
export function metaOf(result: { content?: unknown }): ResultMeta {
  const last = textOf(result).split('\n').at(-1) ?? '';
  const m = META_LINE.exec(last);
  if (!m) throw new Error(`no metadata line at the end of: ${last.slice(0, 200)}`);
  return {
    count: Number(m[1]),
    truncated: m[2] === 'true',
    appliedLimits: m[3] === 'none' ? [] : m[3]!.split(', '),
    durationMs: Number(m[5]),
    ...(m[4] === undefined ? {} : { estimate: m[4] === 'true' }),
  };
}

/** The text with the untrusted-data envelope, tags and body, cut out: what a reader sees as the app's own words. */
export function outsideEnvelope(text: string): string {
  const open = text.match(/^<untrusted-data-([0-9a-f]{32})>$/m);
  if (!open) return text;
  const closing = `</untrusted-data-${open[1]}>`;
  const start = text.indexOf(open[0]);
  const end = text.indexOf(`\n${closing}`) + 1 + closing.length;
  return text.slice(0, start) + text.slice(end);
}

export function envelopeBody(text: string): string {
  const open = text.match(/^<untrusted-data-([0-9a-f]{32})>$/m);
  if (!open) throw new Error(`no envelope in: ${text.slice(0, 200)}`);
  const start = text.indexOf(open[0]) + open[0].length + 1;
  const end = text.indexOf(`\n</untrusted-data-${open[1]}>`);
  return text.slice(start, end);
}
