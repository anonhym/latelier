import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The only characters a token may hold. The bridge enforces the same class, so
 * it can never build a malformed handshake line, and the parser refuses
 * anything else before it reaches a hash.
 */
export const TOKEN_RE = /^[A-Za-z0-9_-]{1,256}$/;

/** The one handshake protocol this build speaks. */
export const SUPPORTED_PROTOCOL = 1;

/** A handshake line is a token plus a few keys; anything longer is not one. */
export const HANDSHAKE_MAX_BYTES = 512;

/** 32 random bytes, base64url: 43 characters, all inside `TOKEN_RE`. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex. Tokens are high-entropy, so a plain digest is enough: there is nothing to brute-force. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function digestsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on unequal lengths. A stored hash is always 64 hex
  // characters, so a length mismatch says nothing about any secret.
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * The stored row whose hash equals `presentedHash`, or null. Every row is
 * compared, matched or not, so the time taken does not reveal which row (if
 * any) matched.
 */
export function matchHash<T extends { token_hash: string }>(
  presentedHash: string,
  rows: readonly T[],
): T | null {
  let found: T | null = null;
  for (const row of rows) {
    const equal = digestsEqual(presentedHash, row.token_hash);
    if (equal && found === null) found = row;
  }
  return found;
}

export type HandshakeParse =
  | { ok: true; token: string; protocol: number }
  | { ok: false; reason: 'malformed' | 'unsupported-protocol' };

/**
 * Parses the bridge's first line. Takes no logger and returns only a coarse
 * reason, never the input or any part of it: the line carries the plaintext
 * token, and `electron/log.ts` redacts by field name, which a raw line does
 * not have.
 */
export function parseHandshake(line: string): HandshakeParse {
  if (line.length > HANDSHAKE_MAX_BYTES) return { ok: false, reason: 'malformed' };
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    // The reason is all the caller learns: the parse error would quote the line.
    return { ok: false, reason: 'malformed' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'malformed' };
  }
  const { agentToken, protocol } = value as { agentToken?: unknown; protocol?: unknown };
  if (typeof agentToken !== 'string' || !TOKEN_RE.test(agentToken)) {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof protocol !== 'number' || !Number.isInteger(protocol)) {
    return { ok: false, reason: 'malformed' };
  }
  if (protocol !== SUPPORTED_PROTOCOL) return { ok: false, reason: 'unsupported-protocol' };
  return { ok: true, token: agentToken, protocol };
}
