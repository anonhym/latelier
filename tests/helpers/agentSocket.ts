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

/** Handshakes with the token, then runs an MCP `Client` over the same socket. */
export async function connectAgent(
  socketPath: string,
  token: string,
  clientInfo = { name: 'spec-client', version: '9.9' },
): Promise<AgentConnection> {
  const socket = await openSocket(socketPath);
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  socket.write(handshakeLine(token));
  const client = new Client(clientInfo);
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
