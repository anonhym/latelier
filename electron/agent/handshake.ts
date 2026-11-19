import type { Socket } from 'node:net';
import { HANDSHAKE_MAX_BYTES, parseHandshake } from './token.ts';

export const HANDSHAKE_TIMEOUT_MS = 5_000;

/** JSON-RPC error codes on the refusal line. */
export const REFUSED_CODE = -32001;
export const UNSUPPORTED_PROTOCOL_CODE = -32002;

export type HandshakeOutcome =
  | { ok: true; token: string }
  | { ok: false; refusal: 'refused' | 'unsupported-protocol' };

const NEWLINE = 0x0a;

/**
 * Reads the bridge's first line off a fresh socket (X27 §4.5). On success the
 * bytes after the newline are pushed back with `unshift`, so an `initialize`
 * that arrived in the same chunk is not lost, and the socket is left paused
 * for the caller to resume once MCP is attached. Nothing is logged here, and
 * the line is never kept: it holds the plaintext token.
 */
export function readHandshake(
  socket: Socket,
  options: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<HandshakeOutcome> {
  const timeoutMs = options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? HANDSHAKE_MAX_BYTES;
  return new Promise((resolve) => {
    let buffered: Buffer = Buffer.alloc(0);
    let settled = false;

    const finish = (outcome: HandshakeOutcome, rest?: Buffer): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('close', onClose);
      socket.off('error', onClose);
      socket.pause();
      if (rest && rest.length > 0) socket.unshift(rest);
      resolve(outcome);
    };

    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf(NEWLINE);
      if (end < 0) {
        if (buffered.length > maxBytes) finish({ ok: false, refusal: 'refused' });
        return;
      }
      if (end > maxBytes) {
        finish({ ok: false, refusal: 'refused' });
        return;
      }
      const line = buffered.subarray(0, end).toString('utf8');
      const rest = buffered.subarray(end + 1);
      buffered = Buffer.alloc(0);
      const parsed = parseHandshake(line);
      if (parsed.ok) finish({ ok: true, token: parsed.token }, rest);
      else finish({ ok: false, refusal: parsed.reason === 'malformed' ? 'refused' : parsed.reason });
    };
    const onClose = (): void => finish({ ok: false, refusal: 'refused' });
    const timer = setTimeout(() => finish({ ok: false, refusal: 'refused' }), timeoutMs);

    socket.on('data', onData);
    socket.once('close', onClose);
    socket.once('error', onClose);
  });
}

/** One JSON-RPC error line, then close. The text never names the token or why it was refused. */
export function refuse(socket: Socket, refusal: 'refused' | 'unsupported-protocol'): void {
  const unsupported = refusal === 'unsupported-protocol';
  const line = JSON.stringify({
    jsonrpc: '2.0',
    id: null,
    error: {
      code: unsupported ? UNSUPPORTED_PROTOCOL_CODE : REFUSED_CODE,
      message: unsupported ? 'Agent protocol not supported' : 'Agent token refused',
    },
  });
  if (socket.destroyed) return;
  // end() flushes the line, then the callback frees the socket even if the peer never closes.
  socket.end(`${line}\n`, () => socket.destroy());
}
