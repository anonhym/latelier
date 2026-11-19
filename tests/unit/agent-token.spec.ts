import { describe, it, expect } from 'vitest';
import {
  HANDSHAKE_MAX_BYTES,
  TOKEN_RE,
  generateToken,
  hashToken,
  matchHash,
  parseHandshake,
} from '../../electron/agent/token';

describe('generateToken', () => {
  it('is 43 base64url characters and different every time', () => {
    const a = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(TOKEN_RE.test(a)).toBe(true);
    expect(generateToken()).not.toBe(a);
  });
});

describe('hashToken', () => {
  it('is the sha256 hex of the token', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('is deterministic and never equals the token', () => {
    const t = generateToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toContain(t);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('matchHash', () => {
  const row = (id: string, token: string) => ({ id, token_hash: hashToken(token) });

  it('returns the row whose hash matches', () => {
    const rows = [row('a', 'one'), row('b', 'two'), row('c', 'three')];
    expect(matchHash(hashToken('two'), rows)).toBe(rows[1]);
  });

  it('returns null when nothing matches or there are no rows', () => {
    expect(matchHash(hashToken('nope'), [row('a', 'one')])).toBeNull();
    expect(matchHash(hashToken('nope'), [])).toBeNull();
  });

  it('does not throw on a stored hash of another length', () => {
    expect(matchHash(hashToken('x'), [{ id: 'a', token_hash: 'short' }])).toBeNull();
    expect(matchHash('short', [row('a', 'x')])).toBeNull();
  });

  it('keeps the first match when two rows carry the same hash', () => {
    const rows = [row('first', 'dup'), row('second', 'dup')];
    expect(matchHash(hashToken('dup'), rows)?.id).toBe('first');
  });

  it('compares every row even after a match', () => {
    let reads = 0;
    const counting = (id: string, token: string) => ({
      id,
      get token_hash() {
        reads += 1;
        return hashToken(token);
      },
    });
    matchHash(hashToken('one'), [counting('a', 'one'), counting('b', 'two'), counting('c', 'three')]);
    expect(reads).toBe(3);
  });
});

describe('parseHandshake', () => {
  const line = (o: unknown) => JSON.stringify(o);

  it('accepts a token and protocol 1', () => {
    expect(parseHandshake(line({ agentToken: 'abc_DEF-123', protocol: 1 }))).toEqual({
      ok: true,
      token: 'abc_DEF-123',
      protocol: 1,
    });
  });

  it.each([
    ['not JSON', 'agentToken=abc'],
    ['empty', ''],
    ['an array', '[1]'],
    ['null', 'null'],
    ['a string', '"abc"'],
    ['no token', line({ protocol: 1 })],
    ['a numeric token', line({ agentToken: 5, protocol: 1 })],
    ['an empty token', line({ agentToken: '', protocol: 1 })],
    ['a token with a space', line({ agentToken: 'ab cd', protocol: 1 })],
    ['a token with a quote', line({ agentToken: 'ab"cd', protocol: 1 })],
    ['a token with a newline', line({ agentToken: 'ab\ncd', protocol: 1 })],
    ['a token with a dot', line({ agentToken: 'ab.cd', protocol: 1 })],
    ['a token of 257 characters', line({ agentToken: 'a'.repeat(257), protocol: 1 })],
    ['no protocol', line({ agentToken: 'abc' })],
    ['a string protocol', line({ agentToken: 'abc', protocol: '1' })],
    ['a fractional protocol', line({ agentToken: 'abc', protocol: 1.5 })],
  ])('refuses %s as malformed', (_name, input) => {
    expect(parseHandshake(input)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('accepts a token of exactly 256 characters', () => {
    const token = 'a'.repeat(256);
    expect(parseHandshake(line({ agentToken: token, protocol: 1 }))).toMatchObject({ ok: true, token });
  });

  it.each([0, 2, -1, 99])('names protocol %s as unsupported', (protocol) => {
    expect(parseHandshake(line({ agentToken: 'abc', protocol }))).toEqual({
      ok: false,
      reason: 'unsupported-protocol',
    });
  });

  it('refuses a line over the handshake cap even when it is valid JSON', () => {
    const padded = line({ agentToken: 'abc', protocol: 1, pad: 'x'.repeat(HANDSHAKE_MAX_BYTES) });
    expect(padded.length).toBeGreaterThan(HANDSHAKE_MAX_BYTES);
    expect(parseHandshake(padded)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('accepts a line of exactly the handshake cap', () => {
    const base = line({ agentToken: 'abc', protocol: 1, pad: '' });
    const exact = line({ agentToken: 'abc', protocol: 1, pad: 'x'.repeat(HANDSHAKE_MAX_BYTES - base.length) });
    expect(exact.length).toBe(HANDSHAKE_MAX_BYTES);
    expect(parseHandshake(exact)).toMatchObject({ ok: true });
  });

  it('never echoes the input, valid or not', () => {
    const secret = 'SuperSecretTokenValue123';
    const results = [
      parseHandshake(line({ agentToken: secret, protocol: 2 })),
      parseHandshake(`{"agentToken":"${secret}"`),
      parseHandshake(line({ agentToken: `${secret} `, protocol: 1 })),
    ];
    for (const r of results) expect(JSON.stringify(r)).not.toContain(secret);
  });
});
